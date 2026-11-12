# Progresso

## Estado atual (retomada)

> Sessão autônoma do líder técnico (12/11/2026). Processo: briefing em `docs/blocks/bloco-N.md` → implementer → reviewer (máx. 3 ciclos) → atualizar este arquivo. Decisões em `docs/decisions-log.md`; pendências humanas em `docs/pending-human.md`. Nunca push/merge/rebase.

| Bloco                | Branch             | Estado                                                                                                     |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1 — Fundação         | `feat/foundation`  | Aprovado. Correções 1.1 aprovadas (seed: 34 vegetarianos, 17 veganos; coerência tag ⇔ alergênico validada) |
| 2 — Busca e carrinho | `feat/search-cart` | **Em implementação** (`docs/blocks/bloco-2.md`)                                                            |
| 3 — Agente           | `feat/agent`       | Rascunho do briefing pronto (`docs/blocks/bloco-3.md`)                                                     |
| 4 — Front e deploy   | `feat/web`         | Não iniciado                                                                                               |
| 5 — Avaliação e docs | `feat/evals-docs`  | Não iniciado                                                                                               |

**Próximo passo:** verificação final dos critérios de pronto da seção 1 pelo reviewer (em andamento) e depois escrever `docs/morning-report.md`.

## Bloco 1 — Fundação (`feat/foundation`) · 12/11/2026

### Feito

- **Monorepo pnpm** (`apps/api`, `apps/web`, `packages/shared`) com pnpm 9.15.9 fixado em `packageManager` e Node 20 em `.nvmrc`. Veja o [ADR 001](adr/001-monorepo-com-pnpm.md).
- **TypeScript strict** em todo o repositório via `tsconfig.base.json` (com `noUncheckedIndexedAccess`). ESLint (`no-explicit-any` como erro; `recommended-type-checked` na API e no shared; `next/core-web-vitals` no web) e Prettier compartilhados na raiz.
- **`packages/shared`:** enums do catálogo (`DISH_CATEGORIES`, `DIETARY_TAGS`, `ALLERGENS`) como schemas Zod, rótulos em pt-BR e schema da resposta de health.
- **API NestJS 10** com prefixo `/api/v1`:
  - `ConfigModule` global: valida as variáveis com Zod em `src/config/env.ts`. A API não sobe se faltar algo obrigatório, e as credenciais do OpenAI passam a ser obrigatórias quando `LLM_PROVIDER=openai`. A mensagem de erro nunca mostra valores.
  - `PrismaModule` global (`PrismaService` com connect/disconnect nos hooks de ciclo de vida; `enableShutdownHooks` no `main.ts`).
  - `HealthModule`: `GET /api/v1/health` → `200 {"status":"ok","db":"ok"}` ou `503 {"status":"error","db":"error"}`.
- **Prisma 5:** schema da seção 4 e migration inicial `20261112051028_init` com as extensões `vector` e `pg_trgm`, índice HNSW (`dish_embedding_hnsw`), índices GIN (`dish_tags_gin`, `dish_allergens_gin`) e `CHECK (quantity BETWEEN 1 AND 10)`. Veja o [ADR 002](adr/002-pgvector-em-vez-de-banco-vetorial-dedicado.md).
- **Seed determinístico:** `data/seed/restaurants.json` com 6 restaurantes e 80 pratos (13 ou 14 por restaurante). O arquivo é validado com Zod antes de gravar, inclusive a coerência entre tags e alergênicos (um prato "sem lactose" não pode ter `lactose`; um prato vegano também precisa ter `vegetarian` e `lactose_free`) e a variedade mínima da especificação. Ids são UUIDs derivados de hash, então recriar o banco gera os mesmos ids. O seed não chama nenhuma API.

  | Requisito        | Mínimo        | No seed             |
  | ---------------- | ------------- | ------------------- |
  | Vegetarianos     | 15            | 51                  |
  | Veganos          | 8             | 29                  |
  | Sem glúten       | 8             | 39                  |
  | Sem lactose      | 8             | 40                  |
  | Faixa de preço   | R$ 8 a R$ 120 | R$ 8,00 a R$ 119,90 |
  | Tempo de entrega | 20 a 60 min   | 20 a 60 min         |

  Há um prato indisponível de propósito (Kombucha de hibisco, Raiz Verde), para testar `DISH_UNAVAILABLE` no bloco 2. Todos os alergênicos da lista aparecem pelo menos uma vez.

