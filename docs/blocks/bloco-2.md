# Bloco 2 — Busca e carrinho

- **Branch:** `feat/search-cart`, criada a partir de `feat/foundation` (já com as correções do bloco 1).
- **Referências:** SPEC seções 2, 3, 4, 5, 8 e 9; ADRs 001 e 002; `docs/decisions-log.md`.
- **Pronto quando:** a busca por "vegetariano barato" com filtros devolve pratos coerentes, e o carrinho funciona de ponta a ponta via HTTP.

## Tarefas

### 1. Infra de testes e qualidade

- Jest + ts-jest na API (`apps/api/jest.config.ts` para unit/integração em `src/**/*.spec.ts`; `apps/api/test/jest-e2e.config.ts` para `test/**/*.e2e-spec.ts`). Supertest para e2e.
- Scripts: `test` e `test:e2e` em `@garfo/api` (e `test` no `@garfo/shared` se houver testes lá). Os scripts da raiz já delegam com `pnpm -r --if-present`.
- Cobertura: `test` com `--coverage` coletando de `src/cart/**`, `src/tools/**` e `src/chat/agent.service.ts` (os dois últimos ainda não existem; não falhar por isso). Sem threshold global neste bloco; o threshold de 80% em `cart/` entra agora (`coverageThreshold` por caminho).
- CI (`ci.yml`): após o seed, adicionar `pnpm db:embed` (com `LLM_PROVIDER=fake`), `pnpm test` e `pnpm test:e2e`, antes do build.

### 2. `packages/shared`

- `money.ts`: `reaisToCents(n: number): number` (arredonda para o centavo), `centsToReais(c: number): number`, `formatBRL(c: number): string` → `"R$ 32,90"` (espaço normal, não o `U+00A0` do `Intl`). Com testes unitários (inclui 0, valores com 3 casas, negativos rejeitados ou tratados de forma explícita).
- Schemas Zod e tipos dos DTOs da API: `DishResult`, `RestaurantSummary`, `RestaurantDetail`, `Cart`, `CartItem`, `Checkout`, `ApiError` (`{ error: { code, message } }`), `ERROR_CODES`, e o schema de query da busca (`SearchDishesQuery`). O front e a API usam os mesmos schemas.

### 3. `LlmModule` (`apps/api/src/llm/`)

- Interfaces `LlmProvider` e `EmbeddingProvider` exatamente como na SPEC seção 5, com os tipos `ChatMessage`, `ToolDefinition`, `LlmStreamChunk` (em `llm.types.ts`). Tokens de injeção do Nest (`LLM_PROVIDER`, `EMBEDDING_PROVIDER`).
- `OpenAiLlmProvider` com o SDK oficial `openai`: `chat.completions.create` com `stream: true`, `stream_options: { include_usage: true }`, `temperature: 0.3`, `max_tokens` do input, `tools` no formato `function`. Agregar os deltas de tool call por `index` e emitir um chunk `tool_call` completo por chamada quando o stream terminar; emitir `text` a cada delta de conteúdo; `done` com `usage`. Converter o formato interno `ChatMessage` ↔ formato OpenAI em funções puras testáveis.
- `OpenAiEmbeddingProvider`: `embeddings.create` com o modelo `LLM_EMBEDDING_MODEL` e `dimensions: 1536`.
- `FakeLlmProvider`: recebe um roteiro (lista de "turnos", cada um com texto e/ou tool calls) e devolve um por chamada, em chunks (texto quebrado em pedaços pequenos para simular streaming). Também registra os inputs recebidos (para os testes do bloco 3). O comportamento do fake **em runtime** (demo sem chave) é do bloco 3; aqui, se não houver roteiro, devolver uma resposta de texto fixa avisando que está em modo demonstração.
- `FakeEmbeddingProvider`: determinístico **e lexical** (veja a decisão D2.1): normaliza o texto (minúsculas, sem acentos), quebra em tokens de 3+ letras, faz _feature hashing_ de cada token (sha256 → índice 0..1535 e sinal) e normaliza o vetor (L2). Textos que compartilham palavras ficam próximos.
- Seleção por `LLM_PROVIDER` (`openai` | `fake`). Testes de unidade dos conversores e da agregação de tool calls com um stream simulado; **nenhum teste chama a API real**.
- Cada provider de embedding expõe `modelId` (`"fake-lexical-v1"` ou o nome do modelo real).

### 4. `pnpm db:embed` (`apps/api/scripts/embed-dishes.ts`)

