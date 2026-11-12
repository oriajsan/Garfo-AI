# Garfo AI

A especificação completa está em docs/SPEC.md e é a fonte de verdade.
Leia-a inteira antes de qualquer tarefa e siga as regras da seção 2.
Trabalhe um bloco do cronograma (seção 10) por vez e pare para revisão ao final.
Nunca commite segredos. Testes nunca chamam a API real do LLM.

## Migrations (atenção)

O índice vetorial `dish_embedding_hnsw` é SQL manual (ADR 002) e o Prisma não o conhece.
Toda nova migration deve ser criada com `pnpm db:migrate:dev --name <nome> --create-only`;
abra o `migration.sql` gerado, **apague o `DROP INDEX "dish_embedding_hnsw"`** que o Prisma
sugere e só então aplique. Nunca aplique uma migration que remova esse índice.

## Fluxo de trabalho

- Briefings de cada bloco ficam em `docs/blocks/bloco-N.md`; decisões de detalhe em
  `docs/decisions-log.md`; o que depende do dono do projeto em `docs/pending-human.md`.
- O estado atual e o próximo passo estão sempre em `docs/progress.md`.
