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
