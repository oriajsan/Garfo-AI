# Bloco 3 — Agente

- **Branch:** `feat/agent`, criada a partir de `feat/search-cart`.
- **Referências:** SPEC seções 2, 5 (endpoints de chat, erros), 6 (inteira), 8 e 9; `docs/blocks/bloco-2.md`; `docs/decisions-log.md`.
- **Pronto quando:** `curl -N -X POST localhost:3001/api/v1/chat` mostra o stream com `meta`, `tool_start`, `tool_end`, `dish_cards`, `token` e `done`, com resposta coerente (em modo fake/demo).

## Contexto herdado do bloco 2 (use, não recrie)

- Tipos do LLM: `apps/api/src/llm/llm.types.ts` (`ChatMessage`, `ToolCall`, `ToolDefinition`, `LlmStreamChunk`, `LlmProvider`, `EmbeddingProvider`). Tokens de injeção em `llm.tokens.ts`; fábrica por `LLM_PROVIDER` em `llm.factory.ts`.
- `FakeLlmProvider` (`fake-llm.provider.ts`): roteiro de `FakeTurn`s e `calls` registrados. Em runtime sem roteiro, hoje devolve `DEMO_MODE_TEXT`; neste bloco a fábrica passa a injetar a política demo (seção 8) no lugar desse texto fixo. Os testes continuam usando roteiros explícitos.
- `SearchService` (`catalog/search.service.ts`: `search`, `getDish`, `getRestaurant`), `CartService` (`cart/cart.service.ts`), `DomainError` (`common/domain-error.ts`), `SessionGuard` + `@SessionId()` (`common/session.guard.ts`), filtro global (`common/filters/all-exceptions.filter.ts`), montagem compartilhada com o e2e em `app.setup.ts`, códigos e status em `packages/shared/src/errors.ts` (acrescentar `CONVERSATION_NOT_FOUND`, `LLM_ERROR` e `TOOL_TIMEOUT` lá).
- Testes de banco: helpers em `src/testing/`; `test/setup-env.ts` carrega o `.env`.

## Tarefas

### 1. Tipos compartilhados (`packages/shared`)

- Schemas Zod e tipos dos eventos SSE da SPEC seção 6 (`meta`, `token`, `tool_start`, `tool_end`, `dish_cards`, `cart_updated`, `done`, `error`) como união discriminada `ChatEvent` + `DishCard`. Schema do corpo do `POST /chat` (`message` 1–500 após `trim`, `conversationId?` uuid). Schema da resposta de `GET /chat/:id/messages`.
- `DishCard`: `{ id, name, description, priceCents, dietaryTags, restaurant: { slug, name, emoji }, deliveryMinMinutes, deliveryMaxMinutes }`.

### 2. Tools (`apps/api/src/tools/`)

- Um arquivo por tool, cada um com: nome, descrição em pt-BR (clara para o modelo: quando usar e quando não usar), schema Zod de entrada, `handler(args, ctx)` e `label(args)` em pt-BR para o `tool_start` (ex.: "Buscando pratos vegetarianos até R$ 40…", "Adicionando 2× Baião de dois ao carrinho…").
- As 7 tools da SPEC seção 6 com os argumentos exatos (snake_case). `search_dishes` converte `max_price_reais` em centavos e chama o `SearchService`. `limit` 1–8, padrão 5.
- Resultado: JSON compacto; preços em centavos e formatados (`"R$ 32,90"`); descrição curta (até ~120 caracteres) na busca.
- `ToolRegistry`: lista as definições (JSON Schema via `zod-to-json-schema`, sem `$schema` e sem `additionalProperties` quebrando o formato OpenAI), valida os argumentos (`argsJson` inválido ou que falhe no Zod → resultado `{ error: { code: "VALIDATION_ERROR", message } }`), executa com timeout de 10 s (`TOOL_TIMEOUT`), converte `DomainError` em resultado de erro (nunca exceção para o agente) e devolve também os "efeitos": ids de pratos vistos (para validar marcadores) e carrinho atualizado (para `cart_updated`).
- `ctx` contém `sessionId` (as tools de carrinho usam o carrinho da sessão).
- `clear_cart` e `update_cart_item` emitem `cart_updated` também.

