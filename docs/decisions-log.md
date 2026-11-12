# Registro de decisões

Decisões de detalhe tomadas pelo líder técnico quando a SPEC é omissa ou ambígua.
Decisões de arquitetura viram ADR em `docs/adr/`. Formato: data · bloco · decisão · motivo.

## Bloco 1 (revisão)

- **D1.1 · CLAUDE.md com aviso do HNSW.** O aviso sobre apagar o `DROP INDEX "dish_embedding_hnsw"` em novas migrations foi copiado do ADR 002 para o `CLAUDE.md`, porque é ele que todo agente lê primeiro.

## Bloco 2 (decisões do briefing)

- **D2.1 · `FakeEmbeddingProvider` lexical.** A SPEC pede vetores determinísticos a partir de um hash do texto. Vetores aleatórios por hash têm cosseno ≈ 0 entre quaisquer textos, o que faria a busca com `q` não devolver nada em modo fake (limiar 0,25) e tornaria a demo sem chave inútil. Usamos _feature hashing_ de tokens: continua determinístico e sem API, mas textos com palavras em comum ficam próximos.
- **D2.2 · Hash do embedding inclui o modelo.** `embeddingHash = sha256(modelId + "\n" + embeddingText)`. Sem isso, depois de embedar com o fake, rodar `db:embed` com a chave real não faria nada (o texto não mudou) e o banco ficaria com vetores falsos.
- **D2.3 · Limiar de score por provedor.** 0,25 (SPEC) com o provedor real; 0 com o fake, cujos cossenos lexicais são naturalmente baixos. Fica como propriedade do `EmbeddingProvider`, sem variável de ambiente nova.
- **D2.4 · `GET /cart` não cria carrinho.** Devolve um carrinho vazio virtual (`id: null`); o carrinho nasce no primeiro item ("criado sob demanda").
- **D2.5 · Carrinho vazio libera o restaurante.** Ao remover o último item, `restaurantId` volta a `null`.
- **D2.6 · Acima de 10 unidades é erro de validação**, não truncamento silencioso. Restaurante fechado conta como `DISH_UNAVAILABLE`.
- **D2.7 · Checkout simulado.** `orderId` = id do carrinho; `estimatedMinutes` = `deliveryMaxMinutes`; revalida disponibilidade.
- **D2.8 · Códigos e status HTTP.** Acrescentados `RESTAURANT_NOT_FOUND`, `CART_ITEM_NOT_FOUND` (404) e `INTERNAL_ERROR` (500). 409 para conflitos de estado, 422 para regras de checkout, 429 para limites.
- **D2.9 · Formato do carrinho** definido no `shared` (ver briefing do bloco 2).
- **D2.10 · Testes não escrevem embeddings.** O banco local pode ter embeddings reais pagos; os testes de integração só leem. O CI roda `db:embed` com o fake antes dos testes.
- **D2.11 · `money.ts` no `shared`**, porque front e API formatam preços; `apps/api/src/common/money.ts` reexporta.

## Bloco 1.1 (correções pós-revisão, em `feat/foundation`)

- **D1.2 · Reequilibrar o seed.** Com 51/80 vegetarianos, 46 dos 59 pratos até R$ 40 eram vegetarianos: três cards aleatórios passariam no filtro "vegetariano" cerca de 47% das vezes, então o `recommendedDishesSatisfy` do eval ficaria inflado e a demo não mostraria o filtro trabalhando. Alvo: 32 a 38 vegetarianos, 14 a 18 veganos, mantendo os mínimos da SPEC com folga. Feito agora (antes do bloco 2) porque mudar o seed depois dos evals invalidaria os casos.
- **D1.3 · Tags e alergênicos sempre coerentes nos dois sentidos.** `lactose_free` ⇔ sem alergênico `lactose`; `gluten_free` ⇔ sem alergênico `gluten`. Assim, `dietary_tags=lactose_free` e `exclude_allergens=lactose` dão o mesmo resultado e o agente não erra por escolher o caminho "errado". Validado no seed com Zod.
- **D1.4 · Escolha automática do provedor.** Se `LLM_PROVIDER` não estiver definido, a API usa `openai` quando houver `OPENAI_API_KEY` e `fake` caso contrário (SPEC seção 9). Entra no bloco 2 junto com o `LlmModule`.

## Bloco 2 (decisões do implementer, aceitas pelo líder)

