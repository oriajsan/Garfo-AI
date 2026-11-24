# Pendências que dependem do dono do projeto

Itens que o líder técnico não pode resolver sozinho (chaves, contas externas, gravação).
Os comandos exatos ficam em `docs/morning-report.md` ao final da sessão autônoma.

| #   | Item                                                                                                                                                                    | Motivo                                                                   | Bloco |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| P1  | Criar a chave (OpenAI ou Gemini gratuito, ADR 006) e preencher o `.env` (`LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `LLM_CHAT_MODEL`; no Gemini também `OPENAI_BASE_URL`) | Não há chave no ambiente; tudo foi desenvolvido com os provedores falsos | 2     |
| P2  | Rodar `pnpm db:embed` com a chave real                                                                                                                                  | Gera os embeddings reais dos pratos (custo de frações de centavo)        | 2     |
| P3  | Teste manual do `/chat` com o LLM real                                                                                                                                  | Só foi testado com `FakeLlmProvider`                                     | 3     |
| P4  | Deploy no Neon, Railway e Vercel                                                                                                                                        | Exige contas e credenciais                                               | 4     |
| P5  | Rodar `pnpm eval` e preencher os `XX` no README e na linha do currículo                                                                                                 | Exige a chave real                                                       | 5     |
| P6  | Gravar o GIF do README                                                                                                                                                  | Exige a demo rodando com o LLM real                                      | 5     |
| P7  | Push das branches, PRs e merges em sequência ("Create a merge commit")                                                                                                  | Regra da sessão: nunca push/merge/rebase                                 | todos |

## Atualização em 2026-11-12

- **P1, P2, P3 e P5 concluídos** com o Gemini (ADR 006). O eval oficial deu 18/20 (90%) e os `XX` foram preenchidos no README, em `docs/resume-line.md` e em `apps/web/src/lib/eval-result.ts`.
- **Pendentes:** P4 (deploy; depois dele, trocar `https://SEU-DEPLOY.vercel.app` no README e em `docs/resume-line.md`), P6 (GIF) e P7 (push e PRs).
- **Ponto a investigar, sem prazo:** resposta cortada em `conflict-burger-then-hummus` (detalhes em `evals/results/history.md`, v4).

## Atualização em 2026-11-13

- **P4 concluído:** a demo está em <https://garfo-ai.vercel.app> (API na Railway, banco no Neon). A URL substituiu o placeholder no README (demo e `/como-funciona`) e em `docs/resume-line.md`.
- **Pendentes:** P6 (GIF) e o link do LinkedIn (`SEU-PERFIL`) no README.