### 3. System prompt (`apps/api/src/prompts/system-prompt.ts`)

- Texto exatamente como na SPEC seção 6, com `{now}` (data/hora em `America/Sao_Paulo`, formato pt-BR) e `{cartSummary}` (ex.: "vazio" ou "2 itens de Sertão Arretado, subtotal R$ 54,80"). Função pura, testada.

### 4. Parser de marcadores (`apps/api/src/chat/dish-marker.parser.ts`)

- Classe com estado para streaming: `push(delta): string` devolve o texto seguro para emitir, segurando no buffer qualquer sufixo que possa ser o começo de `[[dish:` ; `flush(): string`. Coleta os ids na ordem, sem repetir.
- Marcadores válidos (`[[dish:<uuid>]]`) são removidos do texto. Também remover espaço duplo que sobrar. Texto que parece marcador mas não é (`[[outra coisa]]`) é emitido normalmente.
- Testes: marcador inteiro, quebrado em 2 e em vários deltas (até 1 caractere por delta), dois marcadores, marcador no fim, `[` solto, uuid inválido.

### 5. `AgentService.run(input, emit, signal)` (`apps/api/src/chat/agent.service.ts`)

Segue os passos 1–8 da SPEC seção 6, mais as decisões abaixo:

- Histórico: últimas 20 mensagens da conversa, cortando do início qualquer mensagem até a primeira `USER` (para nunca enviar `TOOL` órfão ao provedor) (D3.1).
- Ids válidos para cards = ids de pratos que apareceram em resultados de tools **em toda a conversa** (mensagens `TOOL` persistidas + as desta rodada) (D3.2).
- Ao fim de cada iteração com texto, emitir `dish_cards` com os pratos válidos citados (na ordem citada, sem repetição), buscando os dados atuais no banco. Ids desconhecidos são descartados e logados como `possible_hallucination`. Não truncar a quantidade de cards: a avaliação mede a regra dos 3 (D3.3).
- Limite de 6 iterações → texto padrão "Desculpe, não consegui concluir esse pedido. Pode reformular de um jeito mais simples?" emitido como `token`.
- `done` com `usage` somado de todas as iterações e `latencyMs`.
- Logs estruturados (uma linha JSON por mensagem) com `conversationId`, tools chamadas, tokens, latência e ids descartados. Nunca logar a chave.
- Abort: se o `signal` abortar, parar o loop, não persistir nada da rodada e não emitir mais eventos.
- Erro inesperado do provedor: emitir `error` (`LLM_ERROR`, mensagem amigável em pt-BR), não persistir a rodada (D3.4).

### 6. Persistência (`conversation.repository.ts`)

- Conversa criada no início da requisição (para o `meta` ter o id). Se o `conversationId` enviado não existir ou for de outra sessão, criar uma nova silenciosamente e devolver o novo id no `meta` (D3.5).
- Formato do `content` (Json): `USER` → `{ text }`; `ASSISTANT` → `{ text, toolCalls?: [{ id, name, argsJson }], dishIds?: string[] }` com o texto **bruto, com marcadores** (o modelo precisa dos ids no histórico para "quero esse"); `TOOL` → `{ toolCallId, name, result }` (D3.6).
- Todas as mensagens novas numa única transação ao final.
- `GET /chat/:conversationId/messages` (com `X-Session-Id`; conversa de outra sessão → 404 `CONVERSATION_NOT_FOUND`): só `USER` e `ASSISTANT` com texto não vazio, texto sem marcadores e `dishCards` reconstruídos a partir de `dishIds`.

### 7. `ChatController` + SSE (`chat.controller.ts`, `sse.ts`)

