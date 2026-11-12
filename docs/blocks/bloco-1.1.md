# Bloco 1.1 — Correções do bloco 1

- **Branch:** `feat/foundation` (commits adicionais na mesma branch).
- **Origem:** revisão do bloco 1 (aprovado, com recomendações) e decisões D1.2 e D1.3 em `docs/decisions-log.md`.

## Tarefas

1. **Reequilibrar `data/seed/restaurants.json`** (D1.2):
   - Vegetarianos entre 32 e 38 (hoje 51); veganos entre 14 e 18 (hoje 29). Mínimos da SPEC continuam: ≥ 15 vegetarianos, ≥ 8 veganos, ≥ 8 sem glúten, ≥ 8 sem lactose (contando só pratos disponíveis).
   - Converter pratos vegetarianos em versões com carne, frango, peixe ou frutos do mar principalmente no Sertão Arretado, Brasa e Pão, Forno da Vila, Cedro do Líbano e Kaizen (que hoje tem 8/14 vegetarianos, pouco realista para um sushi bar). Priorizar pratos principais e lanches até R$ 40. O Raiz Verde continua quase todo vegetariano/vegano.
   - Pelo menos 3 sobremesas até R$ 15 (hoje só 1) no catálogo todo.
   - Pelo menos 2 pratos sem glúten com `serves >= 2` abaixo de R$ 80 (para "jantar para 2 pessoas sem glúten").
   - Pelo menos um restaurante com entrega máxima ≥ 50 min e pratos baratos (para o filtro de tempo eliminar opções baratas de verdade). Faixa global de 20 a 60 min e de preços R$ 8 a R$ 120 mantidas.
   - Manter: 6 restaurantes, 12 a 15 pratos cada, ~80 no total, a Kombucha de hibisco indisponível, todos os alergênicos da lista aparecendo pelo menos uma vez, descrições realistas em pt-BR, nomes fictícios.
   - Ao renomear um prato o id muda (é derivado do nome); tudo bem, ainda não há consumidores.
2. **Coerência tag ⇔ alergênico** (D1.3), validada com Zod no seed: prato com `lactose_free` não tem alergênico `lactose` e prato **sem** `lactose_free` tem obrigatoriamente o alergênico `lactose`; o mesmo para `gluten_free`/`gluten`. Corrigir os pratos ambíguos que existem hoje (ex.: "Combinado Kaizen 20 peças", "Lámen de missô com chashu", "Chicken crispy picante", "Uramaki Filadélfia", "Missoshiru").
3. O seed deve continuar idempotente e, como ids mudam, **remover do banco os pratos que não estão mais no JSON** (só se não houver `CartItem` referenciando; se houver, marcar `available=false`). Restaurantes idem.
4. `.gitignore`: remover os blocos duplicados de `.env`.
5. Atualizar a tabela de contagens no `README` ou onde houver números do seed (exceto `docs/progress.md`, que o líder atualiza) e imprimir as contagens no final do `pnpm db:seed`.

## Critérios de aceite

1. `pnpm lint && pnpm typecheck && pnpm build` ok; `pnpm db:seed` roda duas vezes sem erro e o banco fica com exatamente os pratos do JSON.
2. Contagens dentro dos alvos acima, impressas pelo seed.
3. Validação Zod falha se a coerência tag ⇔ alergênico for quebrada (testar manualmente alterando um prato e revertendo, ou com um teste se o Jest já existir — não existe ainda, então manual basta).
4. Commits pequenos em Conventional Commits; nenhum push.
5. Devolver no relatório a tabela de contagens final (vegetarianos, veganos, sem glúten, sem lactose, sobremesas ≤ R$ 15, sem glúten para 2 ≤ R$ 80, vegetarianos ≤ R$ 40 / total ≤ R$ 40) e a lista de pratos alterados.
