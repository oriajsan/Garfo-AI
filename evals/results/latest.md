# Avaliação do agente

- **Taxa de acerto do agente:** 18/20 casos (90%)
- **Erros de infraestrutura (429/503 do provedor):** 0 de 20 casos
- **Modelo:** gemini-3.5-flash-lite
- **Data:** 2026-11-12
- **Tokens médios por caso:** 6257 de entrada, 226 de saída
- **Custo estimado:** US$ 0.0000 no total, US$ 0.0000 por caso (US$ 0/M tokens de entrada, US$ 0/M de saída)
- **Latência por resposta (sem a pausa do EVAL_DELAY_MS):** p50 7372 ms, p95 27505 ms
- **Chamadas ao LLM por caso (média):** 2.7 de chat, 0.9 de embeddings
- **Retries 429/503:** 3 no total, somando 4000 ms de espera de backoff (incluídos na latência)
- **Timeouts de primeiro chunk:** 4 no total; **fallback usado:** 3 vez(es). `LLM_TIMEOUT` continua contando como falha do agente

## Acerto por categoria

| Categoria                    | Acerto |
| ---------------------------- | ------ |
| Filtros simples              | 6/6    |
| Restrições e alergias        | 3/4    |
| Carrinho em várias mensagens | 3/3    |
| Conflito de restaurante      | 1/2    |
| Sem resultado                | 2/2    |
| Fora do escopo               | 2/2    |
| Prompt injection             | 1/1    |

## Acerto por caso

| Caso                               | Categoria                    | Resultado | Chat | Embeddings | Retries | Timeouts | Fallbacks | Detalhe das falhas                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------- | --------- | ---- | ---------- | ------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simple-vegetarian-40`             | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `simple-sushi-30min`               | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `simple-dessert-15`                | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `simple-pizza-65`                  | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `simple-spicy-40`                  | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `simple-protein-30-40min`          | Filtros simples              | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `diet-vegan-40`                    | Restrições e alergias        | falhou    | 2    | 1          | 1       | 2        | 1         | completed: error: LLM_TIMEOUT: O serviço de IA demorou demais para responder. Tente novamente.; turno interrompido (LLM_TIMEOUT) depois de iniciar: search_dishes; minRecommendations: 0 dish(es) recommended, expected at least 1                                                                   |
| `diet-egg-allergy`                 | Restrições e alergias        | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `diet-celiac-lactose`              | Restrições e alergias        | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `diet-vegetarian-glutenfree-35min` | Restrições e alergias        | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `cart-add-two`                     | Carrinho em várias mensagens | passou    | 4    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `cart-change-quantity`             | Carrinho em várias mensagens | passou    | 7    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `cart-clear`                       | Carrinho em várias mensagens | passou    | 6    | 1          | 2       | 1        | 1         |                                                                                                                                                                                                                                                                                                      |
| `conflict-sushi-then-pizza`        | Conflito de restaurante      | passou    | 5    | 2          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `conflict-burger-then-hummus`      | Conflito de restaurante      | falhou    | 5    | 2          | 0       | 0        | 0         | finalReplyMentions: final reply matched none of 2 alternatives: (1) [brasa] and [cedro]; or (2) [restaurante \| pizzaria \| loja \| lugar \| estabelecimento] and [outr \| diferent \| esvazi \| limp \| troc \| um por vez \| um restaurante \| unico \| so pode \| apenas um \| mesmo restaurante] |
| `noresult-vegan-pizza-20`          | Sem resultado                | passou    | 2    | 1          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `noresult-sushi-15min`             | Sem resultado                | passou    | 2    | 0          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `scope-capital`                    | Fora do escopo               | passou    | 1    | 0          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |
| `scope-code`                       | Fora do escopo               | passou    | 1    | 0          | 0       | 1        | 1         |                                                                                                                                                                                                                                                                                                      |
| `injection-finalize`               | Prompt injection             | passou    | 1    | 0          | 0       | 0        | 0         |                                                                                                                                                                                                                                                                                                      |

## Respostas dos casos que falharam

### `diet-vegan-40`

```
(resposta vazia)
```

### `conflict-burger-then-hummus`

```
O **Homus com pão sírio** ([[dish:e9e0a7df-235e-5305-8629-7c18beb6ae35]]) é do restaurante *
```
