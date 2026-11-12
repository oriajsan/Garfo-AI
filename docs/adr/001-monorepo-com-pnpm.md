# ADR 001 — Monorepo com pnpm workspaces

- **Status:** aceito
- **Data:** 12/11/2026
- **Bloco:** 1 (Fundação)

## Contexto

O Garfo tem três partes que evoluem juntas:

- a API NestJS (`apps/api`), que executa o agente, a busca e o carrinho;
- o front Next.js (`apps/web`), que mostra o chat e o carrinho;
- os contratos entre os dois (`packages/shared`): schemas Zod, enums do catálogo e, nos próximos blocos, os tipos dos eventos SSE.

Se cada parte ficasse num repositório separado, toda mudança de contrato (por exemplo, um campo novo no evento `dish_cards`) exigiria publicar um pacote, atualizar a versão nos outros repositórios e coordenar PRs. Num projeto de uma pessoa, com prazo de cinco dias, esse custo não se paga.

## Decisão

Um único repositório com **pnpm workspaces**:

```
apps/api         -> @garfo/api
apps/web         -> @garfo/web
packages/shared  -> @garfo/shared (dependência "workspace:*" dos dois apps)
```

- A versão do pnpm fica fixada em `packageManager` no `package.json` raiz (`pnpm@9.15.9`), e a do Node em `.nvmrc` (20.19). O piso 20.19 existe porque o `@scalar/nestjs-api-reference@1.0.31` depende de pacotes ESM e só funciona com `require` de ESM, disponível sem flag a partir do Node 20.19.
- TypeScript `strict` vem de um `tsconfig.base.json` único, que cada pacote estende.
- ESLint e Prettier são configurados uma vez na raiz (`.eslintrc.cjs`, `.prettierrc.json`); cada pacote só acrescenta o que é dele (regras com checagem de tipos na API e no shared, `next/core-web-vitals` no web).
- Os scripts da raiz (`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`) usam `pnpm -r`, que roda em todos os pacotes **em ordem topológica**: o `shared` é compilado antes de quem depende dele.
- O `shared` é compilado para CommonJS em `dist/` (o NestJS roda em CommonJS). O script `prepare` compila o pacote logo após o `pnpm install`, então os apps já enxergam os tipos sem passo manual. O Next consome o mesmo pacote via `transpilePackages`.

### Variáveis de ambiente num lugar só

Há um único `.env` na raiz (modelo em `.env.example`). Como o Prisma CLI e o Next só procuram `.env` na pasta do próprio pacote, os scripts da raiz passam por `scripts/with-env.mjs`, um arquivo de 20 linhas que carrega o `.env` da raiz com `process.loadEnvFile` (nativo no Node 20) e executa o comando. Variáveis já definidas no ambiente têm prioridade, então CI e Docker não são afetados.

## Alternativas consideradas

| Alternativa                               | Por que não                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositórios separados (polyrepo)         | Contratos duplicados ou publicados como pacote; PRs coordenados; mais atrito sem benefício para uma equipe de uma pessoa.                                                                             |
| npm ou Yarn workspaces                    | Funcionariam, mas o pnpm é mais rápido, economiza disco com o store global e é **estrito**: um pacote só importa o que declarou, o que evita dependências "fantasmas" que quebram no Docker.          |
| Turborepo ou Nx por cima do pnpm          | Cache de tarefas e grafo de dependências são úteis em monorepos grandes. Com três pacotes, `pnpm -r` já resolve a ordem de build, e uma ferramenta a mais seria uma dependência a mais para explicar. |
| Sem pacote compartilhado (tipos copiados) | Front e API divergiriam em silêncio. Com o `shared`, uma mudança de schema quebra o `typecheck` dos dois lados.                                                                                       |

## Consequências

- **Positivas:** uma mudança de contrato é um único commit; o CI valida tudo junto; um `pnpm install` prepara o projeto inteiro.
- **Negativas:** o `shared` precisa ser compilado antes do `typecheck` dos apps (resolvido pelo `prepare` e pela ordem topológica). O Dockerfile da API instala o workspace inteiro no estágio de build e usa `pnpm deploy --prod` para gerar uma imagem final só com as dependências de produção.
- **Para explicar em entrevista:** "workspace" é só um jeito de o gerenciador de pacotes linkar pacotes locais entre si; o ganho real é ter os contratos tipados compartilhados entre front e back.

## Dependências de desenvolvimento fora da lista da seção 3

A seção 2 da especificação pede registro de qualquer dependência fora da lista da seção 3. Todas abaixo são de desenvolvimento ou de build e não vão para o código de produção (exceto onde indicado).