- Seleciona pratos com `embedding IS NULL` **ou** `embeddingHash` diferente de `sha256(modelId + "\n" + embeddingText)` (decisão D2.2). Gera em lotes de 50, grava com `$executeRaw` parametrizado (`::vector`). Imprime quantos pratos foram processados e quantos estavam em dia.
- Roda com o mesmo `validateEnv` da API (usa o provider escolhido por `LLM_PROVIDER`).
- Scripts: `db:embed` no `@garfo/api` e na raiz (com `with-env`); `db:setup` passa a ser migrate + seed + embed.
- Rodar duas vezes seguidas: a segunda não processa nada.

### 5. `CatalogModule`

- `GET /api/v1/restaurants` → lista (sem pratos), ordenada por avaliação desc.
- `GET /api/v1/restaurants/:slug` → restaurante + pratos disponíveis; `404 RESTAURANT_NOT_FOUND` se não existir.
- `GET /api/v1/dishes/search` com a query da SPEC (csv validado contra os enums; `limit` 1–20, padrão 8). Resposta `{ results: DishResult[] }`.
- `SearchService.search(params)` conforme a SPEC seção 5, passos 1–6, num único SQL com `Prisma.sql` (sem concatenação de entrada). Com `q`: `score_final = 0.8 × (1 − distância) + 0.2 × similarity(name, q)`; descartar abaixo do limiar mínimo (decisão D2.3); pratos sem embedding são ignorados quando há `q`. Sem `q`: ordenar por avaliação do restaurante desc e preço asc, `score` = `null`.
- Cache LRU em memória (500 entradas) para embeddings de consultas, implementação própria (`common/lru-cache.ts`, com teste), chave = `modelId + q normalizada`.
- `SearchService` também expõe `getDish(id)` e `getRestaurant(slug)` para o bloco 3.

### 6. `CartModule`

- `cart.rules.ts` com funções puras e 100% testadas: validação de mesmo restaurante, soma de quantidade com limite 10, disponibilidade, cálculo de subtotal/taxa/total, pedido mínimo (`missingCents`). As regras lançam/devolvem `DomainError(code, message, details?)` (classe em `common/`).
- `CartService` (Prisma) + `CartController` com os endpoints da SPEC (`GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`, `DELETE /cart`, `POST /cart/checkout`). Detalhes nas decisões D2.4–D2.9.
- `SessionGuard` (`common/session.guard.ts`): exige `X-Session-Id` UUID nas rotas de carrinho (e, no bloco 3, de chat). Ausente ou inválido → `400 VALIDATION_ERROR`.

### 7. Robustez HTTP

- Filtro global de exceções (`common/filters/`) que sempre devolve `{ error: { code, message } }`, sem stack trace, com o mapeamento de status da decisão D2.8. Erros do Zod viram `400 VALIDATION_ERROR` com mensagem legível.
- `helmet`, CORS restrito a `CORS_ORIGIN`, limite de 10 kB no corpo JSON.
- Swagger + Scalar: OpenAPI gerado com `@nestjs/swagger` + `nestjs-zod` e servido pelo `@scalar/nestjs-api-reference` em `/docs` (fora do prefixo `/api/v1`). Com `helmet` ligado, ajustar a CSP só para essa rota se for necessário para a página carregar.

### 8. Testes exigidos

- Unit: `cart.rules.ts`, `money.ts`, LRU, `FakeEmbeddingProvider` (determinismo e similaridade lexical), conversores/agregação do `OpenAiLlmProvider`, `FakeLlmProvider`.
- Integração (`SearchService` contra o Postgres real, com `FakeEmbeddingProvider`): para várias combinações de filtros (preço, tags, alergênicos excluídos, tempo, categoria, restaurante), **todo** resultado respeita **todos** os filtros, conferido contra os dados; prato indisponível e restaurante fechado nunca aparecem; `limit` respeitado. Os testes **não escrevem embeddings no banco** (o banco local pode ter embeddings reais; decisão D2.10) e pulam com mensagem clara se o banco não estiver acessível só quando rodados fora do CI (no CI devem falhar).
- E2E (Supertest, banco real): adicionar item, somar quantidade, alterar e remover via PATCH, conflito `DIFFERENT_RESTAURANT` (409), `DISH_UNAVAILABLE` (kombucha), checkout abaixo do mínimo (`BELOW_MIN_ORDER` com valor faltante), checkout de carrinho vazio (`CART_EMPTY`), checkout ok (carrinho vira `CHECKED_OUT` e o próximo `GET /cart` vem vazio), header ausente (400), busca via HTTP com filtros, `/health`. Cada teste usa um `X-Session-Id` novo.

