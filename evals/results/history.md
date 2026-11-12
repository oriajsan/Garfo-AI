# Histórico das versões do prompt

Registro do antes e depois de cada iteração do system prompt, das descrições das tools e dos critérios do eval. Cada linha vem de uma execução real de `pnpm eval` (arquivo `latest.md` da época). A meta da SPEC (seção 8) é publicar com **85% ou mais** de acerto; abaixo disso, ajustar o prompt ou as descrições das tools e registrar aqui.

## Resumo

| Versão                                             | Data       | Modelo                                                 | Acerto geral                        | Latência p50 / p95                                    | Chamadas por caso              | Custo por caso         | O que mudou                                                                 |
| -------------------------------------------------- | ---------- | ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------- | ------------------------------ | ---------------------- | --------------------------------------------------------------------------- |
| v1 (prompt da SPEC)                                | 2026-11-12 | gemini-3.5-flash-lite                                  | 90% (18/20)                         | 20 892 ms / 37 662 ms (com a pausa do eval, ver nota) | não medido                     | US$ 0 (plano gratuito) | System prompt da seção 6 da SPEC                                            |
| v2 (tags de característica + critério de conflito) | 2026-11-12 | gemini-3.5-flash-lite                                  | **95% (19/20)** (resultado oficial) | 21 315 ms / 57 522 ms (sem a pausa)                   | 2,8 de chat, 0,8 de embeddings | US$ 0 (plano gratuito) | Descrição de `dietary_tags`; critério de conflito por alternativas; medição |
| v3 (timeout com fallback + reasoning_effort)       | 2026-11-12 | gemini-3.5-flash-lite (fallback gemini-3.1-flash-lite) | **95% (19/20)**                     | 8 183 ms / 31 855 ms (sem a pausa)                    | 2,8 de chat, 0,9 de embeddings | US$ 0 (plano gratuito) | Timeout de 15 s no primeiro chunk com fallback; `reasoning_effort=minimal`  |
| v4 (final, oficial)                                | 2026-11-12 | gemini-3.5-flash-lite (fallback gemini-3.1-flash-lite) | **90% (18/20)**                     | 7 372 ms / 27 505 ms (sem a pausa)                    | 2,7 de chat, 0,9 de embeddings | US$ 0 (plano gratuito) | Contadores e rastro parcial corrigidos no eval; prompt e tools iguais à v3  |

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
- **Resultado:** **19/20 (95%)**, antes 18/20. Esse é o resultado oficial. 0 erros de infraestrutura. Tokens médios por caso: 6 622 de entrada e 226 de saída. Chamadas por caso: 2,8 de chat e 0,8 de embeddings (de 1 nos casos fora do escopo a 7 em `cart-change-quantity`).
- **Casos que mudaram de falha para acerto:**
  - `simple-spicy-40`: agora usa `dietary_tags: ["spicy"]`.
  - `conflict-burger-then-hummus`: passou pelo critério novo.
- **Casos que regrediram:** `diet-egg-allergy`. Falhou por **timeout do provedor**, não por decisão errada do agente.
  - O caso fez 1 embedding e 2 chamadas de chat. O `search_dishes` rodou, e a segunda chamada, a que vem depois do resultado da tool, ficou sem resposta até o limite de 90 s por turno do eval.
  - O agente só grava o turno inteiro no fim. Como o turno foi abortado, o eval não viu nenhuma tool call e reportou também `mustCall:search_dishes: not called`. A causa única é o timeout.
  - O caso passou na v1, e a descrição de tool alterada na v2 não toca em alergênicos.
  - **Não foi reclassificado como infraestrutura:** a regra da D6.9 só exclui 429/503, e o número oficial continua 19/20.
- **Latência:** p50 de 21 s e p95 de 58 s sem a pausa. Ela variou de 3 s a 73 s em casos idênticos de 2 chamadas, sem nenhum 429/503. Isso indica enfileiramento no plano gratuito, não custo do agente. (O relatório da v2 dizia "0 retries 429/503", mas esse contador não funcionava; ver a nota na v3. A classificação de infraestrutura, que usa os códigos de erro, não foi afetada.)
  - Medição isolada antes da v3 (`EVAL_ONLY=simple-vegetarian-40 EVAL_REPEAT=5`): 5/5, 2 chamadas de chat por execução, latência de 2,4 s a 21,2 s, p50 5,8 s, p95 21,2 s.
- **Lição:**
  - Descrever as características do prato como tags resolveu o caso picante.
  - Critérios de texto precisam aceitar variações; o nome dos restaurantes é um sinal mais estável que uma lista de verbos.
  - No plano gratuito, a variância de latência do provedor domina. Os próximos passos atacam isso: `reasoning_effort`, timeout com modelo de fallback e aviso de lentidão no front.

## v3: latência do plano gratuito (timeout com fallback)