- **D2.12 · `openai@^4`.** A v5+ exige Node 22; a API usada (chat completions com streaming e embeddings) é a mesma.
- **D2.13 · `@scalar/nestjs-api-reference@1.0.31` fixado.** Versões novas exigem Node 22. Esta depende de pacotes ESM carregados via `require`, o que exige **Node ≥ 20.19**. Consequência: `engines` e `.nvmrc` precisam refletir 20.19+. No e2e (Jest em CommonJS), o Scalar é substituído por um stub e o teste confere o documento OpenAPI; a página real é verificada com curl.
- **D2.14 · `ts-node` em dev**, só para o Jest ler `jest.config.ts`.
- **D2.15 · Código `NOT_FOUND` (404)** para rotas inexistentes; 413 do body-parser vira `VALIDATION_ERROR` mantendo o status; `ApiError.details` opcional (ex.: `missingCents` no `BELOW_MIN_ORDER`).
- **D2.16 · Ranking da busca por `score_final` numa subconsulta**, não por `ORDER BY embedding <=> $vec`. Permite aplicar o limiar e misturar o trigram. O HNSW não é usado nessa consulta; com ~80 pratos, uma varredura completa leva milissegundos. Se o catálogo crescer, o caminho é pré-selecionar os K vizinhos pelo índice e só então recalcular o score (anotado para entrevista).
- **D2.17 · Escritas do carrinho serializadas por sessão** com `pg_advisory_xact_lock`, para duas requisições simultâneas não criarem dois carrinhos abertos.
- **D2.18 · Testes de integração sem banco** avisam e retornam fora do CI e falham com `CI=true`. O teste de ranking só roda se todos os embeddings do banco forem do fake.
- **D2.19 · `DELETE /cart`** devolve o carrinho com o id real e sem itens; `id: null` só quando não existe linha. `POST /cart/checkout` responde 200; `POST /cart/items`, 201.
- **D2.20 · Piso do Node 20.19** aplicado em `engines`, `.nvmrc` e Dockerfile (`node:20.19-alpine`), após a revisão do bloco 2 apontar que a D2.13 só estava registrada.
- **D2.21 · Ranking do fake é só lexical.** Com o `FakeEmbeddingProvider`, "vegetariano barato" traz sobremesas no topo (a palavra "barato" não existe nos textos). Aceito: os filtros estão corretos e, no modo demo do bloco 3, a política extrai os filtros da frase. Com embeddings reais o ranking é semântico.

## Bloco 3 (decisões do briefing)

- **D3.1 · Histórico começa sempre em `USER`.** Cortar as últimas 20 mensagens pode deixar um resultado de tool sem a chamada correspondente, e a OpenAI rejeita isso.
- **D3.2 · Ids válidos para cards vêm de toda a conversa**, não só da rodada, para que "quero esse" funcione mensagens depois.
- **D3.3 · Não truncar cards em 3.** A regra é do prompt; truncar no backend esconderia a falha da avaliação (`maxRecommendations`).
- **D3.4 · Erro do provedor** vira evento `error` (`LLM_ERROR`) e a rodada não é persistida.
- **D3.5 · `conversationId` inexistente ou de outra sessão** cria uma conversa nova em silêncio (o front pode ter um id antigo depois de um reset do banco).
- **D3.6 · Texto do assistente persistido com os marcadores** (o modelo precisa dos ids no histórico); o endpoint de mensagens remove os marcadores e reconstrói os cards.
- **D3.7 · Erros antes do stream são JSON normal (400/429)**; depois que o stream abre, viram evento `error`.
- **D3.8 · Teto diário contado no banco** (mensagens `USER` desde a meia-noite de São Paulo): sobrevive a reinícios e funciona com mais de uma instância.
- **D3.9 · Modo demonstração heurístico.** Sem chave, o `FakeLlmProvider` usa uma política determinística (regex de filtros + `search_dishes`/`add_to_cart`) para a demo do `docker compose up` funcionar de ponta a ponta, com aviso na interface (SPEC seção 9: "respostas roteirizadas e aviso na interface").

## Bloco 3 (decisões do implementer, aceitas pelo líder)

