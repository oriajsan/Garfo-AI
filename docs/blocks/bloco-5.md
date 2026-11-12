# Bloco 5 — Avaliação, documentação e polimento

- **Branch:** `feat/evals-docs`, criada a partir de `feat/web`.
- **Referências:** SPEC seções 1 (critérios de pronto), 8 (avaliação), 9 (CI `eval.yml`), 11 (README e currículo); briefings anteriores; `docs/decisions-log.md`.
- **Pronto quando (nesta sessão):** `pnpm eval` está pronto e validado de ponta a ponta em modo fake; `/como-funciona` e README completos, com os números da avaliação marcados como `XX` até o dono rodar o eval com a chave real.

## Tarefas

### 1. Avaliação (`evals/`)

- `evals/cases.json` com 20 casos na distribuição da SPEC: 6 filtros simples, 4 restrições/alergias, 3 carrinho em várias mensagens, 2 conflito de restaurante, 2 sem resultado, 2 fora do escopo, 1 prompt injection. Schema Zod do arquivo em `evals/schema.ts`. Os casos devem usar o seed atual (reequilibrado no bloco 1.1) e ser discriminativos: filtros que de fato eliminam pratos (o script deve imprimir, para cada caso com filtros, quantos pratos do banco passam e quantos não passam; caso em que nada é eliminado é sinal de caso fraco).
- Expectativas da SPEC: `mustCallTools`, `toolArgs` (operadores: `includes`, `lte`, `gte`, `equals`), `recommendedDishesSatisfy` (preço, tags, alergênicos, tempo, checado contra o banco), `maxRecommendations`, `mustNotCallTools`, `cartAfter`, `noHallucinatedDishes`. Casos de "sem resultado" e "fora do escopo" também verificam `maxRecommendations: 0`.
- `evals/run-evals.ts` (`pnpm eval` na raiz): sobe o contexto Nest (sem HTTP) e chama o `AgentService` diretamente, com uma sessão nova por caso (carrinho limpo), coletando os eventos emitidos. Cada expectativa vira um check; um caso passa se todos os checks passam. Taxa de acerto por caso e geral.
- Saída: tabela no terminal e `evals/results/latest.md` com acerto por caso e geral, tokens médios, custo estimado (preço por milhão de tokens via `EVAL_PRICE_INPUT_USD_PER_MTOK` e `EVAL_PRICE_OUTPUT_USD_PER_MTOK`, com padrão documentado), latência p50/p95, modelo usado e data.
- Com `LLM_PROVIDER=fake`, o eval roda usando a política demo e grava em `evals/results/fake-latest.md` (nunca sobrescreve `latest.md`), com um aviso de que não mede o LLM. Serve para validar o harness sem chave (D5.1).
- `evals/results/history.md` com a estrutura pronta para registrar o antes e depois das versões do prompt (v1 = prompt da SPEC), sem números inventados.
- `.github/workflows/eval.yml`: só `workflow_dispatch`, Postgres pgvector como serviço, migrate + seed + embed com a chave real (`secrets.OPENAI_API_KEY`), `pnpm eval`, upload do `latest.md` como artifact.

### 2. Página `/como-funciona`

- Para recrutadores, em pt-BR: o que é o Garfo, diagrama da arquitetura (SVG/HTML próprio ou componente, sem dependência nova de mermaid), as 7 tools com uma linha cada, o fluxo de uma mensagem em 5 passos, como o projeto evita alucinação, por que o checkout não é uma tool, resultado da avaliação (lido de uma constante única `EVAL_RESULT` em `apps/web/src/lib/eval-result.ts`, hoje com `XX` e uma nota "aguardando execução") e link do GitHub. Responsiva e com modo escuro.

### 3. README (pt-BR, estrutura da SPEC seção 11)

- Nome, frase, badges (CI com caminho do workflow, MIT), links para demo e `/como-funciona` (URL da demo como placeholder `https://SEU-DEPLOY.vercel.app` claramente marcado).
- GIF: `docs/demo.gif` referenciado com um comentário HTML `<!-- TODO(owner): gravar o GIF conforme docs/gif-script.md -->`. Criar `docs/gif-script.md` com o roteiro exato (resolução, duração 15–20 s, cada ação com segundos, mensagem exata a digitar, ferramenta sugerida, como otimizar o tamanho).
- O que ele faz (4 itens), arquitetura (mermaid da SPEC + fluxo em 5 passos), decisões técnicas (uma linha por ADR com link), qualidade (tabela do eval com `XX`), como rodar (Docker sem chave; com chave), estrutura de pastas e scripts, próximos passos, autor (placeholders para LinkedIn e portfólio).
- `docs/resume-line.md` com a linha do currículo da SPEC seção 11 e `XX`.

### 4. Revisão de ADRs

- Revisar os ADRs 001–005 para coerência com o que foi implementado (dependências realmente usadas, decisões do `decisions-log.md` relevantes). ADRs novos para qualquer decisão de arquitetura tomada nos blocos 2–4 que ainda não tenha ADR (ex.: embedding fake lexical e hash com modelo; bootstrap do banco no container), se o líder indicar.

## Decisões

- **D5.1** Eval com provider fake grava em arquivo separado, para validar o harness sem chave e sem falsificar o resultado oficial.

## Critérios de aceite

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` passam.
2. `LLM_PROVIDER=fake pnpm eval` roda os 20 casos sem erro de harness e gera `evals/results/fake-latest.md`; `latest.md` não é criado com números falsos.
3. `cases.json` com 20 casos na distribuição exigida, validado pelo schema.
4. `/como-funciona` e README completos; todos os `XX` e placeholders listados no relatório.
5. `eval.yml` válido (sintaxe), só `workflow_dispatch`.