- **Next.js 14** (App Router) com Tailwind 3, paleta laranja própria (`brand-*`) e modo escuro por `prefers-color-scheme`. Só uma página provisória, sem telas.
- **Docker:** `docker-compose.yml` com `db` (pgvector/pgvector:pg16, volume nomeado, healthcheck `pg_isready`) e `api` (Dockerfile multi-stage, `node:20-alpine`, usuário `node`, `NODE_ENV=production`, roda `prisma migrate deploy` ao iniciar, healthcheck no `/api/v1/health`). `.dockerignore` na raiz.
- **`.env.example`** com todas as variáveis da seção 9, sem valores reais.
- **CI** (`.github/workflows/ci.yml`): install → lint → typecheck → migrate → seed → build, com serviço Postgres pgvector e `LLM_PROVIDER=fake`. Um segundo job roda o `gitleaks` no histórico completo.
- **ADRs** 001 (monorepo com pnpm, incluindo as dependências de desenvolvimento fora da seção 3) e 002 (pgvector).

### Verificado nesta sessão

- `pnpm lint`, `pnpm typecheck` e `pnpm build`: ok.
- Os passos do CI rodaram num clone limpo, sem `.env` e contra um banco vazio: tudo ok.
- `docker compose up -d --build` sobe `db` e `api`, e `GET /api/v1/health` responde `200 ok`. Com o banco parado, responde `503`, e volta a `200` quando o banco retorna.
- O seed rodou duas vezes sem duplicar nada, e recriar as tabelas gerou os mesmos ids e textos (mesmo hash).
- Drift do Prisma: só o índice HNSW aparece como diferença (esperado, documentado no ADR 002).
- O CI no GitHub **ainda não rodou**, porque não foi feito push.

### Pendente (próximos blocos)

- Bloco 2: `LlmModule` (OpenAI + Fake), `pnpm db:embed`, busca híbrida, carrinho, Swagger/Scalar. Quando o `db:embed` existir, `pnpm db:setup` deve passar a ser migrate + seed + embed (hoje é só migrate + seed).
- Jest ainda não está configurado: `pnpm test` e `pnpm test:e2e` existem na raiz, mas não fazem nada porque nenhum pacote tem testes. Os testes entram no bloco 2.
- `helmet`, limite de 10 kB no corpo, filtro global de erros e rate limit: blocos 2 e 3.
- Escolher automaticamente `LLM_PROVIDER=fake` quando `OPENAI_API_KEY` estiver vazia (seção 9): hoje o compose usa `fake` como padrão via `${LLM_PROVIDER:-fake}`, e a regra completa entra com o `LlmModule`.
- Serviço `web` no compose e Dockerfile do web: bloco 4.
- O container da API roda as migrations, mas não o seed. Por enquanto, rode `pnpm db:seed` a partir do host (veja abaixo).
- O CI precisa ser confirmado verde no primeiro PR. O `gitleaks-action` é gratuito para contas pessoais; numa organização, ele pede a secret `GITLEAKS_LICENSE`.

### Como testar manualmente

Pré-requisitos: Node 20, pnpm 9 (`corepack enable`) e Docker.

```bash
pnpm install                 # também compila o shared e gera o Prisma Client
cp .env.example .env         # valores de desenvolvimento, sem segredos

# Banco + migration + seed
docker compose up -d db
pnpm db:setup                # migrate deploy + seed (seguro de rodar várias vezes)

# Conferir o banco
docker compose exec db psql -U garfo -d garfo -c 'select count(*) from "Dish"'   # 80
docker compose exec db psql -U garfo -d garfo -c '\di dish_*'                     # hnsw + 2 gin

# API local
pnpm dev:api
curl http://localhost:3001/api/v1/health    # {"status":"ok","db":"ok"}

# Tudo no Docker (critério de pronto do bloco 1)
docker compose up -d --build
curl http://localhost:3001/api/v1/health

# Web (página provisória)
pnpm dev:web                 # http://localhost:3000

# Qualidade
pnpm lint && pnpm typecheck && pnpm build
```

Para ver a validação de ambiente funcionando: `LLM_PROVIDER=openai pnpm dev:api` deve falhar listando `OPENAI_API_KEY` e `LLM_CHAT_MODEL` como obrigatórias.

**Ao criar novas migrations:** use `pnpm db:migrate:dev --name <nome> --create-only`, apague o `DROP INDEX "dish_embedding_hnsw"` que o Prisma vai sugerir e só então aplique (ADR 002).
