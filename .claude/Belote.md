# Belote (Contrée) — Regras e Plano de Implementação

Fonte: [Belote — Pagat.com (John McLeod)](https://www.pagat.com/jack/belote.html),
seção da variante **"Contrée" / Belote Coinchée simplificada** tomada como
base (a mais próxima do que se joga popularmente na França). **Esta é a
única fonte usada para este jogo** — mesma política do
[Blackjack.md](Blackjack.md)/[GoFish.md](GoFish.md): não foram consultadas
variações de clube. Onde a fonte descreve variações regionais sem uma única
regra "oficial", a escolha feita aqui é documentada explicitamente (não
improvisada no código depois).

> ⚠️ Este documento ainda **não tem código correspondente**. É a fonte da
> verdade para quando `server/src/belote/` for criado — ver
> [Plano de Implementação](#plano-de-implementação) no fim.

---

## Visão Geral

| | |
|---|---|
| Jogadores por mesa | **exatamente 4** |
| Times | 2 duplas fixas — parceiros sentam em assentos opostos (0+2 vs 1+3), mesmo padrão do Truco `2x2` |
| Baralho | **32 cartas** — do 7 ao Ás, sem 2 a 6, sem curinga |
| Objetivo | primeira dupla a atingir a pontuação-alvo (padrão **501**) ao final de uma mão |
| Uma "partida" | várias mãos ("donnes"), cada mão = licitação + 8 vazas, até o alvo |

---

## Baralho e Ranking

**Fora do naipe de trunfo**, ranking do mais fraco ao mais forte:

| Ordem | Carta |
|---|---|
| 1 (mais fraca) | 7 |
| 2 | 8 |
| 3 | 9 |
| 4 | Valete (J) |
| 5 | Dama (Q) |
| 6 | Rei (K) |
| 7 | 10 |
| 8 (mais forte) | Ás (A) |

**No naipe de trunfo**, ranking próprio (o Valete e o 9 "sobem"):

| Ordem | Carta | Apelido |
|---|---|---|
| 1 (mais fraca) | 7 |
| 2 | 8 |
| 3 | Dama (Q) |
| 4 | Rei (K) |
| 5 | 10 |
| 6 | Ás (A) |
| 7 | 9 | "Nell" |
| 8 (mais forte) | Valete (J) | "Jack"/"Bower" |

Qualquer carta de trunfo vale mais que qualquer carta fora de trunfo,
independente do rank base.

---

## Distribuição e Licitação ("Enchères")

1. Baralhador distribui **5 cartas** por jogador (em dois blocos, ex.: 3+2 ou
   2+3 — ordem livre, não afeta a regra) e vira a **próxima carta** do monte
   face-up — essa carta é a "proposta" de trunfo.
2. **1ª rodada de licitação**, começando pelo jogador à esquerda do
   baralhador, sentido horário: cada jogador, na vez, pode **aceitar** o
   naipe proposto como trunfo ("prendre"/tomar) ou **passar**.
   - Quem toma se torna o "tomador" (`taker`) daquela mão; sua dupla é a
     **dupla atacante**.
   - Se todos os 4 passam, segue pra 2ª rodada.
3. **2ª rodada** (só se todos passaram na 1ª): a carta virada é descartada
   (vira down), e cada jogador, na mesma ordem, pode **propor um dos outros
   3 naipes** como trunfo, ou passar.
   - Primeiro a propor um naipe vence — vira o tomador.
   - Se os 4 passarem de novo, a mão é **redistribuída** (novo baralhador,
     mesma rotação de assento).
4. Definido o trunfo (e o tomador), o baralhador completa a distribuição:
   cada jogador recebe mais 3 cartas, totalizando **8 cartas** cada.

---

## Jogo das Vazas

- Lidera a 1ª vaza o jogador à **esquerda do baralhador**. Quem vence uma
  vaza lidera a próxima.
- Regras de seguir naipe, na ordem de prioridade:
  1. **Deve seguir o naipe pedido** se tiver carta desse naipe.
  2. Se não tem o naipe pedido, mas tem **trunfo**, deve jogar trunfo
     ("cortar").
     - Se um **parceiro** já está vencendo a vaza no momento da sua jogada
       (nenhum adversário jogou trunfo mais alto depois dele), **não é
       obrigado a "subir"** o trunfo — pode jogar qualquer trunfo, mesmo
       mais fraco.
     - Se um **adversário** está vencendo a vaza com trunfo, e o jogador só
       tem trunfo pra jogar (sem o naipe pedido), deve jogar um trunfo
       **maior** que o mais alto já jogado, se tiver ("sobre-cortar") — só
       pode jogar trunfo mais baixo se não tiver nenhum trunfo mais alto.
  3. Se não tem nem o naipe pedido nem trunfo, pode descartar **qualquer
     carta**.
- Vence a vaza a carta de trunfo mais alta jogada; se ninguém jogou trunfo,
  vence a carta mais alta do naipe pedido.

---

## Pontuação das Cartas

| Carta | Pontos (trunfo) | Pontos (fora de trunfo) |
|---|---|---|
| Valete (J) | 20 | 2 |
| 9 | 14 | 0 |
| Ás (A) | 11 | 11 |
| 10 | 10 | 10 |
| Rei (K) | 4 | 4 |
| Dama (Q) | 3 | 3 |
| 8 | 0 | 0 |
| 7 | 0 | 0 |

Total fixo por mão: **152 pontos** em cartas + **10 pontos de "dix de der"**
(bônus de quem vence a **última vaza**, a 8ª) = **162 pontos** por mão.

### Belote–Rebelote

Se um jogador tem **o Rei e a Dama do naipe de trunfo** na mão, ganha
**20 pontos extras** — anunciados no momento em que joga a **primeira**
dessas duas cartas em uma vaza ("Belote"), confirmados ao jogar a **segunda**
("Rebelote"). Vale independente de qual dupla vence a mão (mas só conta se
essa dupla não "cair" — ver Capot/Dedans abaixo, onde os 20 pontos ficam
com o time que os anunciou mesmo se o adversário "capota").

### Combinações ("Annonces") — opcional, ver fases de implementação

Anunciadas **antes da 1ª carta ser jogada**, comparando-se entre os
jogadores (só a **melhor** combinação da mesa vale; empate por rank mais
alto → desempate pelo naipe de trunfo > mais próximo da esquerda do
baralhador):

| Combinação | Composição | Pontos |
|---|---|---|
| Tierce (sequência de 3) | 3 cartas seguidas do mesmo naipe | 20 |
| Quarte (sequência de 4) | 4 cartas seguidas do mesmo naipe | 50 |
| Quinte (sequência de 5+) | 5+ cartas seguidas do mesmo naipe | 100 |
| Carré de Valetes | 4 Valetes | 200 |
| Carré de 9 | 4 noves | 150 |
| Carré de A/10/K/Q | 4 do mesmo rank (não J nem 9) | 100 |

Carré de 8 ou 7 **não vale nada**. Essas combinações **não** são afetadas
por trunfo/cair — somam sempre pra dupla que as anunciou (exceto no capot,
ver abaixo).

---

## Resultado da Mão: "Dedans" / "Capot"

Ao final das 8 vazas, soma-se os pontos capturados por cada dupla (cartas +
dix de der + belote-rebelote de quem tem direito + annonces vencedoras).

- **Dupla atacante bate a meta**: precisa somar **estritamente mais da
  metade** dos 162 pontos em jogo, ou seja **≥ 82 pontos**. Se atingir,
  cada dupla soma os pontos que capturou normalmente.
- **Dupla atacante NÃO bate a meta ("dedans"/"chute")**: a dupla atacante
  soma **0** naquela mão; a dupla defensora soma o **total de 162** (todos
  os pontos da mão, incluindo os que ela própria não capturou fisicamente),
  **mais** qualquer annonce que a dupla defensora tenha anunciado (annonce
  da dupla atacante nesse caso é perdida). Belote-rebelote é exceção: os 20
  pontos ficam sempre com quem os anunciou, mesmo se essa dupla "caiu".
- **Capot**: se a dupla atacante vencer **as 8 vazas**, soma um valor fixo
  de **250 pontos** naquela mão (em vez da soma normal) — a dupla defensora
  soma 0. Se a dupla **defensora** vencer todas as 8 vazas contra um
  atacante que não anunciou capot, é tratado como um "dedans" comum (162
  para a defesa), não há bônus de capot pra quem não era o tomador.

---

## Fim de Partida

- Placar acumulado mão a mão. Ao final de cada mão, checa se **alguma dupla
  atingiu a pontuação-alvo** (padrão **501**, configurável na criação da
  mesa — a fonte cita 500/1000/1500/2000 como comuns; 501 evita empates
  exatos no alvo redondo).
- Termina **ao final da mão** em que o alvo é atingido (nunca no meio).
  Se **as duas duplas** cruzarem o alvo na mesma mão, vence quem tiver
  **mais pontos** (resolução própria — a fonte não cobre esse caso).
- Baralhador roda em sentido horário a cada mão (inclusive pós-revanche).
- Votação de revanche: mesmo padrão do Truco — todos os 4 aceitam zera
  placar e redistribui; qualquer recusa/timeout fecha a mesa.

---

## Plano de Implementação

### Arquitetura (server)

Sistema **totalmente paralelo**, mesmo padrão estrutural do Truco (times
fixos 2x2) mas com **licitação** (mecânica nova no catálogo):

```
server/src/belote/
├── deck.ts          # baralho de 32 cartas (7–A), ranking duplo (trunfo/fora) e valores
└── gameEngine.ts     # BeloteGame — máquina de estados
server/src/beloteRoom.ts   # BeloteRoom — assentos/times, ciclo de mãos, revanche, timeout
```

**`BeloteGame` — estados da mão:**

1. `dealing_round1` → `bidding_round1` — 5 cartas + carta virada; ronda de
   tomar/passar.
2. `bidding_round2` — só se os 4 passaram; escolha de naipe entre os 3
   restantes, ou passe geral (→ redistribuir, volta pro estado inicial com
   novo baralhador).
3. `announcing` (fase opcional — ver fases abaixo) — janela para anunciar
   combinações antes da 1ª carta.
4. `playing` — 8 vazas, com a lógica de "deve cortar / deve sobre-cortar
   salvo parceiro vencendo" descrita acima (a parte mais delicada do motor:
   precisa saber, a cada jogada, se o parceiro do jogador da vez está
   atualmente vencendo a vaza).
5. `hand_complete` — soma pontos, aplica dedans/capot/belote-rebelote,
   checa alvo.
6. `match_complete` — alvo atingido, aguardando revanche.

**Validação de jogada** precisa da função auxiliar
`isPartnerCurrentlyWinning(trick, playerId)` — decide se a obrigação de
"sobre-cortar" se aplica. Cobrir com testes dedicados (`bun test`), é o
ponto de maior risco de bug silencioso.

**Timeout de turno** (`BELOTE_TIMEOUT`, sugestão 30s): na licitação,
auto-passa; na jogada, auto-joga a **menor carta válida** (mesma filosofia
do Hearts — nunca punir desconexão com jogada aleatória "boba" que
prejudique o parceiro).

**`BeloteRoom`:** mesmo esqueleto do `TrucoRoom` (assentos 0–3, times
opostos, ciclo de mãos, votação de revanche, rodízio de baralhador),
adaptado pro ciclo de estados acima.

`index.ts`: `beloteRooms` como `Map` separado; roteamento via
`session.beloteRoomId` + `currentBeloteRoom()`, espelhando
`currentTrucoRoom()`.

### Tipos compartilhados (`shared/types.ts`)

Mensagens com prefixo `belote_` (`belote_room_joined`, `belote_state`,
`belote_bid`, `belote_play_card`, `belote_announce`, `belote_hand_result`,
etc.). Reusa `Card`/`Suit`/`Rank` — sem tipo de carta próprio.

### Arquitetura (front)

```
front/src/hooks/useBeloteGame.ts       # useReducer, filtra type.startsWith('belote_')
front/src/components/BeloteLobby.tsx   # criar/listar mesas (fixo 2x2, sem outras opções)
front/src/components/BeloteTable.tsx   # mesa: placar por dupla, carta virada + fase de licitação
                                        #   (botões tomar/passar, depois escolha de naipe na 2ª rodada),
                                        #   indicador de trunfo atual, vaza central, minha mão com
                                        #   jogadas inválidas desabilitadas (segue-naipe + corte),
                                        #   overlay de fim de mão (dedans/capot/belote-rebelote
                                        #   detalhado) e fim de partida/revanche
front/src/components/BeloteGuide.tsx   # painel de regras, shell .hand-guide-* reusado
```

Roteamento em `App.tsx`: nova aba `♦ Belote`.

### Fases sugeridas de implementação

1. **MVP do motor**: licitação (só 1ª+2ª rodada, sem "annonces"), jogo das
   8 vazas com corte/sobre-corte, pontuação de cartas + dix de der +
   belote-rebelote, dedans/capot, fim de partida. Cobrir com `bun test`
   antes de qualquer coisa de rede.
2. **`BeloteRoom` + roteamento no `index.ts`**.
3. **Front**: hook + lobby + tabela + guia (sem UI de annonces ainda).
4. **Fase 2 (opcional, depois do MVP validado em produção)**: annonces
   (tierce/quarte/quinte/carré) — fase `announcing` extra, comparação entre
   os 4 jogadores, UI de anúncio na tabela.

Antes de qualquer commit tocando isso: `cd server && bun test` e/ou
`cd front && bun x tsc -b`, conforme a Regra #1 do `CLAUDE.md`.
