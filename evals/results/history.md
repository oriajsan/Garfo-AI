# Histórico das versões do prompt

Registro do antes e depois de cada iteração do system prompt e das descrições das tools. Cada linha vem de uma execução real de `pnpm eval` (arquivo `latest.md` da época). A meta da SPEC (seção 8) é publicar com **85% ou mais** de acerto; abaixo disso, ajustar o prompt ou as descrições das tools e registrar aqui.

Nenhum número foi medido ainda: as células abaixo ficam como `XX` até a primeira execução com a chave real.

## Resumo

| Versão              | Data | Modelo | Acerto geral | Latência p50 / p95 | Custo por caso | O que mudou                                      |
| ------------------- | ---- | ------ | ------------ | ------------------ | -------------- | ------------------------------------------------ |
| v1 (prompt da SPEC) | XX   | XX     | XX% (XX/20)  | XX ms / XX ms      | US$ XX         | System prompt exatamente como na seção 6 da SPEC |

## v1: prompt da SPEC

- **Prompt:** as 9 regras da seção 6 da SPEC, sem alterações.
- **Resultado:** XX/20.
- **Casos que falharam:** XX.
- **Hipótese da falha:** XX.

## Modelo para novas versões (copie e preencha)

```md
## vN: título curto da mudança

- **O que mudou:** trecho do prompt ou da descrição de tool alterado, e por quê.
- **Resultado:** XX/20 (antes: XX/20).
- **Casos que mudaram de falha para acerto:** XX.
- **Casos que regrediram:** XX.
- **Lição:** XX.
```
