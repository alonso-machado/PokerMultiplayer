# PushYourLuckDraw — Regras e Plano de Implementação

Fonte: **regra original**, definida pelo Alonso nesta conversa. É um jogo
de mecânica **push-your-luck** ("pedir carta ou parar", arriscando perder
tudo a cada compra) usando um **baralho comum** (naipes/valores normais de
carta de baralho) — sem cards de power-up nem regra de parar
automaticamente ao juntar um número fixo de cartas únicas. O **naipe não
importa em nenhuma regra** (só o valor/rank conta) — cartas "comuns" aqui
servem só de material visual, não de baralho físico de 52 (ver
[Baralho](#baralho)).

Como é um jogo **inventado pra este projeto** (não uma adaptação de regras
publicadas por terceiros), **este documento é a única fonte da verdade** —
não existe "regra oficial" externa a conferir depois. Qualquer ajuste de
regra deve ser discutido e atualizado aqui antes de mudar o código.

> ⚠️ Este documento ainda **não tem código correspondente**. É a fonte da
> verdade para quando `server/src/pushyourluckdraw/` for criado — ver
> [Plano de Implementação](#plano-de-implementação) no fim.

---

## Visão Geral

- Jogo de **risco progressivo** (push-your-luck) tipo "pedir carta sem
  estourar", mas o estouro aqui não é por **soma passar de um número**
  (como no Blackjack) — é por **repetir um valor de carta** que o próprio
  jogador já tem na rodada.
- Todos os jogadores competem contra o **mesmo baralho compartilhado**, sem
  dealer/banca (diferente do [Blackjack](Blackjack.md)) — mais parecido
  com o Go Fish nesse sentido (par-contra-par, sem casa).
- Uma "partida" é feita de **várias rodadas**, até alguém bater a
  pontuação-alvo.

| | |
|---|---|
| Jogadores por mesa | **2 a 8**, escolhido na criação da sala (sem times) |
| Baralho | baralho próprio de **95 cartas** — ver [Baralho](#baralho) |
| Modo de baralho | **`fresh`** (padrão) ou **`persistent`**, escolhido na criação da mesa — ver [Modo de Baralho](#modo-de-baralho) |
| Pontuação-alvo | **150** por padrão, configurável na criação da mesa |
| Uma "rodada" | todos os jogadores ativos decidem, turno a turno, entre **Pedir carta** ou **Parar**, até todos terem parado ou estourado |

---

## Baralho

Baralho **próprio**, sem relação com nenhum baralho físico de 52 — a regra
de montagem é **"quantidade de cópias = valor da carta"**, aplicada a
**todos** os ranks numerados de 2 a K, sem teto em 4 (diferente do que
qualquer baralho físico normal permitiria):

| Carta | Cópias no baralho | Valor de pontuação |
|---|---|---|
| Ás de Espadas (só ele — os outros 3 áses **não entram** no baralho) | **1** | ver [Poder do Ás](#poder-do-ás-de-espadas) |
| 2 | 2 | 2 |
| 3 | 3 | 3 |
| 4 | 4 | 4 |
| 5 | 5 | 5 |
| 6 | 6 | 6 |
| 7 | 7 | 7 |
| 8 | 8 | 8 |
| 9 | 9 | 9 |
| 10 | 10 | 10 |
| Valete (J) | 11 | 11 |
| Dama (Q) | 12 | 12 |
| Rei (K) | **13** | 13 |
| **Coringa ("Save")** | 4 | 0 (não conta como valor — ver [Coringa](#coringa-save)) |

Total: `1+2+3+4+5+6+7+8+9+10+11+12+13` (soma de 1 a 13) `+ 4` coringas =
**95 cartas**.

Essa é a mecânica central do jogo: quanto **maior** o valor da carta,
**mais cópias** dela existem no monte — então cartas altas (J/Q/K) são ao
mesmo tempo as que mais valem pontos **e** as que têm mais risco de
duplicar (mais cópias rodando = maior chance estatística de puxar outra
igual depois de já ter uma na mão).

**Nota de implementação:** como muitos ranks têm mais de 4 cópias (ex.: 13
Reis), o baralho **não** corresponde a um maço físico real de naipes — pra
exibição, cada cópia extra de um rank pode ciclar pelos 4 naipes
(♠♥♦♣♠♥♦♣...) sem repetir naipe+valor de forma capricho — mas isso é
**puramente cosmético**: naipe não tem nenhum papel na regra (a checagem
de duplicata/estouro é só por **rank**, nunca por naipe).

---

## Modo de Baralho

Escolhido na criação da mesa — **não muda durante a partida** (mesmo
espírito da variante de manilha do [Truco](Truco.md)).

### `fresh` (padrão)

O monte é **embaralhado do zero a cada rodada**, com as 95 cartas
inteiras — nenhuma carta jogada numa rodada anterior tem efeito nas
próximas (sem sapata persistente entre rodadas, mesmo padrão do
Blackjack). Cada rodada é estatisticamente independente das outras.

### `persistent`

O monte **não** é reconstruído a cada rodada — continua de onde parou,
igual a um monte/descarte de verdade (mesmo conceito de monte + lixo já
usado na [Canastra](Canastra.md)):

- No **início da partida** (e só aí — ou depois de uma revanche aceita,
  que conta como nova partida), monta e embaralha o baralho completo de 95
  cartas como monte inicial, com um descarte vazio.
- Ao final de **cada rodada**, todas as cartas que estiveram na mão da
  rodada de qualquer jogador (de quem parou, de quem estourou, e as
  descartadas por causa de um "save" de Coringa) vão para o **descarte** —
  elas **não** voltam a fazer parte do monte automaticamente.
- A próxima rodada continua puxando do **mesmo monte**, sem reembaralhar.
- Se o monte esgotar (dentro de uma rodada ou entre rodadas), embaralha
  **todo o descarte acumulado até então** (de todas as rodadas da
  partida, não só da rodada atual) formando um novo monte — mesma
  mecânica de [Esgotamento do Monte](#esgotamento-do-monte), só que a
  origem do descarte agora é cumulativa entre rodadas, não só dentro de
  uma rodada.
- **Efeito de jogo real**: como o monte só é reembaralhado quando esgota,
  cartas de valor alto (que existem em mais cópias) ou os 4 Coringas podem
  ficar **temporariamente escassos ou indisponíveis** por várias rodadas
  seguidas depois de serem muito puxados — a composição do monte "visível"
  (o que ainda pode sair) muda de rodada pra rodada dentro da mesma
  partida, ao contrário do modo `fresh`.

---

## Turno e Ações

- Ordem de assento fixa, sentido horário; jogador inicial roda a cada
  rodada (mesmo padrão de rodízio dos outros jogos).
- Na vez de cada jogador **ainda ativo na rodada** (não parou, não
  estourou), duas ações possíveis:
  - **Pedir carta** ("Draw"): compra 1 carta do monte, vira pra própria
    área (pública a todos).
  - **Parar** ("Stop"): encerra a participação do jogador **nesta rodada**
    com a pontuação atual da mão travada — ele não joga mais até a próxima
    rodada, mas continua "no jogo" (diferente de estourar).
- Cada turno resolve **exatamente 1 decisão** — ao pedir carta e não
  estourar, a vez passa pro próximo jogador ainda ativo (não há "pedir
  várias vezes seguidas" no mesmo turno, mesmo modelo de turno único do
  Blackjack).
- Jogadores que já pararam ou estouraram são **pulados** na rotação de
  turnos daquela rodada.

---

## Regra de Estouro (Duplicata)

- Cada jogador mantém sua própria "mão da rodada" (as cartas de valor que
  já comprou nessa rodada, todas públicas).
- Se a carta comprada tem **o mesmo valor de rank** de uma carta que o
  jogador **já tem na mão desta rodada**, isso é um **estouro**:
  - **Sem Coringa guardado:** o jogador estoura — perde **todas** as
    cartas da mão da rodada, pontua **0 nesta rodada**, e fica fora das
    jogadas até a próxima rodada (mesmo tratamento de "parado", mas com
    pontuação zerada em vez de travada).
  - **Com pelo menos 1 Coringa guardado** (ver abaixo): o estouro é
    **evitado automaticamente** — descarta **1 Coringa** da reserva do
    jogador **e** descarta a carta duplicada recém-comprada (ela **não**
    entra na mão), e o turno passa normalmente como se tivesse comprado
    sem estourar. Se o jogador tiver mais de 1 Coringa, só **1** é gasto
    por evento de estouro evitado.
- O Ás de Espadas nunca pode causar estouro por duplicata na prática (só
  existe **1 cópia** no baralho inteiro) — a lógica de estouro é genérica
  (compara valor de rank), não precisa de caso especial pro Ás no código;
  isso é só uma consequência natural da composição do baralho, documentada
  aqui pra não ser "corrigida" à toa depois.

---

## Coringa ("Save")

- Ao comprar um Coringa, ele **não conta como carta de valor** (não soma
  pontos, não conta como "já tenho esse valor" pra checagem de duplicata,
  não pode por si causar estouro) — vai pra uma **reserva separada** do
  jogador (`savesHeld`), visível a todos.
- Comprar um Coringa consome o turno normalmente (like comprar qualquer
  carta) — não dá ação extra.
- Coringas guardados só têm efeito **na rodada em que foram comprados** —
  ao final da rodada (parou, estourou, ou a rodada termina pra ele de
  qualquer forma), qualquer Coringa não usado **é perdido** junto com o
  resto da mão (não acumula pra rodada seguinte). Isso evita "bancar"
  Coringas indefinidamente entre rodadas.

---

## Poder do Ás de Espadas

- O Ás de Espadas **não soma valor próprio** à pontuação da rodada (não
  vale "1 ponto") — sua função é **multiplicar por 2 a soma de todas as
  outras cartas** da mão da rodada do jogador.
- Só tem efeito se o jogador **parar (ou a rodada terminar) com o Ás ainda
  na mão** — se o jogador estourar naquela rodada, perde a mão inteira
  (incluindo o Ás) e não pontua nada, multiplicador incluído.
- Fórmula de pontuação de quem tem o Ás ao travar a mão:
  `pontos_da_rodada = soma_dos_valores_das_outras_cartas × 2`.

---

## Fim de Rodada e Pontuação

- A rodada termina quando **todos os jogadores ativos** da mesa
  pararam ou estouraram (nenhuma decisão pendente).
- Pontuação de cada jogador nessa rodada:
  - **Estourou:** 0 pontos.
  - **Parou (ou ficou sem decisão porque o monte esgotou de vez — ver
    abaixo) sem Ás:** soma direta dos valores das cartas na mão.
  - **Parou com o Ás de Espadas na mão:** soma das outras cartas × 2 (ver
    acima).
- Pontos da rodada somam ao placar acumulado de cada jogador.
- Depois de somar, checa se **algum jogador atingiu ou ultrapassou a
  pontuação-alvo** (padrão 150). Se sim, a partida termina **ao final
  dessa rodada** (nunca no meio) — vence quem tiver **a maior pontuação**
  entre todos (não necessariamente só quem bateu o alvo, já que outro
  jogador pode ter uma pontuação acumulada maior ainda sem ter cruzado o
  alvo sozinho naquela rodada — mesmo espírito do critério de fim do
  [Skat](Skat.md)).
  - Empate exato no topo: **resolução própria** (sem critério na regra
    original) — os empatados dividem a vitória, mesmo tratamento do
    [Hearts](Hearts.md)/[Belote](Belote.md).
- Se ninguém bateu o alvo, roda o dealer/jogador inicial em +1 e começa
  nova rodada:
  - **Modo `fresh`**: monte reembaralhado do zero, 95 cartas de novo.
  - **Modo `persistent`**: continua do monte atual (cartas da rodada que
    terminou vão pro descarte acumulado, sem reembaralhar, salvo
    esgotamento — ver abaixo).

### Esgotamento do Monte

Se o monte esgotar **no meio de uma rodada** (ou já começar uma rodada sem
cartas suficientes, possível só no modo `persistent`) e ainda houver
jogador decidindo entre pedir/parar:
- **Modo `fresh`**: embaralha as cartas descartadas por **estouro**
  naquela rodada (as cartas perdidas de quem já estourou) formando um
  novo monte, e continua normalmente.
- **Modo `persistent`**: embaralha **todo o descarte acumulado da
  partida** até aquele momento (não só desta rodada — ver
  [Modo de Baralho](#modo-de-baralho)) formando um novo monte, e continua
  normalmente.
- Se mesmo assim não houver carta suficiente (caso extremo, praticamente
  impossível com até 8 jogadores num baralho de 95), qualquer jogador ainda
  ativo sem carta pra comprar é tratado como **parado automaticamente**
  com a pontuação atual da mão (nunca como estouro forçado).

---

## Timeout de Turno

`PUSHYOURLUCKDRAW_TIMEOUT` (sugestão 20s, mesmo espírito da janela de aposta
do Blackjack): sem ação, o jogador **para automaticamente** com a
pontuação atual da mão — nunca pede carta às cegas por ele (evita punir
desconexão com um estouro que o jogador não escolheu).

---

## Sair da Mesa

Sair no meio de uma rodada com mão em aberto **perde a pontuação daquela
rodada** (tratado como se tivesse parado com 0, não conta pro placar
acumulado — mas o placar acumulado de rodadas **anteriores** permanece
registrado até ele sair de fato da mesa). Sair antes de qualquer carta
comprada na rodada atual não perde nada, já que não havia pontuação em
aberto.

---

## Plano de Implementação

### Arquitetura (server)

Sistema **totalmente paralelo**, sem times — arquitetura mais próxima do
Go Fish (mesa livre 2-8, sem dealer/banca) na estrutura de sala, mas com o
**modelo de turno hit/stand do Blackjack** (uma decisão por vez, sem
comprar múltiplas cartas no mesmo turno):

```
server/src/pushyourluckdraw/
├── deck.ts          # baralho próprio de 95 cartas (não reusa createDeck do poker — composição de cópias é diferente)
└── gameEngine.ts     # PushYourLuckDrawGame — máquina de estados
server/src/pushyourluckdrawRoom.ts   # PushYourLuckDrawRoom — assentos, ciclo de rodadas, timeout, fim de partida
```

**`PushYourLuckDrawGame` — estados da rodada:**

1. `playing` — turnos sequenciais de pedir/parar entre os jogadores ainda
   ativos (estado único — não há sub-fases como aposta/distribuição
   separadas, já que não há aposta em fichas neste jogo).
2. `round_complete` — todos pararam/estouraram; pontuação calculada,
   placar atualizado.
3. `match_complete` — alvo atingido, aguardando revanche.

**Estado do baralho não é "por rodada", é do jogo inteiro** — diferença
importante em relação aos outros jogos do catálogo: `monte` e `descarte`
vivem no nível da `PushYourLuckDrawGame` (ou de um objeto persistido pela
`Room` entre partidas de `PushYourLuckDrawGame`), não são recriados a cada
`playing`. No modo `fresh`, o início de cada rodada só chama
`buildDeck()` de novo e ignora qualquer descarte anterior; no modo
`persistent`, o início de rodada **reaproveita** o `monte`/`descarte` que
sobrou da rodada anterior — só uma nova **partida** (`match_complete` →
revanche aceita) reseta pra um baralho novo de 95 cartas.

**Funções auxiliares que precisam de teste dedicado** (`bun test`):
- `buildDeck()` — validar a composição exata (cópias(rank) = valor(rank)
  para 2 ao K, 1 Ás, 4 coringas = 95 cartas).
- `checkDuplicate(playerRoundHand, drawnCard)` — decide estouro, ignorando
  coringas na comparação.
- `applyJokerSave(player)` — consome 1 coringa da reserva, descarta a
  carta duplicada, **não** marca estouro.
- `computeRoundScore(playerRoundHand, hasAce)` — soma + multiplicador do
  Ás, só se o jogador não estourou.
- `startNewRound(game, deckMode)` — no modo `fresh`, reconstrói o monte do
  zero; no modo `persistent`, move as cartas da rodada que terminou pro
  descarte acumulado e mantém o monte como está. Cobrir os dois modos com
  testes separados — é o ponto mais fácil de inverter por engano.
- `reshuffleIfEmpty(game, deckMode)` — no `fresh`, recicla só o descarte
  da rodada atual; no `persistent`, recicla o descarte acumulado da
  partida inteira (ver [Esgotamento do Monte](#esgotamento-do-monte)).

**Diferença chave em relação ao Blackjack:** não existe "banca" comprando
por conta própria nem aposta de fichas — o motor só orquestra turnos entre
jogadores reais, então não tem uma fase equivalente à "jogada do dealer".

**`PushYourLuckDrawRoom`:**
- Assentos livres, 2 a 8 (definido na criação, mesmo padrão do Go Fish).
- Ciclo: nova rodada → embaralha → turnos → pontuação → checa alvo →
  próxima rodada ou fim de partida → votação de revanche (mesmo mecanismo
  dos outros jogos: todos aceitam zera placar e reinicia; qualquer
  recusa/timeout fecha a mesa).
- `index.ts`: `pushyourluckdrawRooms` como `Map` separado; roteamento via
  `session.pushyourluckdrawRoomId` + `currentPushYourLuckDrawRoom()`,
  espelhando `currentGoFishRoom()`.

### Tipos compartilhados (`shared/types.ts`)

Mensagens com prefixo `pushyourluckdraw_` (`pushyourluckdraw_room_joined`,
`pushyourluckdraw_state`, `pushyourluckdraw_draw`, `pushyourluckdraw_stop`,
`pushyourluckdraw_round_result`, `pushyourluckdraw_match_complete`, etc.).
**Precisa de um tipo de carta próprio** (diferente do Go Fish, que reusa
`Card` comum) porque o baralho não é um baralho padrão de 52 — sugestão:

```ts
type PushYourLuckDrawCard =
  | { kind: 'ace_of_spades' }
  | { kind: 'number'; value: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 }
  | { kind: 'joker'; id: string } // id único — 4 cópias indistinguíveis por valor
```

### Arquitetura (front)

```
front/src/hooks/usePushYourLuckDrawGame.ts       # useReducer, filtra type.startsWith('pushyourluckdraw_')
front/src/components/PushYourLuckDrawLobby.tsx   # criar/listar mesas (nome + máximo de jogadores 2-8 +
                                                #   alvo de pontos, padrão 150 + modo de baralho fresh/persistent)
front/src/components/PushYourLuckDrawTable.tsx   # mesa: placar acumulado de todos, jogador da vez em destaque,
                                                #   mão da rodada de cada jogador visível (cartas + coringas
                                                #   guardados), botões Pedir/Parar na minha vez, indicador de
                                                #   Ás de Espadas (multiplicador ativo) na mão de quem tiver,
                                                #   contador de cartas restantes no monte (mais relevante no
                                                #   modo `persistent`, onde ele encolhe entre rodadas), overlay
                                                #   de fim de rodada (quem estourou, pontuação de cada um) e
                                                #   fim de partida/revanche
front/src/components/PushYourLuckDrawGuide.tsx   # painel de regras, shell .hand-guide-* reusado
```

Roteamento em `App.tsx`: nova aba `🍀 Push Your Luck`.

### Fases sugeridas de implementação

1. **Motor puro** (`gameEngine.ts` + `deck.ts` + testes `bun test`):
   composição do baralho, turnos pedir/parar, checagem de duplicata,
   salvamento por coringa, multiplicador do Ás, pontuação, esgotamento de
   monte, fim de partida — sem rede.
2. **`PushYourLuckDrawRoom` + roteamento no `index.ts`**.
3. **Front**: hook + lobby + tabela + guia.
4. **Testes de integração** ponta a ponta (opcional, se o padrão dos
   outros jogos tiver isso).

Antes de qualquer commit tocando isso: `cd server && bun test` e/ou
`cd front && bun x tsc -b`, conforme a Regra #1 do `CLAUDE.md`.
