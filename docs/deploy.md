# Checklist de deploy

Ordem: **Neon (banco) -> Railway (API) -> Vercel (web) -> verificação final**. A API precisa da URL do front
no `CORS_ORIGIN` e o front precisa da URL da API em `NEXT_PUBLIC_API_URL`; por isso o passo 4 volta ao Railway
para acertar o CORS depois de criar o domínio da Vercel.

Pré-requisitos: repositório no GitHub com o `main` atualizado, contas gratuitas em Neon, Railway e Vercel e uma
chave da OpenAI (opcional: sem ela a demo funciona em modo demonstração, com aviso na interface).

Arquivos de configuração já prontos no repositório:

| Arquivo                         | Para quê                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/api/railway.json`         | Railway constrói `apps/api/Dockerfile` e usa `/api/v1/health` como healthcheck         |
| `apps/web/vercel.json`          | Vercel instala e compila a partir da raiz do monorepo, para achar o `@garfo/shared`    |
| `apps/api/docker-entrypoint.sh` | No start do container: migrations, seed e embeddings (se `DB_BOOTSTRAP_ON_START=true`) |

## 1. Neon (Postgres com pgvector)

1. Em <https://neon.tech>, crie um projeto (região mais próxima do Railway, por exemplo `us-east`), banco `neondb`.
2. Habilite a extensão `vector`. No SQL Editor do Neon:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

3. Em **Connection Details**, copie a connection string **direta** (sem `-pooler`, porque o Prisma usa advisory locks)
   e confirme que termina com `?sslmode=require`:

   ```
   postgresql://USUARIO:SENHA@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

4. Prepare o banco **uma vez**, a partir da sua máquina, apontando para o Neon (migrations, seed e embeddings).
   Para gastar a chave real só uma vez, use `LLM_PROVIDER=openai`; sem chave, use `fake`:

   ```bash
   export DATABASE_URL='postgresql://USUARIO:SENHA@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require'
   export LLM_PROVIDER=openai
   export OPENAI_API_KEY='sk-...'
   export LLM_EMBEDDING_MODEL=text-embedding-3-small
   pnpm install --frozen-lockfile
   pnpm db:setup
   ```

   Esperado no fim: `Seed ok: 6 restaurants, 80 dishes` e `Embeddings (...): 80 processed`.
   Confirme: `psql "$DATABASE_URL" -c 'SELECT count(*) FROM "Dish" WHERE embedding IS NOT NULL;'` deve devolver 80.

> Atenção: se você trocar de `fake` para `openai` depois, rode `pnpm db:embed` de novo. O hash inclui o modelo, então só os
> vetores desatualizados são refeitos.

## 2. Railway (API)

1. Em <https://railway.app>, **New Project -> Deploy from GitHub repo** e escolha `garfo-ai`.
2. No serviço, em **Settings**:
   - **Root Directory**: deixe vazio (o Dockerfile usa a raiz do monorepo como contexto).
   - **Config as Code -> Config file path**: `/apps/api/railway.json`.
3. Em **Variables**, crie (valores de exemplo; `CORS_ORIGIN` provisório até o passo 4):

   | Variável                  | Valor                                                                                            |
   | ------------------------- | ------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`            | a connection string do Neon (com `sslmode=require`)                                              |
   | `LLM_PROVIDER`            | `openai` (ou `fake` para modo demonstração)                                                      |
   | `OPENAI_API_KEY`          | sua chave (marque como secret)                                                                   |
   | `OPENAI_BASE_URL`         | opcional; vazio usa a OpenAI. Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/` |
   | `LLM_CHAT_MODEL`          | modelo pequeno com tool calling (confirme o nome atual na documentação da OpenAI)                |
   | `LLM_EMBEDDING_MODEL`     | `text-embedding-3-small`                                                                         |
   | `EMBEDDING_DIMENSIONS`    | `1536`                                                                                           |
   | `CORS_ORIGIN`             | `http://localhost:3000` por enquanto                                                             |
   | `MAX_DAILY_CHAT_REQUESTS` | `500`                                                                                            |
   | `DB_BOOTSTRAP_ON_START`   | `false` (o banco já foi preparado no passo 1.4)                                                  |

   Para usar o Gemini gratuito, ponha a chave do Gemini em `OPENAI_API_KEY`, defina `OPENAI_BASE_URL`, `LLM_CHAT_MODEL=gemini-3.5-flash-lite` (alternativa mais lenta: `gemini-3.5-flash`),
   `LLM_EMBEDDING_MODEL=gemini-embedding-001` e mantenha `EMBEDDING_DIMENSIONS=1536`. Rode o passo 1.4 (`pnpm db:setup`) com as mesmas
   variáveis exportadas, ou `pnpm db:embed` de novo se o banco já tinha embeddings de outro modelo. No workflow `eval.yml`, crie o secret
   `OPENAI_BASE_URL` (opcional) e as variáveis `LLM_CHAT_MODEL`, `LLM_EMBEDDING_MODEL` e `EVAL_PRICE_*` (0 para o Gemini gratuito).

   Antes de publicar, rode `pnpm llm:smoke` localmente com as mesmas variáveis: ele faz um ciclo de chat com tool call e um embedding,
   mostra requisições e respostas (chave mascarada) e sai com erro se o provedor recusar algo. Em produção, os logs `llm_retry`,
   `llm_http_error` e `chat_error` trazem status e corpo dos erros do provedor.

   Não defina `PORT`: o Railway injeta a porta e a API a respeita.