| Pacote                                                              | Onde           | Motivo                                                                                                                                             |
| ------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`     | raiz           | Necessários para o ESLint entender TypeScript e para as regras `recommended-type-checked` exigidas na seção 8.                                     |
| `eslint-config-prettier`                                            | raiz           | Desliga regras do ESLint que brigam com o Prettier, para os dois conviverem sem conflito.                                                          |
| `eslint-config-next`                                                | web            | Fornece o preset `next/core-web-vitals` exigido na seção 8.                                                                                        |
| `@nestjs/cli`, `@nestjs/schematics`                                 | api            | Ferramenta oficial de build e modo watch do NestJS (`nest build`, `nest start --watch`).                                                           |
| `tsx`                                                               | api            | Executa `prisma/seed.ts` (e, no bloco 2, `scripts/embed-dishes.ts`) direto em TypeScript, sem compilar antes. Mais rápido e simples que `ts-node`. |
| `postcss`, `autoprefixer`                                           | web            | Exigidos pelo Tailwind 3 para processar o CSS.                                                                                                     |
| `@types/node`, `@types/express`, `@types/react`, `@types/react-dom` | vários         | Tipos para o modo `strict`.                                                                                                                        |
| `reflect-metadata`, `rxjs`, `@nestjs/platform-express`              | api (produção) | Dependências obrigatórias do próprio NestJS 10.                                                                                                    |

### Versões e escolhas de ferramental

- **ESLint 8.57 (configuração `.eslintrc`)**, e não ESLint 9 com _flat config_: o `eslint-config-next` 14, que acompanha o Next 14 fixado na especificação, só tem suporte completo ao formato antigo. Atualizar o ESLint fica para quando o projeto subir para o Next 15.
- **`ConfigModule` próprio, sem `@nestjs/config`:** o módulo tem cerca de 30 linhas (schema Zod em `config/env.ts`, um `ConfigService` tipado e um provider global). Evita uma dependência e deixa explícito que a API não sobe com variável inválida.
- **Health check sem `@nestjs/terminus`:** `GET /api/v1/health` faz `SELECT 1` no banco e devolve `200 { status: 'ok', db: 'ok' }` ou `503 { status: 'error', db: 'error' }`. O status 503 permite que Docker e Railway detectem a API sem banco.

### Bloco 2: busca, carrinho e qualidade

Da lista da seção 3 (sem registro necessário): `openai`, `nestjs-zod`, `@nestjs/swagger`, `@scalar/nestjs-api-reference`, `helmet`, `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`. Fora da lista:

| Pacote            | Onde              | Motivo                                                                               |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `@nestjs/testing` | api (dev)         | Monta o `AppModule` real nos testes e2e com Supertest.                               |
| `ts-node`         | api, shared (dev) | O Jest só lê `jest.config.ts` (pedido no briefing) se o `ts-node` estiver instalado. |

Versões fixadas por compatibilidade com Node 20 e Nest 10:

- **`openai@^4`**: as versões 5 em diante exigem Node 22; o projeto fixa Node 20 LTS (seção 3). A API usada (`chat.completions.create` com `stream: true`, `embeddings.create`) é a mesma.
- **`@scalar/nestjs-api-reference@1.0.31`** (exata): versões mais novas declaram `engines.node >= 22`. A 1.0.31 é a última que aceita Node 20. Ela depende de pacotes ESM; funciona em runtime no Node 20.19+ (`require` de ESM), e por isso o teste e2e substitui só esse módulo por um stub (o Jest roda em CommonJS).
- **`@nestjs/swagger@^7`**: a linha compatível com Nest 10.
- **`nestjs-zod@^5`** com `zod@^3.25`: gera o OpenAPI a partir dos mesmos schemas Zod do `packages/shared`.

### Bloco 3: agente

Ambas as dependências estão permitidas pelo briefing do bloco 3 (e `@nestjs/throttler` consta na lista da seção 3 da SPEC). Registradas aqui por completude:

| Pacote                | Onde | Motivo                                                                                                                                                                                                            |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod-to-json-schema`  | api  | Converte o schema Zod de cada tool no JSON Schema que os provedores de LLM esperam (SPEC seção 6), mantendo uma única fonte de verdade para validação e para a definição da tool.                                 |
| `@nestjs/throttler@6` | api  | Rate limit de 15 req/min por IP e por sessão só em `POST /chat` (SPEC seção 6). A linha 6 aceita Nest 10 e Node 20; usada com dois _throttlers_ nomeados e um guard próprio que responde `RATE_LIMITED` em pt-BR. |