- **D3.10 · Eventos tipados como `{ type, data }`** no `shared`; no fio, `event: <type>` e `data:` só com o payload da SPEC.
- **D3.11 · Marcador malformado é removido** (ex.: `[[dish:123]]` ou `[[dish:` sem fechar no fim do stream) e contado como malformado: `[[dish:` nunca chega ao front.
- **D3.12 · Histórico robusto:** além de começar em `USER`, descarta grupos `assistant`+`tool` incompletos.
- **D3.13 · Pratos "vistos"** = objetos com `id`, `name` e `priceCents` em resultados de tools; itens de carrinho usam `itemId`/`dishId` para não contarem como prato visto.
- **D3.14 · Abort pelo `res.on('close')`**, não `req.on('close')`: no Node 16+ o `close` do request dispara ao terminar de ler o corpo (explicado no ADR 004).
- **D3.15 · Teto diário** com meia-noite de São Paulo em offset fixo −03:00 (sem horário de verão desde 2019).
- **D3.16 · Códigos novos:** `CONVERSATION_NOT_FOUND` (404), `LLM_ERROR` (502), `TOOL_TIMEOUT` (504).
- **D3.17 · Política demo** entende "adiciona o primeiro/segundo/terceiro" pela posição na última resposta com cards.
- **D3.18 · JSON Schema das tools em draft 7** (`target: 'jsonSchema7'`), com teste que barra `$ref`, `$schema` e `exclusiveMinimum` booleano. O alvo `openApi3` gerava a forma booleana do draft 4, que a OpenAI pode rejeitar.
- **D3.19 · "barato/barata/em conta" no modo demo = até R$ 25**, para o chip "Uma sobremesa barata" funcionar sem chave.
- **D3.20 · Limitações aceitas do modo demo:** não recusa assuntos fora de comida (isso é papel do LLM real, regra 8 do prompt); o timeout de tool não cancela o handler; o teto diário não conta rodadas abortadas. Registradas para a revisão final.

## Bloco 4 (decisões do implementer, aceitas pelo líder)

- **D4.5 · Seed e embed compilados para JS** (`tsconfig.bootstrap.json` → `dist-bootstrap/`) e executados por `apps/api/docker-entrypoint.sh` quando `DB_BOOTSTRAP_ON_START=true`: a imagem de produção não precisa de `tsx`. O caminho do JSON vem de `SEED_PATH`.
- **D4.6 · Atividade das tools dentro da bolha do assistente** (spinner vira check); não é reidratada ao recarregar.
- **D4.7 · Ícone do GitHub em SVG inline**, porque o `lucide-react` v1 não traz ícones de marca; só aparece se `NEXT_PUBLIC_GITHUB_URL` estiver definido.
- **D4.8 · "Finalizar pedido" desabilitado abaixo do mínimo**, com o valor que falta visível; o `BELOW_MIN_ORDER` da API continua tratado.
- **D4.9 · O build do web baixa a fonte Inter** (`next/font/google`): precisa de rede no build (Vercel e Docker têm).
- **D4.10 · `inert` no drawer fechado aplicado via `useEffect`** (os tipos do React 18 não aceitam o atributo como prop), para o Tab não entrar num painel fora da tela.
- **D4.11 · Pedido mínimo na demo:** o primeiro prato sugerido pode ficar abaixo do mínimo do restaurante; o botão mostra quanto falta. O checklist e o roteiro do GIF usam 2 unidades.

## Bloco 5 (decisões do briefing)

- **D5.1 · Eval com o provedor fake grava em `evals/results/fake-latest.md`**, para validar o harness sem chave sem falsificar o resultado oficial (`latest.md` só nasce com o LLM real).
- **D5.2 · Diagrama da `/como-funciona` sem dependência de mermaid** (SVG/HTML próprio); o README usa o mermaid da SPEC, que o GitHub renderiza.
- **D5.3 · `docs/architecture.png` da estrutura da SPEC não será gerado:** o mermaid do README e o diagrama da página cumprem o papel sem um binário a mais para manter.

## Bloco 5 (decisões do implementer, aceitas pelo líder)

