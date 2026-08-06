# Canastra / Buraco — Regras Implementadas

Fonte: [Regras de Canastra — Jogos do Rei](https://www.jogosdorei.com.br/regras-canastra.php).

Este documento é a fonte da verdade das regras implementadas no motor do
jogo (`server/src/canastra/`). A fonte acima descreve o essencial mas deixa
lacunas reais (pontuação mínima pro primeiro jogo, timing exato do morto,
condição de trava por esgotamento do monte) — como já foi feito em
[TrucoGaucho.md](TrucoGaucho.md), essas lacunas são resolvidas aqui por
escrito, não improvisadas no código.

Diferente do Truco (partida = várias mãos até 12 pontos), aqui **uma
"partida" é uma única mão**: do baralhamento até a batida ou até alguém
zerar a mão com o morto já tomado. Ao final, placar + vencedor + votação de
revanche (aceitar = baralha de novo, placar zera).

---

## Visão Geral

| Modo | Jogadores | Times |
|---|---|---|
| `1x1` | 2 | cada jogador é seu próprio time, com seu próprio morto |
| `2x2` | 4 | 2 duplas — parceiros sentam em assentos opostos (0+2 vs 1+3), um morto por dupla |

---

## Baralho

- **108 cartas** = 2 baralhos completos de 52 + 4 curingões.
- Cada carta tem um `id` único — necessário porque os 2 baralhos duplicam
  combinações de naipe+valor.

## Distribuição

- **11 cartas** por jogador.
- **Morto**: 11 cartas por time (1x1: um morto por jogador; 2x2: um morto
  por dupla), reservado à parte, sem ninguém ver o conteúdo até ser pego.
- O resto forma o **monte** (compra): 64 cartas no 1x1, 42 cartas no 2x2.
- O baralhador roda a cada mão (inclusive nas revanches); quem senta
  seguinte ao baralhador começa jogando.

---

## Seu turno

1. **Comprar** — uma das duas opções:
   - 1 carta do monte, **ou**
   - o **lixo inteiro**, só se a carta do topo puder ser usada **na hora**:
     formando um jogo novo com cartas da mão, ou sendo acrescentada a um
     jogo já existente do próprio time. Todas as cartas do lixo vão pra mão;
     só a carta do topo precisa ser efetivamente usada nessa jogada.
2. **Jogar** — baixar jogo(s) novo(s) e/ou acrescentar cartas a jogos do
   próprio time, quantas vezes quiser. **Não há pontuação mínima** para
   baixar o primeiro jogo (a fonte não define nenhuma — simplificação
   deliberada desta implementação).
3. **Descartar** — 1 carta, encerra o turno.

### Monte esgotado

Se o monte fica vazio, a etapa de compra deixa de ser obrigatória: o
jogador da vez pode ir direto pra baixar jogos/descartar sem comprar (ainda
pode optar por comprar o lixo, se tiver cartas e o topo for utilizável).
Isso evita um impasse: sem essa válvula de escape, um jogador com o monte
vazio e o lixo inutilizável ficaria travado, incapaz de fazer qualquer
jogada.

---

## Jogos válidos

- **Sequência**: 3+ cartas do mesmo naipe, em rank consecutivo. O Ás pode
  ser baixo (`A-2-3...`) ou alto (`...Q-K-A`), mas **não há volta** — `K-A-2`
  é inválido.
- **Trinca**: 3+ cartas do mesmo valor, naipes livres.
- O **`2`** e o **curingão** são curinga. **No máximo 1 curinga por jogo**
  — exceto um `2` sentado na sua posição natural de sequência (ex.: `A-2-3`
  ou `2-3-4` do mesmo naipe), que não conta contra esse limite.
- `2` e curingão nunca são o "valor natural" de um jogo — não existe trinca
  de `2`s.

## Canastra

- Jogo com **7+ cartas** (sequência ou trinca).
- **Limpa** (sem curinga): **200 pontos**.
- **Suja** (com curinga): **100 pontos**.
- Sem bônus de 500/1000 — não existem nesta variante.

## Pontos por carta

| Carta | Pontos |
|---|---|
| Ás | 15 |
| Curingão | 50 |
| `2` | 10 |
| `3`–`7` | 5 |
| `8`–`K` | 10 |

---

## Batida (zerar a mão)

- **Batida direta** (esvaziou baixando/acrescentando jogos): se o time
  ainda não pegou o morto, o morto é entregue **na hora** (mescla às 11
  cartas do jogador) e o turno continua — ele precisa descartar. Se o time
  já tem morto, a mão **encerra ali**.
- **Batida indireta** (esvaziou descartando a última carta): se o time
  ainda não pegou o morto, a mão **não encerra** — o morto é entregue
  automaticamente no **próximo turno desse time** (do parceiro, no 2x2; do
  mesmo jogador, no 1x1). Se o time já tem morto, a mão encerra no
  descarte.
- **Sem exigência de canastra pra encerrar.** Para evitar todo risco de
  impasse (nenhum time nunca completando uma canastra), qualquer batida com
  o morto já tomado encerra a mão — a canastra vira só um **modificador de
  pontuação**: o bônus de +100 (abaixo) só é concedido a quem bateu com
  pelo menos uma canastra.

---

## Pontuação final

Por time, ao fim da mão:

```
total = pontos dos jogos (cartas + bônus de canastra)
      − valor das cartas que sobraram na mão
      − 100 se o time nunca pegou o morto
      + 100 se foi esse time que bateu, E tem pelo menos uma canastra
```

Vence quem tiver mais pontos. Empate é possível (mão só, sem desempate) —
ninguém ganha vitória (`matchWins`) nesse caso.

---

## Fim de Partida e Revanche

- A mesa **não fecha automaticamente**: todos os jogadores sentados votam
  se querem revanche.
  - **Todos aceitam** → nova mão é distribuída.
  - **Qualquer recusa ou timeout** → a mesa é encerrada e os jogadores
    restantes voltam para o lobby de Canastra.
- `matchWins` (vitórias) acumula por jogador enquanto a mesa continuar
  aberta, mesmo padrão do Truco.

---

## Estados do Jogador

| Status | Descrição |
|---|---|
| `waiting` | Sentado, aguardando início da partida (mesa incompleta) |
| `active` | Jogando a mão atual |
| `disconnected` | Conexão caiu — assento reservado até reconectar |
