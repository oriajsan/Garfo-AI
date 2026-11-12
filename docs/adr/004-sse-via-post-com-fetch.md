# ADR 004 — Streaming por SSE sobre `POST`, consumido com `fetch`

- **Status:** aceito
- **Data:** 12/11/2026
- **Bloco:** 3 (Agente)

## Contexto

Um LLM leva alguns segundos para terminar uma resposta, mas começa a produzir texto quase de imediato. Se esperarmos a resposta inteira, a interface parece travada; se enviarmos o texto **aos poucos** (_streaming_), o usuário começa a ler na hora. Além do texto, queremos enviar outros eventos durante a mesma resposta: "estou buscando pratos…", cards de pratos, carrinho atualizado, erro.

Precisamos de um canal em que **o servidor envia vários eventos** durante uma única requisição. As opções comuns são SSE, WebSocket e _long polling_.

**SSE (Server-Sent Events)** é só uma resposta HTTP que não termina logo: `Content-Type: text/event-stream` e uma sequência de blocos de texto no formato

```
event: token
data: {"text":"Olá"}

```

(uma linha `event:`, uma linha `data:` com JSON e uma linha em branco). Os eventos do Garfo são: `meta`, `token`, `tool_start`, `tool_end`, `dish_cards`, `cart_updated`, `done` e `error`, com os tipos Zod em `packages/shared`.

O navegador tem uma API pronta para SSE, o `EventSource`, mas ela **só faz `GET`**, sem corpo e sem headers personalizados. O chat precisa enviar a mensagem do usuário (corpo JSON) e o `X-Session-Id` (header).

## Decisão

- Endpoint **`POST /api/v1/chat`** que responde com `text/event-stream`, escrito direto no `Response` do Express (`res.write`), sem camadas que façam _buffer_.
- O front consome com **`fetch` + `ReadableStream`** (lendo `response.body.getReader()` e separando os eventos por linha em branco), no lugar do `EventSource`. É um parser de poucas linhas e permite `POST`, corpo JSON e headers.
- Headers da resposta: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform` (nada de cache nem compressão no meio do caminho), `Connection: keep-alive` e **`X-Accel-Buffering: no`** (proxies como o nginx, usados por muitas plataformas, seguram a resposta até encher um buffer; esse header pede para não fazer isso). Depois de montar os headers, `res.flushHeaders()` abre o stream imediatamente.
- **Heartbeat**: um comentário SSE (`: ping`) a cada 15 s, para conexões ociosas (por exemplo, uma tool lenta) não serem derrubadas por proxies.
- **Desconexão do cliente** (o usuário fechou a aba) aborta a chamada ao modelo por `AbortController`. Detectamos pelo evento `close` do `Response`: o `close` do `Request` do Node 16 em diante dispara quando o corpo termina de ser lido, não quando a conexão cai.
- **Erros antes do stream** (corpo inválido, limite de requisições, teto diário) saem como **JSON comum com status 400/429**: quem chama (e os testes) recebe um erro HTTP de verdade. **Depois que o stream abre**, o status 200 já foi enviado e não dá mais para mudar; erros viram um evento `error` seguido do fim do stream.
- **Limite de uso** com `@nestjs/throttler`: 15 requisições por minuto por IP **e** 15 por `X-Session-Id`, só na rota do chat (dois _throttlers_ nomeados, cada um com seu próprio "rastreador"). `trust proxy` configurado para enxergar o IP real atrás do Railway. O teto diário global é contado no banco (mensagens do usuário desde a meia-noite de São Paulo).

## Alternativas consideradas

| Alternativa                                              | Por que não                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EventSource` com `GET /chat?message=...`                | Mensagem na URL (vai para logs, tem limite de tamanho, sem corpo JSON) e nenhum header personalizado. Teríamos de passar a sessão por query string. Seria uma regressão de segurança e de organização só para usar uma API pronta.        |
| `EventSource` + `POST` separado para enviar a mensagem   | Dois endpoints e uma correlação por id para ligar o envio ao stream. Mais estado no servidor e mais formas de dar errado (o stream abre antes da mensagem chegar, por exemplo).                                                           |
| WebSocket                                                | Bidirecional demais para o que precisamos (o cliente só fala uma vez por resposta). Exige outro protocolo na infraestrutura, reconexão e autenticação próprias, e não passa tão bem por proxies e plataformas gratuitas. SSE é HTTP puro. |
| Resposta única (sem streaming)                           | Interface parece travada por vários segundos e não há como mostrar o progresso das tools.                                                                                                                                                 |
| Biblioteca como `@microsoft/fetch-event-source` no front | Faz exatamente o que o `fetch` + `ReadableStream` faz, mas é mais uma dependência. Podemos adotá-la se o parser próprio crescer; hoje são poucas linhas testáveis.                                                                        |

## Consequências

- **Positivas:** uma única requisição por mensagem, HTTP puro (funciona em Railway, Vercel e atrás de proxies comuns), corpo JSON e headers livres, eventos tipados e testáveis (os testes e2e leem o stream real com o Supertest).
- **Negativas:** o front precisa de um pequeno parser de SSE e de cuidar do abort/reconexão por conta própria (o `EventSource` faria isso sozinho). O `EventSource` reconectaria automaticamente; aqui, uma queda no meio da resposta exige o usuário reenviar a mensagem (e a rodada incompleta não foi salva, então não há duplicidade).
- **Para explicar em entrevista:** "SSE é só HTTP com resposta longa em um formato de texto simples. Usei `POST` porque preciso de corpo e headers, e como o `EventSource` do navegador só faz `GET`, consumo com `fetch` e `ReadableStream`. Desliguei o buffering dos proxies com `X-Accel-Buffering: no`, mando um heartbeat e trato a desconexão do cliente com `AbortSignal`."