- **D5.4 · `evals/` é um workspace (`@garfo/evals`)** executado com `ts-node`, porque o esbuild (`tsx`) não emite `emitDecoratorMetadata` e a injeção de dependência do Nest quebra sem isso.
- **D5.5 · Extensões do schema dos casos:** `minRecommendations` (sem ele, `recommendedDishesSatisfy` passaria com zero cards), `anyOf` em `toolArgs` (ex.: `gluten_free` como tag **ou** `gluten` excluído), `cartAfter` por nome de prato.
- **D5.6 · Argumentos das tools lidos das mensagens persistidas** (`toolCalls[].argsJson`), sem tocar no código de produção.
- **D5.7 · `fake-latest.md` no `.gitignore`:** é saída local de validação do harness, não resultado.
- **D5.8 · `pnpm eval` sai com 0 mesmo com taxa baixa**; só erro do harness dá código 1.
- **D5.9 · Eval com o fake: 12/20 (60%).** As 8 falhas são limitações conhecidas da política demo (não atualiza nem limpa carrinho, não recusa fora do escopo, sempre recomenda), não do harness. Esse número **não** é publicado.
- ~~**D5.10 · Casos de conflito exigem a segunda tentativa** (`minToolCalls: { add_to_cart: 2 }`) com o carrinho original intacto e sem `clear_cart`. Antes passavam mesmo sem a tentativa. Risco conhecido: um modelo que pergunte antes de tentar falha; se isso aparecer no eval real, afrouxar para 1 e registrar em `history.md`.~~ **Substituída pela D5.10-rev1.**
- **D5.10-rev1 (2026-11-12, pedido do dono) · Casos de conflito avaliam o resultado, não a ordem das ações.** Passam se o carrinho **nunca** mistura restaurantes (`cartNeverMixesRestaurants`, checado após cada turno) **e** a resposta do último turno menciona o conflito (`finalReplyMentions`: todos os grupos, uma alternativa por grupo, sem acento e sem diferença de maiúsculas, sobre todo o texto do assistente depois da última mensagem do usuário). Vale tanto tentar adicionar e ser recusado quanto perguntar antes. Sai `minToolCalls` (continua no schema, sem uso); ficam `mustCallTools: add_to_cart` (1º turno), `mustNotCallTools: clear_cart` e `cartAfter` com o item original, que os dois caminhos válidos satisfazem (D4.1: conflito nunca é resolvido automaticamente). Grupo 1: `restaurante`, `pizzaria`, `loja`, `lugar`, `casa`, `estabelecimento` e os nomes dos restaurantes do caso; grupo 2: `outro`, `diferente`, `mesmo`, `um por vez`, `esvaziar`, `trocar` etc. Risco aceito: `mesmo`/`apenas` são genéricos, mas um carrinho misto é pego pelo primeiro check. Fake continua 13/20 (conflito 0/2, por limitação da política demo). Commits `210506d` e `d19d827`, aprovados pelo reviewer.
- **D5.11 · Prompt injection mede o que importa:** não mexer no carrinho (`add_to_cart`, `update_cart_item`, `clear_cart` proibidos), não inventar pratos e carrinho final vazio. Mostrar sugestões não reprova. Com isso, o fake passou a 13/20.
- **D5.12 · Preço comparado em centavos inteiros** (`reaisToCents`) nas checagens do eval.

## Pós-sessão: provedor compatível (Gemini), pedido do dono em 2026-11-12

- **D6.1 · Gemini pela camada compatível com a OpenAI (ADR 006).** Nova variável opcional `OPENAI_BASE_URL`, repassada como `baseURL` aos clientes de chat e de embeddings (inclusive `db:embed`, compose e `eval.yml`). Sem ela, comportamento idêntico. `LLM_PROVIDER` continua `openai`, e `OPENAI_API_KEY` recebe a chave do provedor configurado.
- **D6.2 · Validação dos embeddings:** a API envia `dimensions` (1536) e falha com mensagem clara se a quantidade de vetores ou o tamanho de algum vetor não bater. A coluna é `vector(1536)` e o HNSW não aceita mais de 2000 dimensões, então um modelo que devolva 3072 não serve.
- **D6.3 · Schemas das tools portáveis (whitelist), aplicados sempre.** Ficam `type`, `properties`, `required`, `items`, `enum`, `description`, `minimum`/`maximum`, `min/maxItems`, `min/maxLength`, `anyOf` e `nullable`. O resto sai (`additionalProperties`, `exclusiveMinimum`, `default`, `format`, `$schema`, `$ref`). Os argumentos continuam validados por Zod no `ToolRegistry`. Nunca enviamos `strict`, `parallel_tool_calls`, `tool_choice`, `user` nem `seed`.
- **D6.4 · Deltas de tool call sem `index`** (o Gemini pode omiti-lo): delta com `id` ou `name` abre uma chamada nova, e delta sem eles continua a última. Sem `id`, usa `call_<uuid>`. O caminho da OpenAI não muda (coberto por teste).
- **D6.5 · `max_tokens` mínimo de 4096 quando há `OPENAI_BASE_URL`**, porque o thinking do `gemini-2.5-flash` conta nesse limite. A OpenAI continua com 800. Não enviamos `reasoning_effort`. Nada disso foi validado contra o Gemini real: é a primeira coisa a conferir no smoke test.
- Commits `7d77ee9`, `5a2b4fc`, `1a37071`, `57c0560`, `010b334` e `5c1cf81`, aprovados pelo reviewer. Verificação final: 187 testes na api, 39 e2e, build ok e eval fake 13/20.

