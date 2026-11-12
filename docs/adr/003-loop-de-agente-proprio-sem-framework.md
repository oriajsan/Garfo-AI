# ADR 003 — Loop de agente próprio, sem framework

- **Status:** aceito
- **Data:** 12/11/2026
- **Bloco:** 3 (Agente)

## Contexto

O Garfo precisa de um **agente**: um programa que conversa com um modelo de linguagem (LLM), deixa o modelo decidir quando chamar funções do nosso sistema (as _tools_: buscar pratos, mexer no carrinho...) e devolve a resposta ao usuário aos poucos (_streaming_).

O mecanismo por trás disso se chama _tool calling_ (ou _function calling_) e é simples de descrever:

1. Enviamos ao modelo o histórico da conversa e a lista de tools disponíveis (nome, descrição e um JSON Schema dos argumentos).
2. O modelo responde com **texto**, com **pedidos de tool** (`search_dishes` com tais argumentos), ou com os dois.
3. Se houve pedidos de tool, **nós** executamos cada uma, anexamos o resultado ao histórico e chamamos o modelo de novo.
4. Repetimos até o modelo responder só com texto.

Existem frameworks que empacotam esse ciclo (LangChain, LlamaIndex, Vercel AI SDK, agentes do Mastra etc.). A SPEC proíbe frameworks de agentes (seção 1, "Fora do escopo") e, além disso, o projeto existe para **demonstrar que entendemos o mecanismo**.

## Decisão

Implementar o loop na mão, em `apps/api/src/chat/agent.service.ts`: um `while` limitado a **6 iterações**, que consome `LlmProvider.chat(...)` (uma interface nossa, com implementações OpenAI e Fake) como um `AsyncIterable` de pedaços (`text`, `tool_call`, `done`).

Peças que ficam em arquivos pequenos e testáveis:

- **`tools/`**: um arquivo por tool, cada uma com nome, descrição em português, schema Zod, `handler` e `label` (o texto "Buscando pratos vegetarianos até R$ 40…" que o front mostra). O `ToolRegistry` converte o Zod em JSON Schema (`zod-to-json-schema`), valida os argumentos, aplica **timeout de 10 s** e transforma qualquer erro em **resultado** (`{ error: { code, message } }`), nunca em exceção. Assim o modelo pode explicar o erro ao usuário ("seu carrinho é de outro restaurante, quer trocar?").
- **`dish-marker.parser.ts`**: o modelo cita pratos como `[[dish:<uuid>]]`. O parser remove os marcadores do texto **enquanto ele chega em pedaços** (um marcador pode vir quebrado em vários deltas) e nunca deixa escapar um `[[dish:` para o usuário.
- **`system-prompt.ts`**: função pura que preenche data/hora e resumo do carrinho no texto da SPEC.
- **`conversation.repository.ts`**: histórico e persistência.

Regras que o loop garante, todas com teste:

- **Só se fala de pratos que vieram de uma tool.** Os ids citados pelo modelo só viram _cards_ se aparecerem em algum resultado de tool da conversa. Id desconhecido é descartado e registrado em log como `possible_hallucination`.
- **Mensagens de tool sempre seguem a mensagem do assistente dona delas.** A OpenAI rejeita uma mensagem `tool` sem a `assistant` anterior com o `tool_call_id` correspondente. Por isso o histórico enviado (últimas 20 mensagens) é cortado até a primeira mensagem do usuário, e grupos de tool incompletos são descartados.
- **Argumento inválido não derruba nada:** vira resultado `VALIDATION_ERROR` e o modelo tenta de novo.
- **Limite de 6 iterações**, para um modelo que não para de chamar tools não gastar dinheiro nem prender a conexão. Estourou: resposta padrão pedindo para reformular.
- **Cliente desconectou:** o `AbortSignal` interrompe o modelo e a rodada **não é persistida**. Erro do provedor: evento `error`, também sem persistir.
- **A rodada inteira é salva em uma transação, no final**: conversa nunca fica pela metade.

## Alternativas consideradas

| Alternativa                                      | Por que não                                                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LangChain / LangGraph / LlamaIndex               | Proibidos pela SPEC. Escondem justamente o que o projeto quer mostrar, trazem dezenas de dependências e abstrações que mudam a cada versão, e dificultam o controle fino de streaming, abort e persistência que precisamos. |
| SDK de agentes do provedor (ex.: Assistants API) | Prende o projeto a um fornecedor e guarda o estado da conversa do lado dele. Nós queremos o histórico no nosso Postgres e a possibilidade de trocar de provedor (a interface `LlmProvider` existe para isso).               |
| Vercel AI SDK só para o streaming                | Resolveria o streaming no front, mas o front consome SSE por `fetch` (ADR 004) e o back precisa de qualquer forma do loop, da validação e dos guardrails. Seria uma dependência a mais para cobrir uma parte pequena.       |
| Deixar o modelo "chamar" o checkout              | Fora de questão: ver ADR 005.                                                                                                                                                                                               |

## Consequências

- **Positivas:** ~200 linhas que o dono do projeto consegue explicar linha a linha; testes do loop com um `FakeLlmProvider` roteirizado, sem rede e sem chave; trocar OpenAI por outro provedor é escrever um adapter; guardrails (marcadores, ids válidos, limite, abort) ficam explícitos no código.
- **Negativas:** somos responsáveis por detalhes que um framework esconderia: formato das mensagens de tool de cada provedor, reconstrução de argumentos que chegam em pedaços no streaming (isso fica no adapter da OpenAI), limites de histórico. Cada um tem teste.
- **Para explicar em entrevista:** "um agente é um laço: chama o modelo, executa as tools que ele pediu, devolve os resultados e chama de novo, com um número máximo de voltas. O resto é engenharia em volta disso: validar o que o modelo pede, não confiar no que ele diz (ids de pratos), limitar custo e tempo, e nunca deixar o modelo executar ações irreversíveis."

## Atualização (blocos 3 e 5): detalhes que mudaram o comportamento

- **Modo demonstração (D3.9).** Sem chave, o `FakeLlmProvider` consulta uma política determinística de expressões regulares (`llm/demo-policy.ts`): extrai filtros da frase, chama `search_dishes` e `add_to_cart` e responde com um aviso na interface. Serve para a demo do `docker compose up` e **não mede** o LLM; limitações aceitas: não recusa assuntos fora de comida e não entende pedidos compostos.
- **Cards só de pratos vistos (D3.2, D3.3).** Os ids válidos vêm de todos os resultados de tool da conversa, e o backend não trunca em 3 cards: a regra é do prompt, e truncar esconderia uma falha que a avaliação precisa enxergar (`maxRecommendations`).
- **Erro do provedor (D3.4).** Vira evento `error` e a rodada não é persistida.
- **A avaliação reusa o loop sem alterá-lo.** O `pnpm eval` chama `AgentService.run` direto e descobre os argumentos das tools lendo as mensagens `ASSISTANT` persistidas (`toolCalls[].argsJson`), sem gancho novo no código de produção.
