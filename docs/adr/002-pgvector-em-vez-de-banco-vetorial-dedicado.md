# ADR 002 — pgvector no PostgreSQL em vez de um banco vetorial dedicado

- **Status:** aceito
- **Data:** 12/11/2026
- **Bloco:** 1 (Fundação)

## Contexto

O agente precisa encontrar pratos a partir de frases como "algo vegetariano, sem lactose, até R$ 40, que chegue em 30 min". Isso exige duas coisas **na mesma consulta**:

1. **Filtros estruturados e obrigatórios:** preço, tags alimentares, alergênicos, tempo de entrega, categoria e disponibilidade. Um prato com lactose nunca pode aparecer para quem pediu "sem lactose".
2. **Similaridade semântica:** "algo leve e fresco" deve achar uma salada mesmo sem a palavra "salada". Para isso, cada prato tem um _embedding_ (vetor de 1536 números gerado a partir do texto) e a consulta compara vetores pela distância de cosseno.

O catálogo é pequeno (cerca de 80 pratos), e os dados relacionais (restaurantes, carrinho, conversas) já precisam de um banco transacional.

## Decisão

Usar **PostgreSQL 16 com a extensão pgvector** (imagem `pgvector/pgvector:pg16`) como único banco:

- Coluna `Dish.embedding` do tipo `vector(1536)`, declarada no Prisma como `Unsupported("vector(1536)")`. As consultas vetoriais usam `$queryRaw` com `Prisma.sql` (sempre parametrizado).
- Índice **HNSW** com `vector_cosine_ops` (`dish_embedding_hnsw`) para a busca por vizinhos mais próximos.
- Índices **GIN** em `dietaryTags` e `allergens`, que aceleram os operadores de array `@>` ("contém todas as tags") e `&&` ("tem algum alergênico em comum").
- Extensão **pg_trgm** para combinar com similaridade de texto no nome do prato (`score = 0,8 × vetorial + 0,2 × trigram`), útil quando o usuário digita o nome exato.

Assim, a busca híbrida vira **um único SQL**: o `WHERE` aplica os filtros e o `ORDER BY embedding <=> $vetor` ordena por semelhança. Os filtros acontecem no banco, não no prompt: o LLM nunca vê um prato que viola a restrição.

## Alternativas consideradas

| Alternativa                                                  | Por que não                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banco vetorial dedicado (Pinecone, Qdrant, Weaviate, Chroma) | Mais um serviço para subir, pagar e manter sincronizado com o Postgres. Os filtros teriam de ser duplicados como metadados no índice vetorial, e um prato que fica indisponível no Postgres continuaria "disponível" no outro banco até a próxima sincronização. Para 80 pratos, não há ganho de desempenho que compense. |
| Busca vetorial em memória na API                             | Simples, mas perde o filtro no SQL, precisa recarregar tudo a cada deploy e não escala nem para algumas centenas de restaurantes.                                                                                                                                                                                         |
| Só busca textual (`pg_trgm` ou full-text)                    | Não entende sinônimos nem intenção ("algo leve", "comida de vó").                                                                                                                                                                                                                                                         |
| Índice IVFFlat em vez de HNSW                                | IVFFlat precisa ser criado depois que os dados existem (ele "treina" listas a partir deles) e perde qualidade se for criado com a tabela vazia. HNSW funciona bem desde a migration inicial e tem melhor recall.                                                                                                          |

## Consequências

- **Positivas:** um só banco, uma só transação e um só backup; filtros e similaridade na mesma consulta; o Neon (deploy) suporta pgvector no plano gratuito; o CI sobe a mesma imagem como serviço.
- **Negativas:** o Prisma não entende o tipo `vector`. Por isso:
  - a coluna é `Unsupported(...)` e não aparece nos tipos do Prisma Client; leitura e escrita do embedding são feitas com SQL cru;
  - o índice HNSW e o `CHECK (quantity BETWEEN 1 AND 10)` são **SQL manual** no fim da migration inicial;
  - o `prisma migrate dev` não conhece o índice HNSW e vai propor `DROP INDEX "dish_embedding_hnsw"` nas próximas migrations. **Regra do projeto:** criar migrations sempre com `--create-only`, apagar esse `DROP INDEX` e só depois aplicar.
- **Escala:** HNSW atende com folga dezenas de milhares de vetores. Se o catálogo crescer muito, o caminho natural é ajustar parâmetros do índice (`m`, `ef_construction`) antes de pensar em outro banco.

## Decisões de detalhe tomadas no bloco 1

- **Índices GIN declarados no schema Prisma** (`@@index(..., type: Gin)`), e não como SQL manual. O resultado no banco é o mesmo da especificação, mas o Prisma passa a conhecer esses índices e não tenta removê-los. Só o HNSW, que o Prisma não consegue expressar, fica manual.
- **`EMBEDDING_DIMENSIONS` validado como exatamente 1536.** A coluna é `vector(1536)`; qualquer outro valor faria os `INSERT` de embedding falharem. Trocar de modelo de embedding exige uma migration nova.
- **Ids determinísticos no seed.** Os ids de restaurantes e pratos são UUIDs derivados de um hash (`sha256`) do slug e do nome do prato. Recriar o banco gera os mesmos ids, o que deixa casos de avaliação, logs e demos reproduzíveis.
- **`embeddingText` com rótulos em português.** O formato segue a especificação (`"{nome}. {descrição}. Categoria: {categoria}. Restaurante: {restaurante} ({culinária}). Tags: {tags}."`), mas categoria e tags usam os rótulos em pt-BR ("Prato principal", "sem glúten") em vez dos códigos (`MAIN`, `gluten_free`), para o vetor ficar mais próximo das perguntas dos usuários, que serão em português.

## Atualização (blocos 2 e 5): o que a implementação fez de diferente

- **O ranking não usa o índice HNSW (D2.16).** O score final (`0,8 × vetorial + 0,2 × trigram`, com limiar) é calculado numa subconsulta e a ordenação é por ele, não por `ORDER BY embedding <=> $vec`. Com cerca de 80 pratos, a varredura completa leva milissegundos. O índice continua criado na migration, pronto para o dia em que o catálogo crescer: o caminho é pré-selecionar os K vizinhos pelo índice e só então recalcular o score.
- **Embedding falso lexical (D2.1) e hash com modelo (D2.2).** Sem chave, o `FakeEmbeddingProvider` faz _feature hashing_ de palavras: determinístico e sem rede, mas textos com palavras em comum ficam próximos (vetores aleatórios por hash não achariam nada). O `embeddingHash` inclui o id do modelo, então trocar do falso para o real regenera os vetores em vez de pular por "texto não mudou".
- **Limiar de relevância por provedor (D2.3):** 0,25 com o provedor real e 0 com o falso, cujos cossenos lexicais são naturalmente baixos.
- **Consequência para a avaliação:** o resultado oficial só vale com embeddings reais (`pnpm db:embed` com a chave) e `LLM_PROVIDER=openai`.
