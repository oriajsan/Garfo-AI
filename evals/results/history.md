# Histórico das versões do prompt

Registro do antes e depois de cada iteração do system prompt, das descrições das tools e dos critérios do eval. Cada linha vem de uma execução real de `pnpm eval` (arquivo `latest.md` da época). A meta da SPEC (seção 8) é publicar com **85% ou mais** de acerto; abaixo disso, ajustar o prompt ou as descrições das tools e registrar aqui.

## Resumo

| Versão                                             | Data       | Modelo                | Acerto geral | Latência p50 / p95                                    | Chamadas por caso            | Custo por caso         | O que mudou                                                                 |
| -------------------------------------------------- | ---------- | --------------------- | ------------ | ----------------------------------------------------- | ---------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| v1 (prompt da SPEC)                                | 2026-11-12 | gemini-3.5-flash-lite | 90% (18/20)  | 20 892 ms / 37 662 ms (com a pausa do eval, ver nota) | não medido                   | US$ 0 (plano gratuito) | System prompt da seção 6 da SPEC                                            |
| v2 (tags de característica + critério de conflito) | XX         | gemini-3.5-flash-lite | XX% (XX/20)  | XX ms / XX ms (sem a pausa)                           | XX de chat, XX de embeddings | US$ 0 (plano gratuito) | Descrição de `dietary_tags`; critério de conflito por alternativas; medição |

## v1: prompt da SPEC

- **Prompt:** as 9 regras da seção 6 da SPEC, sem alterações. Provedor: Gemini pela camada compatível com a OpenAI (ADR 006), `EVAL_DELAY_MS=2000`.
- **Resultado:** 18/20 (90%), 0 erros de infraestrutura. Tokens médios por caso: 6 293 de entrada e 254 de saída.
- **Casos que falharam:**
  - `simple-spicy-40`: o modelo chamou `search_dishes` com `query: "picante"`, sem `dietary_tags: ["spicy"]`.
  - `conflict-burger-then-hummus`: `finalReplyMentions` falhou.
- **Hipótese da falha:**
  - Spicy: a descrição de `dietary_tags` dizia "Restrições alimentares obrigatórias", e "picante" não soa como restrição. O modelo então jogou a característica no texto livre.
  - Conflito: **falha do critério, não do agente.** Reexecutado 3 vezes, o caso falhou 1 vez, com esta resposta: "O seu carrinho atual é do restaurante **Brasa & Pão**, mas o homus com pão sírio é do **Cedro do Líbano**. Quer que eu esvazie o carrinho atual para começar um pedido no Cedro do Líbano?". A lista de palavras tinha "esvaziar", não "esvazie".
- **Nota sobre a latência:** na v1, a latência por resposta incluía a pausa do `EVAL_DELAY_MS` entre chamadas, até 2 s por chamada depois da primeira. Os números da v1 não são comparáveis com os da v2 em diante.

## v2: tags de característica, critério de conflito e medição

- **O que mudou:**
  - **Tool `search_dishes`:** a descrição de `dietary_tags` diz que o campo cobre restrições **e** características do prato, com o mapeamento (picante/apimentado=spicy, proteico=high_protein, leve=light, vegetariano=vegetarian, vegano=vegan, sem glúten=gluten_free, sem lactose=lactose_free). Também diz para usar a tag, e não só a `query`.
  - **Eval:** os casos de conflito passam se a resposta citar os dois restaurantes envolvidos **ou** usar termos genéricos de conflito por radical (`esvazi`, `troc`, `outr`...). O carrinho continua sem poder misturar restaurantes.
  - **Medição:** a latência é medida sem a pausa do eval, e o relatório passa a mostrar as chamadas ao LLM e os retries 429/503 por caso.
- **Resultado:** XX/20 (antes: 18/20).
- **Casos que mudaram de falha para acerto:** XX.
- **Casos que regrediram:** XX.
- **Lição:** XX.

## Modelo para novas versões (copie e preencha)

```md
## vN: título curto da mudança

- **O que mudou:** trecho do prompt ou da descrição de tool alterado, e por quê.
- **Resultado:** XX/20 (antes: XX/20).
- **Casos que mudaram de falha para acerto:** XX.
- **Casos que regrediram:** XX.
- **Lição:** XX.
```