- **O que mudou:** `reasoning_effort=minimal` no Gemini; timeout de 15 s até o **primeiro chunk** de cada chamada de chat, com uma repetição no `gemini-3.1-flash-lite` (`LLM_FALLBACK_MODEL`); aviso de lentidão no front. Prompt e tools iguais aos da v2.
- **Escopo do timeout:** ele vale **só para o primeiro chunk** (abertura do stream mais o primeiro token). Depois que a resposta começa a chegar, nada é cortado nem refeito, para não duplicar texto. Uma resposta que começa rápido e demora para terminar não é afetada.
- **Resultado:** **19/20 (95%)**, igual à v2. 0 erros de infraestrutura. Tokens médios por caso: 6 652 de entrada e 224 de saída. Chamadas por caso: 2,8 de chat e 0,9 de embeddings.
- **Casos que mudaram de falha para acerto:** `diet-egg-allergy` (timeout do provedor na v2).
- **Casos que regrediram:** `simple-dessert-15`, com `LLM_TIMEOUT` no modelo principal **e** no fallback. É uma falha do provedor, mas conta como falha do agente (D6.15). O relatório também acusou `search_dishes not called`. O caso fez 1 embedding, então a busca provavelmente rodou antes do timeout. É o mesmo efeito da persistência só no fim do turno visto na v2, corrigido para a execução final com o rastro parcial de tools.
- **Latência:** **o p50 caiu de 21,3 s (v2) para 8,2 s e o p95 de 57,5 s para 31,9 s.** A melhora é atribuída ao timeout com fallback: chamadas que ficariam presas na fila do plano gratuito passam a ser cortadas em 15 s e repetidas em outro modelo.
  - **Ressalvas:**
    - Os contadores de retries, timeouts e fallbacks da v2 e da v3 marcaram 0, mas o log mostrou fallback em uso. Causa: o `Test.createTestingModule(...).compile()` do eval troca o logger global por um que descarta avisos, e o observador nunca recebeu nenhum evento. Corrigido para a execução final (`8c8d228`). Não sabemos quantas chamadas o fallback salvou na v3, nem se houve retries na v2 e na v3.
    - A fila do provedor varia com o horário.
    - A medição isolada do `reasoning_effort` não mostrou efeito, o que reforça a atribuição ao timeout com fallback, mas não a prova.
- **Lição:**
  - Com provedor gratuito, cortar a cauda da latência (timeout no primeiro chunk com um modelo alternativo) rendeu mais que ajustar o raciocínio do modelo.
  - Métricas de infraestrutura precisam ser contadas também nos turnos que falham, senão escondem justamente os casos que importam.

## v4: execução final (resultado oficial)

- **O que mudou:** nada no agente. Prompt, tools e configuração são os mesmos da v3. Só o eval mudou: os contadores de retries, timeouts e fallbacks passaram a funcionar (`8c8d228`), e turnos interrompidos registram as tools iniciadas. Combinado antes de rodar: **este é o resultado oficial, seja qual for, e não há mais ciclos de ajuste.**
- **Resultado:** **18/20 (90%)**, antes 19/20 na v3. 0 erros de infraestrutura. Tokens médios por caso: 6 257 de entrada e 226 de saída. Chamadas por caso: 2,7 de chat e 0,9 de embeddings. Latência p50 7,4 s e p95 27,5 s, sem a pausa.
- **Provedor (primeira medição confiável):**
  - 3 retries 429/503, somando 4 s de backoff.
  - 4 timeouts de primeiro chunk e 3 usos do fallback. O fallback salvou 2 casos, `cart-clear` e `scope-code`.
  - Em `diet-vegan-40`, o timeout aconteceu no modelo principal e no fallback.
- **Casos que falharam:**
  - `diet-vegan-40`: `LLM_TIMEOUT` no principal e no fallback, depois de iniciar `search_dishes` (o rastro parcial mostra que a busca rodou). Falha do provedor que conta como falha do agente (D6.15).
  - `conflict-burger-then-hummus`: resposta truncada no meio da frase pelo provedor, com o agente correto (análise abaixo).
- **Casos que mudaram em relação à v3:**
  - `simple-dessert-15` voltou a passar (era timeout na v3).
  - `diet-vegan-40` e `conflict-burger-then-hummus` passaram a falhar.
  - Com 20 casos e um provedor gratuito instável, mudanças de 1 caso entre execuções estão dentro do ruído.

### Análise: resposta truncada em `conflict-burger-then-hummus`

Resposta final registrada pelo eval, na íntegra:

```
O **Homus com pão sírio** ([[dish:e9e0a7df-235e-5305-8629-7c18beb6ae35]]) é do restaurante *
```

- **Classificação:** truncamento de resposta, um **bug do produto**. O agente agiu corretamente: não misturou restaurantes, não chamou `clear_cart` e começou a explicar o conflito. Só `finalReplyMentions` falhou, porque o texto parou antes de citar o restaurante.
- **Reexecução isolada:** `EVAL_ONLY=conflict-burger-then-hummus EVAL_REPEAT=5` passou **5/5**.
- **Resultado oficial mantido em 18/20.** A falha não foi reclassificada.
- **Causa:**
  - O texto persistido é o texto bruto do modelo, ainda com o marcador `[[dish:...]]`, então o parser de marcadores não perdeu nada. O stream do provedor terminou antes do fim da resposta.
  - O adaptador de stream ignorava o `finish_reason`, e o agente aceitava qualquer fim de stream como resposta completa.
- **Correção (pós-eval, não afeta o número oficial):**
  - O `finish_reason` passou a ser logado em toda chamada (`llm_stream_end`).
  - Um stream sem `finish_reason` válido, ou com texto estruturalmente incompleto, é tratado como erro recuperável. O front recebe `message_reset` e a chamada é repetida uma vez. Se truncar de novo, o usuário recebe um erro em vez de texto cortado.
  - Há teste reproduzindo exatamente esta resposta.
  - Detalhes em `docs/decisions-log.md`.

- **Lição:**
  - Medir o provedor direito mudou a leitura dos números. O fallback salva casos de verdade (2 de 3 usos).
  - No plano gratuito ainda sobra cauda de latência e timeout duplo, que pesam no resultado de um eval pequeno.

## Modelo para novas versões (copie e preencha)

```md
## vN: título curto da mudança

- **O que mudou:** trecho do prompt ou da descrição de tool alterado, e por quê.
- **Resultado:** XX/20 (antes: XX/20).
- **Casos que mudaram de falha para acerto:** XX.
- **Casos que regrediram:** XX.
- **Lição:** XX.
```
