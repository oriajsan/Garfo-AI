# Bloco 4 — Front e deploy (preparação)

- **Branch:** `feat/web`, criada a partir de `feat/agent`.
- **Referências:** SPEC seções 3, 6 (eventos SSE), 7 (inteira), 9 (Docker, variáveis, deploy, segurança); `docs/blocks/bloco-2.md` e `bloco-3.md` (contratos de carrinho, eventos e `health.llm`); `docs/decisions-log.md`.
- **Pronto quando (nesta sessão):** `docker compose up --build` sobe `db`, `api` e `web` com um único comando; em `http://localhost:3000` dá para conversar (modo demonstração), ver cards, adicionar ao carrinho e finalizar o pedido. O deploy real fica para o dono do projeto (P4), com configs e checklist prontos.

## Contexto herdado dos blocos 2 e 3 (use, não recrie)

- Contratos em `packages/shared/src/`: `chat.ts` (`chatRequestSchema`, `dishCardSchema`, `chatEventSchema` como união `{ type, data }`; no fio, `event: <type>` + `data: <json de data>`), `cart.ts` (`cartSchema`, `checkoutSchema`, `addCartItemSchema`, `updateCartItemSchema`), `errors.ts` (códigos e status, incluindo `RATE_LIMITED`, `BUDGET_EXCEEDED`, `LLM_ERROR`, `CONVERSATION_NOT_FOUND`), `money.ts` (`formatBRL`), `health.ts` (`llm: "openai" | "fake"`).
- Endpoints: `/api/v1/chat` (SSE, exige `X-Session-Id`; erros antes do stream chegam como JSON `{ error }` com 400/429), `/api/v1/chat/:id/messages`, `/api/v1/cart*`, `/api/v1/restaurants*`, `/api/v1/dishes/search`, `/api/v1/health`.
- O stream pode terminar com `error` sem `done` (ex.: `LLM_ERROR`); o front deve sair do estado `streaming` nos dois casos e também quando o stream fechar sem nenhum dos dois.
- CORS da API aceita só `CORS_ORIGIN` (padrão `http://localhost:3000`).

## Tarefas

### 1. Front (`apps/web/src`)

- Tela `/` exatamente como a SPEC seção 7: layout desktop (chat + carrinho fixo de 360 px à direita, ≥ 1024 px) e celular (chat em tela cheia, botão flutuante do carrinho com contador, drawer de baixo para cima). Topo com "Garfo", link "Como funciona" (a página entra no bloco 5; por ora, link para `/como-funciona` com uma página provisória simples), link do GitHub (`NEXT_PUBLIC_GITHUB_URL`) e botão "Nova conversa".
- Componentes da SPEC: `ChatWindow`, `MessageBubble`, `ToolActivity`, `DishCard`, `CartPanel`, `CheckoutDialog`, `SuggestionChips`, `ErrorBanner`. Comportamentos: Enter envia, Shift+Enter quebra linha, contador de 500, botão parar (aborta o `fetch`), auto-scroll, `aria-live="polite"`.
- Estado: `lib/session.ts`, `lib/sse.ts` (`streamChat` com parse linha a linha e tipos do `shared`, validando cada evento com o schema Zod e ignorando eventos desconhecidos), `lib/api.ts` (REST com `X-Session-Id`, erros no formato `{ error }`), `stores/chat.store.ts`, `stores/cart.store.ts` (zustand), React Query só para REST.
- Reidratação: ao abrir, se houver `conversationId` no `localStorage`, carregar `GET /chat/:id/messages`; 404 → limpar e começar do zero. Carrinho carregado com `GET /cart`.
- `DishCard` "Adicionar" chama `POST /cart/items` direto; erro `DIFFERENT_RESTAURANT` mostra um aviso com opção "Esvaziar carrinho e adicionar" (DELETE + POST) (D4.1).
- `CheckoutDialog`: resumo, confirmação, `POST /cart/checkout`; sucesso mostra número do pedido (8 primeiros caracteres do `orderId`, em maiúsculas) e tempo estimado; `BELOW_MIN_ORDER` mostra quanto falta.
- `ErrorBanner` com textos amigáveis para rede, `RATE_LIMITED`, `BUDGET_EXCEEDED` e `LLM_ERROR`.
- Aviso de modo demonstração: se `GET /health` devolver `llm: "fake"`, faixa discreta "Modo demonstração: respostas roteirizadas, sem IA real." (D4.2).
- Visual: paleta laranja própria já existente (`brand-*`), Inter via `next/font`, modo escuro por `prefers-color-scheme`, foco visível, contraste AA, ícones `lucide-react`, `clsx`. Nada de vermelho característico, logo ou nome do iFood.
- Metadados Open Graph (título, descrição; imagem opcional) e `<html lang="pt-BR">`.
- Formatação de preços com `formatBRL` do `shared`.

