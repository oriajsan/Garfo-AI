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

- A versão do pnpm fica fixada em `packageManager` no `package.json` raiz (`pnpm@9.15.9`), e a do Node em `.nvmrc` (24; veja a nota de 2026-11 ao final). O piso 20.19 (histórico) existia porque o `@scalar/nestjs-api-reference@1.0.31` depende de pacotes ESM e só funciona com `require` de ESM, disponível sem flag a partir do Node 20.19.
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

### Bloco 4: front e deploy

`zustand`, `@tanstack/react-query`, `react-markdown`, `lucide-react` e `clsx` constam na lista da seção 3 (sem registro necessário). Fora da lista, só ferramental de teste no web:

| Pacote                                      | Onde      | Motivo                                                                                                         |
| ------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `jest`, `ts-jest`, `@types/jest`, `ts-node` | web (dev) | Teste do parser SSE (D4.4). Mesmo conjunto da API e do shared; o `ts-node` é para o Jest ler `jest.config.ts`. |

Escolhas de ferramental do bloco:

- **`output: 'standalone'` com `experimental.outputFileTracingRoot` na raiz do repositório:** num monorepo pnpm, o rastreamento de arquivos do Next precisa partir da raiz para copiar o `packages/shared` e os pacotes do store do pnpm; o servidor fica em `apps/web/server.js` dentro da imagem.
- **Seed e `db:embed` compilados para JS na imagem da API** (`tsconfig.bootstrap.json`, saída em `dist-bootstrap/`), em vez de levar o `tsx` para produção. O caminho do JSON do seed vem de `SEED_PATH` na imagem.
- **Ícones de marca:** o `lucide-react` atual não traz o logo do GitHub; foi usado um SVG inline em vez de uma dependência extra.

### Bloco 5: avaliação e documentação

Nenhuma dependência nova de fora do repositório. O workspace `evals/` virou um pacote (`@garfo/evals`, listado em `pnpm-workspace.yaml`) que **reaproveita** pacotes já instalados:

| Pacote                                  | Onde                       | Motivo                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/core`, `@nestjs/common`, `zod` | evals (produção do pacote) | Subir o contexto Nest sem HTTP (`NestFactory.createApplicationContext`) e validar `cases.json`. Mesmas versões da API.                                                                                                                      |
| `jest`, `ts-jest`, `@types/jest`        | evals (dev)                | Testes do próprio harness (checagens, relatório, schema dos casos), sem LLM e sem banco.                                                                                                                                                    |
| `ts-node`                               | evals (dev)                | Executa `run-evals.ts`. O `tsx` não serve aqui: ele usa esbuild, que **não emite `emitDecoratorMetadata`**, e sem esses metadados a injeção de dependência do Nest não funciona. O `ts-node` compila com o `tsc` e preserva os decoradores. |

Um pacote próprio (em vez de um script solto em `evals/`) existe por causa do pnpm estrito: um arquivo na raiz só enxerga as dependências da raiz. O `pnpm eval` da raiz repassa o `.env` pelo `scripts/with-env.mjs` e chama o script do pacote.

## Nota (2026-11): migração para o Node 24

O projeto agora roda no **Node 24**: `engines.node` em `>=24 <25` em todos os `package.json`, `.nvmrc` em `24` e imagens `node:24-alpine`. O motivo foi a Vercel, que encerrou o suporte ao Node 20 (fora de suporte desde abril de 2026) e recusava o deploy com o piso `>=20.19 <21`.

Os pinos de `openai@^4` e do `@scalar/nestjs-api-reference@1.0.31` foram **mantidos de propósito**: esta migração não muda a versão major de nenhuma dependência. O Node 24 já atende ao requisito de Node 22 das versões novas, então liberá-los é possível, mas fica como pendência para uma tarefa própria. O texto acima sobre o Node 20 descreve o contexto da época.