- `POST /api/v1/chat`, `SessionGuard`. Validação, rate limit e teto diário respondem **antes** de abrir o stream, como JSON de erro normal (400/429). Depois que o stream abre, erros viram evento `error` seguido do fim do stream (D3.7).
- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`; `res.flushHeaders()`. Formato `event: <tipo>\ndata: <json>\n\n`. Heartbeat `: ping\n\n` a cada 15 s. `req.on('close')` aborta via `AbortController`.
- Rate limit com `@nestjs/throttler`: 15 req/min por IP **e** 15 req/min por `X-Session-Id` só no `/chat` (dois throttlers nomeados com `getTracker` diferente). Resposta `429 RATE_LIMITED` no formato de erro padrão. Configurar `trust proxy` para o IP real atrás do Railway.
- Teto diário: contar mensagens `USER` criadas desde a meia-noite de `America/Sao_Paulo` no banco; se `>= MAX_DAILY_CHAT_REQUESTS` → `429 BUDGET_EXCEEDED` com "A demo atingiu o limite de conversas de hoje. Volte amanhã!" (D3.8).

### 8. Modo demonstração sem chave (D3.9)

Quando `LLM_PROVIDER=fake` em runtime (compose sem chave), o `FakeLlmProvider` sem roteiro usa uma política heurística determinística (`demo-policy.ts`) para a demo funcionar sem LLM:

- Se a última mensagem é do usuário e contém intenção de adicionar ("adiciona", "quero esse", "coloca no carrinho") e há um prato citado pelo assistente no histórico → `add_to_cart` com o último prato citado, quantidade extraída ("2", "duas") ou 1.
- Senão → `search_dishes` com `query` = mensagem e filtros extraídos por regex simples: preço ("até R$ 40", "40 reais"), tempo ("30 min"), tags (vegetariano, vegano, sem glúten, sem lactose, picante, proteico, leve), alergênicos ("sem amendoim", "alergia a camarão"…), categoria (sobremesa, bebida, pizza, lanche, entrada).
- Depois de um resultado de tool: responder com texto curto em pt-BR citando até 3 pratos com nome, restaurante, preço e marcador `[[dish:<id>]]`, ou explicar o erro/ausência de resultados. Depois de `add_to_cart`: confirmar e lembrar do botão "Finalizar pedido".
- Toda resposta do modo demo começa com "(modo demonstração) ".
- `GET /api/v1/health` passa a devolver também `llm: "openai" | "fake"` para o front mostrar o aviso.

### 9. Testes exigidos

- Unit: schemas das 7 tools (válidos e inválidos), labels, `ToolRegistry` (validação, timeout, `DomainError` → resultado), parser de marcadores, system prompt, política demo.
- `AgentService` com `FakeLlmProvider` roteirizado e services reais ou mocks: busca seguida de resposta (sequência exata de eventos); tool com argumento inválido; `DIFFERENT_RESTAURANT` devolvido como resultado e explicado; limite de 6 iterações; id alucinado descartado; abort sem persistência; histórico começando em `USER`.
- E2E: `POST /chat` (fake roteirizado via override do provider) retorna `text/event-stream` com `meta`, `token` e `done` na ordem; segunda mensagem com o mesmo `conversationId` usa o histórico; `GET /chat/:id/messages`; corpo inválido → 400; 16ª requisição no minuto → 429 `RATE_LIMITED`; teto diário baixo → 429 `BUDGET_EXCEEDED`.
- Cobertura ≥ 80% em `src/tools/**` e `src/chat/agent.service.ts` (threshold no Jest).

## Dependências novas permitidas

`zod-to-json-schema`, `@nestjs/throttler`. Outras: registrar no ADR 001.

## ADRs a escrever neste bloco (didáticos, como os existentes)

- `003-loop-de-agente-proprio-sem-framework.md`
- `004-sse-via-post-com-fetch.md`
- `005-checkout-fora-das-tools.md`

## Critérios de aceite

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` passam; cobertura ≥ 80% em `tools/` e `agent.service.ts`.
2. Com a API em modo fake: `curl -N -X POST localhost:3001/api/v1/chat -H 'Content-Type: application/json' -H 'X-Session-Id: <uuid>' -d '{"message":"algo vegetariano até R$ 40"}'` mostra `meta`, `tool_start` (label em pt-BR), `tool_end`, `token`s, `dish_cards` (só pratos vegetarianos ≤ R$ 40) e `done`.
3. Segunda mensagem "adiciona o primeiro" / "quero esse" com o mesmo `conversationId` emite `cart_updated`, e `GET /cart` mostra o item.
4. Nenhum texto emitido em `token` contém `[[dish:`.
5. Nenhum teste chama a API real; nenhum segredo; nenhum `any`.
6. Os 3 ADRs escritos.