4. Em **Settings -> Networking**, clique em **Generate Domain**. Anote a URL, por exemplo `https://garfo-api.up.railway.app`.
5. Aguarde o deploy ficar verde (o healthcheck `/api/v1/health` precisa responder 200) e teste:

   ```bash
   curl -s https://garfo-api.up.railway.app/api/v1/health
   # {"status":"ok","db":"ok","llm":"openai"}
   ```

   Defina também um limite mensal de gasto no painel da OpenAI (ex.: US$ 10).

Se preferir que o Railway prepare o banco sozinho, use `DB_BOOTSTRAP_ON_START=true`: a cada start rodam migrate, seed e
embed (idempotentes, sem custo extra depois da primeira vez).

## 3. Vercel (web)

1. Em <https://vercel.com>, **Add New -> Project**, importe `garfo-ai`.
2. **Root Directory**: `apps/web`. Deixe ligada a opção **Include source files outside of the Root Directory**
   (necessária para o `packages/shared`). O `apps/web/vercel.json` já define `installCommand` e `buildCommand`.
3. Em **Environment Variables** (Production), antes do primeiro deploy:

   | Variável                 | Valor                                     |
   | ------------------------ | ----------------------------------------- |
   | `NEXT_PUBLIC_API_URL`    | `https://garfo-api.up.railway.app/api/v1` |
   | `NEXT_PUBLIC_GITHUB_URL` | `https://github.com/oriajsan/Garfo-AI`    |

   Essas variáveis são embutidas no bundle durante o build: se mudar alguma, faça **Redeploy**.

4. Faça o deploy e anote o domínio, por exemplo `https://garfo-ai.vercel.app` (ajuste o nome em **Settings -> Domains**, se quiser).

## 4. Fechando o CORS

Volte ao Railway, em **Variables**, e troque `CORS_ORIGIN` pelo domínio exato da Vercel, sem barra final:

```
CORS_ORIGIN=https://garfo-ai.vercel.app
```

O Railway reinicia o serviço sozinho. Se você usar domínio próprio ou previews da Vercel, só o domínio configurado é aceito.

## 5. Verificação final

Substitua as URLs pelas suas.

```bash
API=https://garfo-api.up.railway.app/api/v1
WEB=https://garfo-ai.vercel.app

# 1) API saudável e provedor correto
curl -s $API/health

# 2) CORS: o domínio do front é aceito...
curl -si -X OPTIONS $API/health -H "Origin: $WEB" -H 'Access-Control-Request-Method: GET' | grep -i access-control-allow-origin
# ...e outro domínio não é liberado: o header, se vier, traz a origem do front, nunca https://exemplo.com (esperado: 0)
curl -si -X OPTIONS $API/health -H 'Origin: https://exemplo.com' -H 'Access-Control-Request-Method: GET' | grep -ci 'access-control-allow-origin: https://exemplo.com'

# 3) Chat em streaming (SSE): deve mostrar meta, tool_start, tool_end, token, dish_cards e done
SID=$(uuidgen)
curl -N -s -X POST $API/chat -H "X-Session-Id: $SID" -H 'Content-Type: application/json' \
  -d '{"message":"Algo vegetariano até R$ 40"}'

# 4) Rate limit: a 16ª requisição no mesmo minuto deve responder 429 RATE_LIMITED
for i in $(seq 1 16); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST $API/chat -H "X-Session-Id: $SID" \
    -H 'Content-Type: application/json' -d '{"message":"oi"}'
done; echo
```

Checklist manual:

- [ ] `$WEB` abre em menos de 5 s e mostra o chat (com "Modo demonstração" só se `LLM_PROVIDER=fake`).
- [ ] Chip "Algo vegetariano até R$ 40" -> indicador de tool -> texto -> cards -> "Adicionar" -> carrinho atualiza (o pedido mínimo do restaurante pode exigir 2 unidades: aumente para 2 e finalize) -> "Finalizar pedido" -> número do pedido.
- [ ] Console do navegador sem erro de CORS.
- [ ] Teto diário: para testar sem gastar, suba temporariamente `MAX_DAILY_CHAT_REQUESTS=1` no Railway, envie 2 mensagens (a segunda deve mostrar o aviso de limite do dia) e volte para `500`.
- [ ] Teste pelo celular (dados móveis, não o Wi-Fi de casa): abra `$WEB`, use o botão flutuante do carrinho e finalize um pedido (se o pedido mínimo exigir, aumente para 2 unidades).
- [ ] Link colado no LinkedIn mostra título e descrição (Open Graph).
- [ ] Nenhum segredo no repositório: `git log -p | grep -i 'sk-'` não deve achar nada.

## Problemas comuns

| Sintoma                                                                 | Causa provável                                                              | Correção                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| Front mostra "Não consegui falar com o servidor" e o console acusa CORS | `CORS_ORIGIN` diferente do domínio do front (barra final, `http` x `https`) | Ajustar a variável no Railway               |
| Front chama `localhost:3001` em produção                                | `NEXT_PUBLIC_API_URL` ausente no build                                      | Definir na Vercel e fazer Redeploy          |
| Healthcheck do Railway falha                                            | `DATABASE_URL` errada ou sem `sslmode=require`; extensão `vector` ausente   | Conferir o passo 1                          |
| Busca sem resultados                                                    | Embeddings não gerados                                                      | Rodar `pnpm db:embed` apontando para o Neon |
| Build da Vercel não acha `@garfo/shared`                                | Opção de incluir arquivos fora do root desligada                            | Ligar em Settings -> General                |
