# Truco Gaúcho / Espanhol — Regras Implementadas

Fonte: [Truco Gaudério — Jogatina](https://www.jogatina.com/regras-como-jogar-truco-gauderio.html).

Este documento é a fonte da verdade das regras implementadas no motor do
jogo (`server/src/gaucho/`). É um jogo **separado** do Truco Paulista/Mineiro
(`server/src/truco/`) — não compartilha runtime nem estado com ele.

Para tudo que é **igual** ao Truco Paulista/Mineiro, este documento aponta
para a seção correspondente de [Truco.md](Truco.md) em vez de repetir o
texto. Só é detalhado aqui o que **muda** nesta variante.

---

## Igual ao Truco (ver Truco.md)

| Assunto | Ver em Truco.md |
|---|---|
| Baralho: 40 cartas, sem 8/9/10, sem curingas | → *Baralho* |
| Estrutura da mão: 3 vazas, vence quem fizer 2 | → *Estrutura da Mão* |
| Cascata de empate de vaza | → *Empate de vaza ("empate"/"vaza de mão")* |
| Mão de 11 e Mão de Ferro (limiar em 11 pontos) | → *Mão de 11 e Mão de Ferro* |
| Fim de partida (12 pontos) e revanche | → *Fim de Partida e Revanche* |
| Estados do jogador | → *Estados do Jogador* |

O modo de mesa (`1x1` / `2x2`) segue a mesma definição de assentos/times do
Truco.

---

## O que muda nesta variante

### Ranking base das cartas

Ordem **diferente** do Truco Paulista — segue a ordem do baralho espanhol
(Sota, Caballo, Rei) mapeada no nosso baralho de naipes franceses: o `J`
(Valete/Sota) vem **antes** do `Q` (Dama/Caballo), não depois.

| Ordem | Cartas |
|---|---|
| 1 (mais fraca) | 4 |
| 2 | 5 |
| 3 | 6 |
| 4 | 7 |
| 5 | J (Valete) |
| 6 | Q (Dama) |
| 7 | K (Rei) |
| 8 | A (Ás) |
| 9 | 2 |
| 10 (mais forte, fora manilha) | 3 |

### Manilhas — sempre fixas, sem vira

Não existe carta vira nesta variante. As manilhas são sempre as mesmas 4
cartas específicas, a partida toda — e, diferente do Truco Mineiro, **não**
é "uma carta por naipe do mesmo rank": são dois naipes de `7` e dois naipes
de Ás.

| Ordem | Carta |
|---|---|
| 1 (mais forte) | Ás de Espadas (A♠) — "Espadilha" |
| 2 | Ás de Paus (A♣) — "Basto" |
| 3 | 7 de Espadas (7♠) |
| 4 (mais fraca, fora manilha) | 7 de Ouros (7♦) |

Fonte: *"7 de ouros, 7 de espadas, 1 de paus e 1 de espadas"* (fraca → forte).
Nenhuma outra carta é manilha; as demais 36 cartas seguem só o ranking base
acima, sem desempate por naipe (empate de vaza segue a mesma cascata do
Truco comum).

### Escalada de Aposta (Truco)

Mesma mecânica de chamada/resposta/aumento-como-resposta do Truco comum
(ver Truco.md → *Escalada de Aposta*), mas com **nomes e valores
diferentes** e teto mais baixo:

| Chamada | Mão passa a valer |
|---|---|
| (nenhuma) | 1 ponto |
| `truco` | 2 pontos |
| `retruco` | 3 pontos |
| `vale_quatro` | 4 pontos (teto — não dá pra aumentar mais) |

Recusar cede ao time que chamou os pontos do **último valor já aceito**
antes dessa chamada — mesma regra do Truco comum.

### Envido (novo)

Disputa paralela de pontos, baseada no valor das cartas na mão — só existe
nesta variante.

**Valor de envido de uma mão de 3 cartas:**
- Ás vale 1; `2` a `7` valem o número da carta; `J`, `Q`, `K` valem 0.
- Se duas cartas são do **mesmo naipe**: valor = soma das duas + **20**
  (usa-se o melhor par, se houver mais de uma combinação).
- Se as 3 cartas são de naipes diferentes: valor = a carta de maior valor
  isolada (sem bônus).
- Em 2x2, o valor do **time** é o maior valor entre os dois parceiros (cada
  um calcula só com as próprias 3 cartas).

**Escalada:**

| Chamada | Vale |
|---|---|
| `envido` | 2 pontos |
| `real_envido` | 5 pontos |
| `falta_envido` | pontos que faltam para o time **na frente** chegar a 12 |

Mesma mecânica de aceitar / recusar / aumentar-direto-como-resposta do
Truco. **Diferença importante: aceitar já resolve e pontua na hora** —
compara-se o valor de envido dos dois times e o maior leva os pontos da
chamada aceita. Empate → vence o time de quem está "com a mão" (o
`leaderSeat` da mão). Recusar cede ao time que chamou os pontos do
**último valor já aceito** (ou 1, se nada foi aceito ainda) — mesma regra
de recusa do Truco.

**Janela:** só pode ser chamado pelo jogador da vez, durante a **1ª vaza**,
antes dela ser resolvida. Se a 1ª vaza termina sem ninguém chamar, o envido
fecha sem pontuar. Chamar truco **fecha o envido** para o resto da mão
("truco corta o envido") — se o envido ainda não tinha sido aberto, ele não
pode mais ser chamado.

### Flor (novo)

Quando um jogador recebe as 3 cartas do **mesmo naipe**, ele "tem flor" —
isso é detectado automaticamente ao distribuir, sem precisar declarar
nada antes.

**Regra de precedência:** se **qualquer jogador da mesa** tem flor, o
**envido fica fechado nessa mão inteira** ("flor corta o envido") — não dá
pra chamar envido naquela mão, só flor.

**Valor de flor:** soma das 3 cartas do naipe (mesmas regras de valor do
envido: Ás=1, 2-7=face, J/Q/K=0) **+ 20**.

**Escalada:**

| Chamada | Vale |
|---|---|
| `flor` | 3 pontos |
| `contra_flor` | 6 pontos |
| `contra_flor_e_o_resto` | pontos que faltam para o time na frente chegar a 12 |

Se só um time tem flor (o outro time não tem nenhum jogador com 3 cartas do
mesmo naipe), a flor **pontua sozinha, sem resposta** — 3 pontos direto,
assim que declarada. Se os dois times têm flor, a mesma mecânica de
aceitar/recusar/aumentar do envido se aplica, comparando o valor de flor
dos jogadores que têm flor em cada time (maior valor da equipe). Recusar
cede ao time que chamou os pontos do último valor já aceito (ou **1**, se
nada foi aceito ainda) — mesmo piso usado no Envido.

**Janela:** mesma janela do envido — só na 1ª vaza, antes dela resolver.
Chamar truco também fecha a flor, se ainda estiver aberta.

### Exclusão mútua entre Truco / Envido / Flor

No máximo **uma** das três disputas (`truco`, `envido`, `flor`) pode estar
com resposta pendente por vez:

- Não dá pra chamar truco enquanto um envido ou flor está aguardando
  resposta.
- Não dá pra chamar envido/flor enquanto um truco está aguardando resposta
  (na prática isso quase nunca ocorre, porque chamar truco já fecha
  envido/flor imediatamente, mesmo que a resposta ainda não tenha
  acontecido).
- Jogar carta (`playCard`) fica bloqueado enquanto qualquer uma das três
  tiver resposta pendente.
