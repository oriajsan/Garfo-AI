# Linha do currículo

Texto da seção de projetos (SPEC, seção 11). O número vem da execução oficial do `pnpm eval` (`evals/results/latest.md`, 2026-11-12: 18/20 com `gemini-3.5-flash-lite`), o mesmo do README e de `apps/web/src/lib/eval-result.ts`.

> **Garfo — Assistente de pedidos com IA** (nov/2026) · [demo](https://SEU-DEPLOY.vercel.app) · [GitHub](https://github.com/oriajsan/Garfo-AI) Agente de IA que recomenda pratos e monta o carrinho a partir de linguagem natural. Loop de tool calling próprio com 7 tools e streaming SSE, busca híbrida (pgvector + filtros estruturados) sobre cardápios, avaliação automatizada com 20 cenários (90% de acerto), guardrails de custo e prompt injection. NestJS, Next.js, TypeScript, PostgreSQL, Docker, GitHub Actions.

## Checklist depois do eval

- [x] `90%` acima (taxa de acerto, de `latest.md`)
- [x] README: tabela da seção "Qualidade"
- [x] `apps/web/src/lib/eval-result.ts`: `status: 'done'` e os números
- [x] `evals/results/history.md`: versões v1 a v4 (final)
- [ ] URL da demo (`https://SEU-DEPLOY.vercel.app`) no README e aqui
