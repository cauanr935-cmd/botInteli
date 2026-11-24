# Figurinhas do Axo

O **começo do nome** do arquivo define quando ela é usada: `categoria_descricao.webp`.
Para adicionar: coloque o `.webp` aqui com o prefixo certo, rode `npm run stickers` e `npx wrangler deploy`.
Formato: `.webp` 512x512; acima de 500 KB o arquivo é ignorado. Nomes só com letras, números, `-` e `_` (sem acento, sem `%`).

| Categoria | Quando o bot usa |
|---|---|
| `abertura_` | Primeira mensagem da pessoa: figurinha + resposta simples. |
| `resenha_` | Pessoa escreveu algo fora de assunto: figurinha + "aqui não é canto de resenha". |
| `despedida_` | Fim do fluxo, e quando a pessoa responde "valeu/tchau" depois: figurinha + "vlw". |
| `reacao_` | Pessoa mandou figurinha ou imagem: devolve uma figurinha. |

Sem arquivos na categoria, o bot não manda figurinha naquela situação (só `reacao_` aceita as outras como reserva).
Nunca há figurinha na 1 hora seguinte a um tema sensível (modo cuidado).

## Catálogo

**abertura_**: `cr7-entrando`, `1porcento-99fe`, `garfield-oi`, `cachorrinho-fofo`, `gato-coracao`, `neymar-coracao`, **`axo-feliz`**, **`axo-empolgado`**
**resenha_**: `nao-diga-nada-veja`, `gato-assustado`, `flork-pensativo`, `ainda-bem-que-nao-sou-vc`, `alexa-ligar-aura`, `chegamos-a-tal-ponto`, `cavalo-na-porta`, `deixa-pra-la`, **`axo-entediado`**, **`axo-entediado-sentado`**, **`axo-chateado`**, **`axo-com-raiva`**
**despedida_**: `neymar-rosa`, `brabo-will-smith`, `e-o-fim-lagosta`, `hulk-blz`, `o-recado-ta-dado`, **`axo-high-five`**, **`axo-explicando`**
**reacao_**: `nao-tem-condicao-codigo`, `cr7-gargalhada`, `neymar-selfie-GRANDE` (665 KB: **ignorada** até ser reduzida), `cavalo-sorrindo`, `cavalo-no-banho`, `tigre-especialista`, `cachorro-melancia`, `cerebros-conectados`, `mbappe-militar`, `vou-me-curvar`, **`axo-triste`**, **`axo-ansioso`**, **`axo-debug`**, **`axo-sobrevivendo`**

As `axo-*` (em negrito) vêm da folha `docs/referencias/figurinhasAxolote.webp`: recortadas com fundo transparente, em WebP sem perdas (~200 KB cada, 512 px).