### 2. Docker

- `apps/web/Dockerfile` multi-stage (deps → build → runtime) com `output: 'standalone'` do Next, `node:20-alpine`, usuário não root, `NODE_ENV=production`. `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_GITHUB_URL` como `ARG` de build (são embutidas no bundle).
- `docker-compose.yml`: serviço `web` (porta 3000, `depends_on` api saudável, build args com `http://localhost:3001/api/v1`).
- A API, ao iniciar no container, roda `prisma migrate deploy`, depois o seed e o `db:embed` (todos idempotentes) para que `docker compose up` entregue a demo pronta num comando só (critério de pronto 2). Os scripts precisam funcionar na imagem de produção (compilar para JS ou incluir o necessário; sem `tsx` em produção se possível). Controlado por `DB_BOOTSTRAP_ON_START` (padrão `true` no compose) (D4.3).
- `.dockerignore` revisado (`node_modules`, `.env`, `.git`, `dist`, `.next`).

### 3. Configs e checklist de deploy (sem executar)

- `apps/api/railway.json` (ou `railway.toml` na raiz) apontando o Dockerfile da API, healthcheck `/api/v1/health`.
- Config da Vercel para monorepo pnpm com root `apps/web` (o que for necessário para o build achar o `@garfo/shared`: `installCommand`/`buildCommand` em `apps/web/vercel.json`).
- `docs/deploy.md`: checklist passo a passo, em pt-BR, para Neon (criar projeto, habilitar `vector`, pegar a `DATABASE_URL` com `sslmode=require`, rodar `pnpm db:setup` apontando para ele), Railway (variáveis, domínio, healthcheck, `DB_BOOTSTRAP_ON_START=false` porque o setup já foi feito do host), Vercel (root, variáveis, domínio) e a verificação final (CORS, rate limit, teto diário, teste pelo celular). Cada passo com o comando exato.

### 4. Testes

- Front: testes opcionais pela SPEC. Exigido apenas um teste unitário do parser de `lib/sse.ts` (eventos quebrados entre chunks, múltiplos eventos num chunk, evento desconhecido) com Jest no `@garfo/web` (D4.4).

## Decisões

- **D4.1** Conflito de restaurante no botão "Adicionar" é resolvido pelo usuário (esvaziar e adicionar), nunca automaticamente.
- **D4.2** Aviso de modo demonstração baseado em `GET /health`.
- **D4.3** Bootstrap do banco no start do container da API, idempotente, desligável por variável.
- **D4.4** Único teste de front obrigatório: o parser SSE (é a parte com lógica real).

## Dependências novas permitidas

As do front na seção 3 (`zustand`, `@tanstack/react-query`, `react-markdown`, `lucide-react`, `clsx`). Jest no web, se precisar de algo além de `jest`/`ts-jest`, registrar no ADR 001.

## Critérios de aceite

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` passam.
2. Com o banco limpo (`docker compose down -v`), `docker compose up --build` sobe os três serviços saudáveis, a API popula o banco sozinha, e em `http://localhost:3000`: chip "Algo vegetariano até R$ 40" → indicador de tool → texto → cards → "Adicionar" → carrinho atualiza → "Finalizar pedido" → número do pedido.
3. Layout correto em 375 px e em 1280 px (o reviewer confere o HTML/CSS e, se possível, screenshots com o Chrome headless).
4. `docs/deploy.md`, `railway.json` e config da Vercel presentes e coerentes com as variáveis da seção 9.
5. Nenhum segredo, nenhum `any`.
