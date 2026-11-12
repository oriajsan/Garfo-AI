# Linha do currículo

Texto da seção de projetos (SPEC, seção 11). Troque cada `XX` pelo número real do `evals/results/latest.md` depois de rodar `pnpm eval` com a chave da OpenAI. O mesmo número vai para o README e para `apps/web/src/lib/eval-result.ts`.

> **Garfo — Assistente de pedidos com IA** (nov/2026) · [demo](https://SEU-DEPLOY.vercel.app) · [GitHub](https://github.com/oriajsan/Garfo-AI) Agente de IA que recomenda pratos e monta o carrinho a partir de linguagem natural. Loop de tool calling próprio com 7 tools e streaming SSE, busca híbrida (pgvector + filtros estruturados) sobre cardápios, avaliação automatizada com 20 cenários (XX% de acerto), guardrails de custo e prompt injection. NestJS, Next.js, TypeScript, PostgreSQL, Docker, GitHub Actions.

## Checklist depois do eval

- [ ] `XX%` acima (taxa de acerto, de `latest.md`)
- [ ] README: tabela da seção "Qualidade"
- [ ] `apps/web/src/lib/eval-result.ts`: `status: 'done'` e os números
- [ ] `evals/results/history.md`: linha da v1
- [ ] URL da demo (`https://SEU-DEPLOY.vercel.app`) no README e aqui
