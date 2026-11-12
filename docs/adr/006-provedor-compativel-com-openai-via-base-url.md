# ADR 006 — Provedor compatível com OpenAI via `OPENAI_BASE_URL`

- **Status:** aceito
- **Data:** 12/11/2026
- **Bloco:** pós-5 (configuração de LLM)

## Contexto

O projeto usa o SDK da OpenAI para chat (com tool calling e streaming) e embeddings. O dono quer rodar o agente e a avaliação sem custo, usando o tier gratuito do Gemini, que expõe uma camada compatível com OpenAI em `https://generativelanguage.googleapis.com/v1beta/openai/`. O comportamento com a OpenAI não pode mudar.

## Decisão

- **Provedor compatível via `baseURL`, não SDK do Gemini.** Uma variável opcional `OPENAI_BASE_URL` (validada como URL; vazia = não definida) é repassada aos dois clientes (`llm.factory.ts`: chat e embeddings, que também alimenta `pnpm db:embed`). Sem ela, o cliente é idêntico ao anterior. Evita um segundo provider, um segundo mapeamento de mensagens/stream e mais testes; `LLM_PROVIDER` continua `openai | fake`.
- **Schemas de tools portáveis.** Um sanitizador por whitelist (`schema-sanitizer.ts`) roda sempre em `toOpenAiTools`: mantém `type`, `properties`, `required`, `items`, `enum`, `description`, `minimum`, `maximum`, `minItems`, `maxItems`, `minLength`, `maxLength`, `anyOf`, `nullable`; descarta o resto (`additionalProperties`, `exclusiveMinimum/Maximum`, `default`, `format`, `pattern` etc.), converte `type: [x, "null"]` em `nullable` e `const` em `enum` de um valor. Como não usamos strict mode, o subconjunto funciona nos dois provedores. A validação real dos argumentos continua no servidor, com Zod, no `ToolRegistry`.
- **Parâmetros do chat** não mudaram: `model`, `messages`, `tools`, `stream`, `stream_options.include_usage`, `temperature`, `max_tokens`. Não enviamos `parallel_tool_calls`, `strict`, `tool_choice`, `user` nem `seed`. Com `OPENAI_BASE_URL` definida, o `max_tokens` enviado sobe de 800 para pelo menos 4096, porque modelos com raciocínio (como a família Gemini) contam os tokens de "thinking" dentro desse limite e truncariam a resposta; sem a variável, continua 800. O piso de 4096 continua valendo: é só um teto, não aumenta a latência quando o modelo responde curto, e o `gemini-3.5-flash-lite` usa pouco thinking. O `reasoning_effort` entrou depois (ver a atualização abaixo). O adaptador de stream tolera ausência de `usage`, `index` ausente nos deltas de tool call e `id` vazio.
- **Validação de dimensões.** Cada vetor retornado deve ter `EMBEDDING_DIMENSIONS` posições (hoje fixas em 1536) e a quantidade de vetores deve bater com a de entradas; senão o erro é explícito e cita `LLM_EMBEDDING_MODEL` / `OPENAI_BASE_URL`.

## Atualização (2026-11-12): testes com o Gemini real

- **Modelo recomendado:** `gemini-3.5-flash-lite` (~1,5 s por chamada nos testes do dono), com `gemini-3.5-flash` como alternativa mais lenta (~9 s). O `gemini-2.5-flash` não está disponível para contas novas.
- **Thought signatures:** o Gemini 3 devolve em cada tool call do assistente um campo `extra_content` (`{"google": {"thought_signature": "..."}}`) e rejeita a requisição seguinte se ele faltar. Guardamos o valor como JSON opaco (`ToolCall.extraContent`), persistimos em `Message.content` (`toolCalls[].extraContent`) e reenviamos intacto no item correspondente de `tool_calls`. Sem o campo (OpenAI), o payload é idêntico ao anterior.
- **Retry:** o retry do SDK foi desligado (`maxRetries: 0`). Refazemos só HTTP 429 e 503, até 3 vezes (1 s, 2 s, 4 s), apenas antes do primeiro chunk (depois disso repetiria texto). Esgotado, o erro vira `LLM_OVERLOADED` (503), mostrado ao usuário em pt-BR; no eval, esses casos contam como infraestrutura e saem da taxa de acerto.
- **Diagnóstico:** um `fetch` próprio registra status e corpo de toda resposta não 2xx (truncado em 4 KB, sem headers) e normaliza corpos que o SDK não entende (o Gemini responde `[{"error": ...}]`, que o SDK mostrava como "400 status code (no body)"). `pnpm llm:smoke` roda um ciclo completo sem stream contra o provedor configurado.

