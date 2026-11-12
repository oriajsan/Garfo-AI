# Roteiro do GIF do README

Grave a demo **com o LLM real** (`LLM_PROVIDER=openai`) e o banco com embeddings reais, para as respostas ficarem naturais. O arquivo final é `docs/demo.gif`, referenciado no README.

## Preparação

- **Resolução da gravação:** janela do navegador em 1280 x 720 px (proporção 16:9), zoom 100%, modo claro, sem extensões visíveis. Use uma janela anônima, para o chat começar vazio.
- **Duração total:** 15 a 20 segundos.
- **Antes de gravar:** abra a demo (ou `http://localhost:3000`), confira que o carrinho está vazio e que o estado vazio mostra os 4 chips. Feche notificações do sistema.
- **Ferramenta sugerida:** ScreenToGif (Windows), Kap (macOS) ou Peek (Linux). Alternativa: gravar um vídeo qualquer e converter com `ffmpeg` (veja "Otimizar" abaixo).

## Roteiro (tempos em segundos desde o início)

| Tempo   | Ação                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 a 2   | Mostrar a tela inicial, com a saudação e os chips, sem mexer o mouse.                                                                         |
| 2 a 5   | Clicar no campo de texto e digitar exatamente: `Algo vegetariano até R$ 40`. Pressionar Enter. (Alternativa: clicar no chip de mesmo texto.)  |
| 5 a 8   | Esperar o indicador da tool ("Buscando pratos vegetarianos até R$ 40…") e o texto da resposta aparecendo aos poucos. Não mexer o mouse.       |
| 8 a 11  | Mostrar os cards de pratos (até 3). Passar o mouse devagar sobre eles.                                                                        |
| 11 a 13 | Clicar em "Adicionar" no primeiro card. O painel do carrinho à direita atualiza.                                                              |
| 13 a 15 | Se o pedido mínimo do restaurante não for atingido, clicar no "+" do item no carrinho para chegar a 2 unidades (o botão mostra quanto falta). |
| 15 a 17 | Clicar em "Finalizar pedido" e, no diálogo, confirmar.                                                                                        |
| 17 a 20 | Mostrar a tela de sucesso com o número do pedido simulado e o tempo estimado. Parar a gravação.                                               |

Se passar de 20 segundos, corte o começo (tempo 0 a 2) e a pausa final.

## Otimizar o tamanho (meta: abaixo de 5 MB)

Se gravou em vídeo (mp4/mkv), converta com `ffmpeg` em dois passos, para ter uma paleta de cores boa:

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i demo.mp4 -i palette.png -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" demo.gif
```

Se o GIF ficar grande demais, reduza para `fps=10` e `scale=800:-1`, ou passe por `gifsicle -O3 --lossy=80 demo.gif -o docs/demo.gif`. O GitHub carrega bem GIFs de até uns 10 MB, mas abaixo de 5 MB abre mais rápido no celular.

## Depois de gravar

1. Salve como `docs/demo.gif`.
2. No README, apague o comentário `<!-- TODO(owner): gravar o GIF conforme docs/gif-script.md -->`.
3. Abra o README no GitHub e confira se o GIF carrega.