## Decisões já tomadas (detalhes em `docs/decisions-log.md`)

- **D2.1** `FakeEmbeddingProvider` lexical (feature hashing de tokens), para a busca fazer sentido sem chave.
- **D2.2** `embeddingHash = sha256(modelId + "\n" + embeddingText)`: trocar de fake para OpenAI força re-embed.
- **D2.3** Limiar mínimo de score: 0,25 com provider real; 0 com o fake. Implementar como propriedade `minRelevanceScore` do `EmbeddingProvider` (0,25 no OpenAI, 0 no fake), sem variável de ambiente nova.
- **D2.4** `GET /cart` sem carrinho aberto devolve um carrinho vazio (`id: null`) sem criar linha. O carrinho é criado no primeiro `POST /cart/items`.
- **D2.5** Quando o último item sai (PATCH 0 ou DELETE), `restaurantId` volta a `null`.
- **D2.6** Somar acima de 10 → `400 VALIDATION_ERROR` ("máximo de 10 unidades por item"). Restaurante fechado conta como `DISH_UNAVAILABLE`.
- **D2.7** Checkout: `CART_EMPTY` se vazio; revalida disponibilidade (`DISH_UNAVAILABLE`); `BELOW_MIN_ORDER` com `missingCents` e mensagem com o valor em reais. Sucesso: `orderId` = id do carrinho, `totalCents`, `estimatedMinutes` = `deliveryMaxMinutes` do restaurante; status vira `CHECKED_OUT`.
- **D2.8** Códigos extras: `RESTAURANT_NOT_FOUND` e `CART_ITEM_NOT_FOUND` (404). Status: `VALIDATION_ERROR` 400, `*_NOT_FOUND` 404, `DIFFERENT_RESTAURANT` e `DISH_UNAVAILABLE` 409, `BELOW_MIN_ORDER` e `CART_EMPTY` 422, `RATE_LIMITED` e `BUDGET_EXCEEDED` 429, erro inesperado 500 `INTERNAL_ERROR`.
- **D2.9** Formato do carrinho (schema em `shared`): `{ id, status, restaurant | null (slug, name, emoji, deliveryFeeCents, minOrderCents, deliveryMinMinutes, deliveryMaxMinutes), items: [{ id, dishId, name, priceCents, quantity, notes, lineTotalCents }], itemCount, subtotalCents, deliveryFeeCents, totalCents, minOrderCents, missingForMinOrderCents }`. Carrinho vazio: taxa 0.
- **D2.10** Testes nunca escrevem embeddings; o CI roda `db:embed` com o fake antes dos testes.
- **D2.11** `money.ts` mora no `shared` (usado pela API e pelo front); `apps/api/src/common/money.ts` só reexporta.

## Dependências novas permitidas

Da seção 3: `openai`, `nestjs-zod`, `@nestjs/swagger`, `@scalar/nestjs-api-reference`, `helmet`, `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`. `zod-to-json-schema` só no bloco 3. Qualquer outra: registrar no ADR 001 (seção de dependências) com o motivo. `@nestjs/testing` é permitido (registrar no ADR 001).

## Critérios de aceite (verificáveis)

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` passam com o banco local migrado, seedado e embedado com o fake.
2. Cobertura de `src/cart/**` ≥ 80%.
3. `pnpm db:embed` duas vezes: a primeira processa 80 pratos (ou os disponíveis), a segunda 0. `pnpm db:setup` = migrate + seed + embed.
4. `curl 'localhost:3001/api/v1/dishes/search?q=vegetariano%20barato&dietaryTags=vegetarian&maxPriceCents=4000'` devolve apenas pratos vegetarianos ≤ R$ 40, com `score`.
5. `curl 'localhost:3001/api/v1/dishes/search?dietaryTags=vegan,gluten_free&excludeAllergens=soy&maxDeliveryMinutes=40'` respeita todos os filtros.
6. Parâmetro inválido (`dietaryTags=xyz`, `limit=50`) → `400 { error: { code: "VALIDATION_ERROR", ... } }`.
7. Fluxo de carrinho via curl conforme a seção "Testes exigidos" com os status e códigos da D2.8.
8. `/docs` abre a referência Scalar listando os endpoints.
9. Nenhum SQL com concatenação de entrada; nenhum `any` explícito; nenhuma migration nova que remova o HNSW (de preferência, nenhuma migration nova).
10. `docs/progress.md` **não** é editado pelo implementer (o líder atualiza); o implementer devolve o relatório.