## Atualização (2026-11-12): `reasoning_effort`, timeout e fallback

No eval v2 (19/20, sem retries) a latência variou de 3 a 73 s em casos idênticos e a única falha foi uma segunda chamada de chat travada até o timeout do eval: enfileiramento no provedor.

- **`reasoning_effort`.** Nova variável `LLM_REASONING_EFFORT` (`none | minimal | low | medium | high`, padrão `minimal`), enviada nas chamadas de chat **só quando `OPENAI_BASE_URL` está definida** (também no `llm:smoke`). Sem `OPENAI_BASE_URL` o payload para a OpenAI é idêntico ao anterior (coberto por teste). Se o provedor rejeitar o valor, é só trocar a variável; o `pnpm llm:smoke` mostra o erro. Isso substitui a frase anterior "não enviamos `reasoning_effort`".
- **Timeout do primeiro chunk.** `LLM_CALL_TIMEOUT_MS` (padrão 15000) mede, por chamada de chat, o tempo até o **primeiro chunk** do stream (abertura mais primeiro token), com um `AbortController` combinado com o `signal` do usuário. Depois que o conteúdo começa a chegar nada é refeito, para não duplicar texto (mesma regra do retry). Um abort do usuário durante a espera nunca vira timeout nem dispara o fallback.
- **Fallback.** Se estourar, repete-se **uma vez** com `LLM_FALLBACK_MODEL` (opcional; sugestão `gemini-3.1-flash-lite`). Sem a variável não há fallback. Se o fallback também estourar, ou não houver fallback, o erro é `LLM_TIMEOUT` (504), mostrado em pt-BR ("O serviço de IA demorou demais para responder. Tente novamente."). No eval ele continua sendo falha do agente (não é infraestrutura, D6.9).
- **Como timeout e retry 429/503 se combinam.** Para cada modelo, a ordem é: (1) a chamada é refeita em 429/503 (backoff de 1, 2 e 4 s); (2) cada tentativa HTTP tem o seu próprio timeout de primeiro chunk (a espera do backoff não conta nele). Um timeout não tem status HTTP, então o retry o repassa na hora, sem backoff. Só então o modelo de fallback recebe uma execução nova do mesmo conjunto (seus próprios retries e timeout). Resumindo: principal (com retry), timeout, fallback (com retry e timeout), `LLM_TIMEOUT`. Pior caso de espera de um modelo: 4 tentativas de 15 s mais 7 s de backoff.
- **Logs.** `llm_timeout` (modelo, tempo, tentativa 1 ou 2) e `llm_fallback` (modelo de origem, de destino e resultado `ok`, `timeout` ou `error`).
- **Risco: thought signatures entre modelos.** O `extra_content` (thought signature) de cada tool call vem do modelo principal e fica no histórico. Se o fallback assumir no meio de um ciclo de tools, reenviamos ao outro modelo exatamente o que recebemos, sem tentar converter ou descartar. Não sabemos se o Gemini aceita assinaturas de outro modelo; com `LLM_FALLBACK_MODEL` definido, o `pnpm llm:smoke` reenvia o histórico (com as assinaturas do principal) ao fallback e mostra a resposta ou o erro. Se for rejeitado, o resultado seria `llm_fallback` com `result: "error"` e `LLM_ERROR`.
- **Interface.** Depois de 8 s sem nenhum evento novo no stream (conta o silêncio, não o tempo total), o chat mostra "O assistente está mais lento que o normal, aguarde…", que some ao chegar qualquer evento ou ao terminar.

## Consequências

- **Positivas:** custo zero possível; mudança pequena e reversível (apagar a variável); a mesma suíte de testes cobre os dois caminhos.
- **Riscos:** se o endpoint ignorar `dimensions` e devolver outro tamanho (ex.: 3072), o erro claro aparece já no `db:embed`. A coluna é `vector(1536)` e o índice HNSW não aceita mais de 2000 dimensões, então não dá simplesmente aumentar a coluna. O modelo de embedding entra no hash, então trocá-lo exige `pnpm db:embed` de novo.
- **Limites do tier gratuito:** rate limit por minuto/dia pode causar erros 429 e deixar o `pnpm eval` lento ou incompleto; modelos diferentes também podem se comportar diferente nos casos de avaliação.
- **Compatibilidade não garantida:** a camada compatível do Gemini é mantida pelo Google e pode divergir da OpenAI; por isso o contrato enviado é o mínimo comum.