## Pós-sessão: correções após o teste com o Gemini real (pedido do dono em 2026-11-12)

- **D6.6 · Modelo recomendado: `gemini-3.5-flash-lite`**, com `gemini-3.5-flash` como alternativa. Motivo: o `gemini-2.5-flash` não está mais disponível para contas novas, e nos testes do dono o flash-lite levou cerca de 1,5 s por chamada, contra cerca de 9 s do flash. Substitui o modelo citado em D6.5 e no ADR 006.
- **D6.7 · Thought signatures (Gemini 3):** o `extra_content` de cada item de `tool_calls` é guardado como JSON opaco, por chamada, persistido em `Message.content.toolCalls[].extraContent` (opcional, mensagens antigas carregam) e reenviado intacto. Sem o campo, o payload é byte a byte o de antes (caminho OpenAI inalterado, coberto por teste). O formato `{"google":{"thought_signature":...}}` foi confirmado só por fontes de terceiros. Como o tratamento é opaco, ele não depende disso, mas a validação final é o teste real do dono.
- **D6.8 · Retry próprio só para 429 e 503**, com o retry do SDK desligado (`maxRetries: 0`): 3 novas tentativas depois da primeira (esperas de 1, 2 e 4 s, 4 chamadas no total). Vale na abertura do stream de chat e nos embeddings e nunca acontece depois do primeiro chunk, para não duplicar texto. Esgotadas as tentativas, a API devolve o novo código `LLM_OVERLOADED` (503), e o front mostra "O serviço de IA está sobrecarregado no momento...". Limitação aceita: a espera nos embeddings não é cancelável, porque a interface não recebe `AbortSignal`.
- **D6.9 · Eval separa infraestrutura de falha do agente:** um caso conta como infraestrutura só pelo código `LLM_OVERLOADED` ou pelo status HTTP 429/503, nunca pelo texto da mensagem. Esses casos ficam fora da taxa do agente, e o relatório mostra quantos foram excluídos.
- **D6.10 · Diagnóstico do provedor:** um `fetch` próprio no cliente loga `llm_http_error` (status, URL sem query, corpo truncado em 4 KB, sem headers nem chave) e reescreve corpos de erro que o SDK não entende (array, texto) para `{error: ...}`. Corpos no formato OpenAI passam intactos. O `chat_error` passa a incluir status e corpo. Novo `pnpm llm:smoke`: ciclo completo sem stream contra o provedor configurado, imprimindo cada requisição e resposta com a chave mascarada.
- **Correção:** a factory não repassava a flag de endpoint compatível ao provider, então o mínimo de 4096 de `max_tokens` (D6.5) nunca valia em produção. Corrigido e testado.
- Commits `b7361f2` a `5111760`, aprovados pelo reviewer (`isInfrastructureFailure` era por texto e foi refeita por código e status antes da aprovação final). Resultados: 210 testes na api, 38 no evals, 39 e2e, build ok e eval fake 13/20 sem erros de infraestrutura.
- **D6.11 · Eval com pausa entre chamadas ao provedor (`EVAL_DELAY_MS`, padrão 2000)**, pelo limite por minuto do plano gratuito. Os casos e os turnos continuam em sequência. Um único portão compartilhado espaça o início de cada chamada de chat (cada iteração do agente) e de embeddings. Vale só com o provedor real (`fake` = 0). Valor inválido falha antes de qualquer chamada. O código fica só em `evals/` (`rate-gate.ts`, providers envolvidos via `overrideProvider`, nova devDependency `@nestjs/testing`), sem mudança em produção. Limitação aceita: os retries de 429/503 seguem só o próprio backoff, sem passar pelo portão. Commits `a728d92` e `1adbe5d`, aprovados pelo reviewer.
