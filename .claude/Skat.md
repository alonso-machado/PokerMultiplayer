# Skat — Regras e Plano de Implementação

Fonte: [Skat — Pagat.com (John McLeod)](https://www.pagat.com/skat/skat.html),
descrevendo a **Internationale Skatordnung** (regras oficiais alemãs/ISPA).
**Esta é a única fonte usada para este jogo** — mesma política do
[Blackjack.md](Blackjack.md)/[GoFish.md](GoFish.md): não foram consultadas
variações de clube/torneio. Skat é o jogo de cartas mais complexo do
catálogo até aqui (licitação em duelo + 3 tipos de jogo + fórmula de
multiplicador) — qualquer lacuna real é resolvida aqui por escrito.

> ⚠️ Este documento ainda **não tem código correspondente**. É a fonte da
> verdade para quando `server/src/skat/` for criado — ver
> [Plano de Implementação](#plano-de-implementação) no fim.

---

## Visão Geral

| | |
|---|---|
| Jogadores por mesa | **3 ativos por mão**. Mesa pode ter 3 (todos jogam sempre) ou 4 (o baralhador da vez fica de fora daquela mão — ver [4 Jogadores](#mesa-de-4-jogadores)) |
| Times | nenhum fixo — o "tomador" (declarante) joga **sozinho contra os outros 2** naquela mão; muda a cada mão |
| Baralho | **32 cartas** — do 7 ao Ás, sem 2 a 6, sem curinga (mesmo baralho do [Belote](Belote.md)) |
| Objetivo | maior pontuação acumulada após um número fixo de mãos (ou alvo, configurável) |
| Uma "mão" | distribuição → licitação em duelo → jogo (10 vazas) → pontuação |

---

## Baralho, Skat (Talão) e Distribuição

- **10 cartas** para cada um dos 3 jogadores ativos + **2 cartas reservadas
  à parte** chamadas **"Skat"** (o talão/viúva) — ninguém vê essas 2 cartas
  na distribuição.
- A fonte descreve a distribuição física em blocos (3 → 2 no Skat → 4 → 3);
  digitalmente isso não importa (não há risco de trapaça por ordem de
  distribuição) — **distribuir as 10 cartas de cada jogador e as 2 do Skat
  de uma vez** é equivalente e mais simples de implementar.
- Posições relativas ao baralhador (que roda a cada mão, sentido horário):

| Posição | Quem é | Papel |
|---|---|---|
| **Vorhand** (mão-frente) | jogador à esquerda do baralhador | lidera a 1ª vaza; licita **respondendo** no 1º duelo |
| **Mittelhand** (meio) | próximo | licita **propondo** no 1º duelo |
| **Hinterhand** (mão-trás) | o próprio baralhador | licita **propondo** no 2º duelo |

---

## Licitação ("Reizen") — em Duelo

A licitação acontece em **dois duelos sequenciais** com papéis fixos de
"quem propõe valores" (asker) e "quem responde sim/passo" (answerer):

1. **Duelo 1 — Mittelhand propõe, Vorhand responde.**
   Mittelhand diz um valor válido de jogo (ver [Tabela de Valores](#valor-do-jogo-spielwert)
   crescente a partir de 18); Vorhand responde **"sim"** (aceita continuar
   sendo desafiado a esse valor) ou **"passo"** (desiste). Se Vorhand disser
   sim, Mittelhand pode propor um valor **maior** (ou parar de propor —
   nesse caso Mittelhand "vence o duelo" com o último valor dito). O duelo
   termina quando:
   - Vorhand passa → **Mittelhand vence o duelo 1**, com o último valor que
     Vorhand aceitou.
   - Mittelhand não tem mais valores a propor / prefere não propor mais →
     **Vorhand vence o duelo 1** (por padrão, mesmo sem ter dito um número).
2. **Duelo 2 — Hinterhand propõe, o vencedor do duelo 1 responde.**
   Mesma mecânica: Hinterhand propõe valores crescentes, o vencedor do
   duelo 1 aceita ou passa.
   - Se o vencedor do duelo 1 passa → **Hinterhand vence** e vira o
     declarante.
   - Se Hinterhand não propõe mais → **o vencedor do duelo 1 vence**, e
     vira o declarante.
3. Se **ambos os jogadores de um duelo passam sem aceitar nenhum valor**
   (ninguém disse um número válido), **ninguém joga** — a mão pode virar
   **Ramsch** (ver [Ramsch](#ramsch---todos-passam)) ou ser redistribuída,
   dependendo da configuração da mesa.

O jogador que vence os dois duelos é o **declarante**, e o **valor final
licitado** (o maior número que ele aceitou/disse) é o **piso mínimo** que o
jogo dele precisa valer quando jogado — ver [Overbid](#lance-nao-cumprido-uberreizt).

---

## Contrato: Pegar o Skat ou Jogar "Hand"

Depois de vencer a licitação, o declarante escolhe:

- **Pegar o Skat**: vê as 2 cartas reservadas, incorpora à mão (fica com
  12 cartas), e descarta **2 cartas quaisquer** de volta, face-down — essas
  2 cartas descartadas contam nos pontos finais do declarante (somam pro
  monte de pontos dele, junto das vazas que vencer).
- **Jogar "Hand"** (sem pegar o Skat): joga com as 10 cartas originais; as
  2 cartas do Skat ficam fechadas e, ao final, **somam pros pontos do
  declarante** (contam como se fossem uma "vaza" dele) — **exceto** em jogo
  **Null**, onde o Skat nunca é revelado nem conta.
  Jogar "Hand" é **pré-requisito** para poder anunciar Schneider anunciado,
  Schwarz anunciado, ou jogar **Ouvert** (mão aberta) — ver
  [Multiplicador](#multiplicador-jogos-de-naipe-e-grande).

Depois de decidir, o declarante escolhe o **tipo de jogo**:

| Tipo | Trunfo |
|---|---|
| **Jogo de naipe** (Farbspiel) | um dos 4 naipes, escolhido pelo declarante |
| **Grande** (Grand) | só os 4 Valetes são trunfo |
| **Null** | **sem trunfo nenhum** — declarante tenta **não vencer nenhuma vaza** |

---

## Ranking das Cartas

### Jogo de naipe (naipe escolhido = trunfo)

Trunfo (11 cartas, do mais fraco ao mais forte):

| Ordem | Carta |
|---|---|
| 1 (mais fraca) | 7 do naipe trunfo |
| 2 | 8 do naipe trunfo |
| 3 | 9 do naipe trunfo |
| 4 | Dama (Q) do naipe trunfo |
| 5 | Rei (K) do naipe trunfo |
| 6 | 10 do naipe trunfo |
| 7 | Ás (A) do naipe trunfo |
| 8 | Valete de Ouros (J♦) |
| 9 | Valete de Copas (J♥) |
| 10 | Valete de Espadas (J♠) |
| 11 (mais forte) | Valete de Paus (J♣) |

Os outros 3 naipes (7 cartas cada, sem Valete — todos os 4 Valetes viraram
trunfo): do mais fraco ao mais forte, **7, 8, 9, Q, K, 10, A**.

### Grande (Grand)

Trunfo = só os **4 Valetes**, mesma ordem de força de cima (J♦ < J♥ < J♠ <
J♣). Os outros 28 cartas, divididas em 4 naipes de 7 cada (sem Valete):
mesma ordem **7, 8, 9, Q, K, 10, A**.

### Null

**Sem trunfo.** Cada naipe segue a ordem **natural** (diferente dos outros
2 modos — o Valete volta pro lugar dele entre Dama e 10, e o 10 NÃO é mais
"quase Ás"):

| Ordem | Carta |
|---|---|
| 1 (mais fraca) | 7 |
| 2 | 8 |
| 3 | 9 |
| 4 | 10 |
| 5 | Valete (J) |
| 6 | Dama (Q) |
| 7 | Rei (K) |
| 8 (mais forte) | Ás (A) |

---

## Regras de Jogada

- Vorhand lidera a 1ª vaza; vencedor de cada vaza lidera a próxima.
- **Deve seguir o naipe pedido** se tiver carta desse naipe (no jogo de
  naipe/Grande, os 4 Valetes contam como pertencentes ao "naipe trunfo"
  para efeito de seguir — **não** ao naipe impresso na carta).
- Sem carta do naipe pedido: pode jogar **qualquer carta**, inclusive
  trunfo (não há obrigação de "cortar" no Skat, diferente do Belote).
- Vence a vaza o trunfo mais alto jogado; se nenhum trunfo foi jogado,
  vence a carta mais alta do naipe pedido.

---

## Valor das Cartas (jogo de naipe / Grande)

| Carta | Pontos |
|---|---|
| Ás (A) | 11 |
| 10 | 10 |
| Rei (K) | 4 |
| Dama (Q) | 3 |
| Valete (J) | 2 |
| 9, 8, 7 | 0 |

Total fixo: **120 pontos** nas 32 cartas (4 × 30). O declarante precisa de
**mais de 60** (≥ 61) pra vencer o jogo. **Não se usam pontos de carta no
Null** — lá o critério é puramente "não vencer nenhuma vaza".

---

## Valor do Jogo (Spielwert)

### Valor base por tipo

| Tipo | Valor base |
|---|---|
| Ouros (♦) | 9 |
| Copas (♥) | 10 |
| Espadas (♠) | 11 |
| Paus (♣) | 12 |
| Grande (Grand) | 24 |
| Null | 23 (fixo — ver tabela própria abaixo, não usa multiplicador) |

### Multiplicador (jogos de naipe e Grande)

`multiplicador = matadores + 1 + bônus aplicáveis`

**Matadores:** conta-se a sequência **ininterrupta** dos trunfos mais
fortes a partir do topo (J♣ → J♠ → J♥ → J♦ → 7 mais alto do naipe trunfo
restante em Grande não se aplica, pois Grande só tem os 4 Valetes como
trunfo — nesse caso a sequência para nos 4 Valetes) na qual **todas** as
cartas estão do mesmo lado: **todas na mão do declarante** ("mit N") **ou**
**todas fora da mão do declarante** ("ohne N"). N = matadores. Sempre ≥ 1
(o declarante ou tem o J♣, contando "mit" a partir dele, ou não tem,
contando "ohne" a partir do topo).

**Bônus** (cada um soma **+1** ao multiplicador, se aplicável):

| Bônus | Condição |
|---|---|
| Hand | jogou sem pegar o Skat |
| Schneider | oponentes somaram **≤ 30** pontos de carta (declarante fez ≥ 90) |
| Schneider anunciado | declarante anunciou Schneider **antes** de jogar (exige Hand) — precisa cumprir, senão o jogo conta como perdido |
| Schwarz | declarante venceu **as 10 vazas** |
| Schwarz anunciado | anunciado antes de jogar (exige Hand) — precisa cumprir |
| Ouvert | declarante joga com a mão **virada pra cima**, visível a todos, desde a 1ª carta (exige Hand; implica jogar visando Schwarz — se não vencer todas as vazas com a mão aberta, perde) |

Valor final do jogo = **valor base × multiplicador**.

### Null — valores fixos (não usa multiplicador)

| Variante | Valor |
|---|---|
| Null (pega o Skat) | 23 |
| Null Hand | 35 |
| Null Ouvert (pega o Skat, joga com a mão aberta) | 46 |
| Null Hand Ouvert | 59 |

---

## Resultado da Mão

- **Jogo de naipe/Grande, declarante vence** (≥ 61 pontos de carta, e
  cumpriu qualquer Schneider/Schwarz anunciado): declarante soma
  **+valor do jogo** ao placar. Os outros 2 jogadores não pontuam nessa mão
  (não há placar negativo pra eles — só o declarante ganha/perde pontos).
- **Jogo de naipe/Grande, declarante perde** (≤ 60 pontos, ou não cumpriu
  Schneider/Schwarz anunciado): declarante soma **−2 × valor do jogo**
  (calculado com o tipo/multiplicador realmente jogado, não o valor
  licitado). Os outros 2 não pontuam.
- **Null, declarante não venceu nenhuma vaza**: soma **+valor fixo**
  (23/35/46/59 conforme a variante).
- **Null, declarante venceu ao menos 1 vaza**: soma **−2 × valor fixo** da
  variante escolhida.

### Lance Não Cumprido ("Überreizt")

Se o **valor do jogo realmente jogado** (base × multiplicador com os
matadores/bônus reais) for **menor que o valor licitado** no duelo, o
declarante **"passou do ponto"**: o jogo conta automaticamente como
**perdido**, com a penalidade calculada sobre o **valor realmente jogado**
(não o valor licitado) — ex.: declarante licitou 24 mas só tinha matadores
+ bônus pra um jogo de naipe que vale 20 → perde automaticamente, soma
**−40** (2× 20), mesmo que tivesse feito ≥ 61 pontos de cartas.

Isso empurra o declarante a **escolher Grande/Hand/anunciar Schneider** o
suficiente pra justificar o que licitou, ou a **não licitar mais do que
consegue sustentar**.

---

## Ramsch — Todos Passam

Se **ninguém** aceita nenhum valor nos dois duelos (todos passam), a mão
não tem declarante. **Configurável por mesa** (a fonte trata como variante
regional, não regra universal):

- **Modo `redeal`** (padrão sugerido pra MVP): a mão é descartada sem
  pontuação, baralhador roda, redistribui.
- **Modo `ramsch`** (opcional, fase 2): joga-se **sem trunfo declarado
  fixo** — variante mais comum: **Grande é o trunfo automático** (só os 4
  Valetes), cada jogador tenta **fazer o MENOS pontos possível** (jogo
  "de perde-ganha", ninguém quer vazas). Quem fizer mais pontos de carta ao
  final soma **negativo** no placar; o Skat vai pra quem vencer a **última
  vaza** (soma nos pontos dele, regra "Skat geht auf den Letzten"). Detalhe
  de implementação isolado — não bloqueia o MVP.

---

## Mesa de 4 Jogadores

Com 4 jogadores na mesa, **o baralhador da vez fica de fora daquela mão**
(não recebe cartas, não licita, não pontua nela) — só os outros 3 jogam.
O baralhador roda em sentido horário a cada mão, então em 4 mãos cada
jogador senta fora exatamente 1 vez. Isso é uma extensão estrutural real
(rotação de "quem está sentado jogando" independente de "quem está na
mesa") — ver [Fases de Implementação](#fases-sugeridas-de-implementação).

---

## Fim de Partida

- Placar acumulado mão a mão, sem teto natural (cada jogador soma/perde
  pontos independente dos outros, diferente de Truco/Belote onde só existe
  "quem chega no alvo primeiro").
- **Critério de fim configurável na criação da mesa** (a fonte não define
  um único padrão — jogo de clube tradicionalmente usa um número fixo de
  "voltas" de baralho):
  - **`hands`**: partida dura um número fixo de mãos (múltiplo de 3, pra
    todos baralharem o mesmo número de vezes — sugestão padrão **24 mãos**
    com 3 jogadores, **24 ou 32 mãos** com 4). Vence quem tiver **mais
    pontos** ao final.
  - **`target`**: primeira mão em que alguém atinge/ultrapassa uma
    pontuação-alvo encerra a partida **ao final daquela mão** — vence quem
    tiver mais pontos (não necessariamente quem bateu o alvo primeiro,
    já que só o declarante pontua por mão).
- Votação de revanche: mesmo padrão dos outros jogos — todos aceitam zera
  placar e reinicia rotação de baralhador; qualquer recusa/timeout fecha a
  mesa.

---

## Plano de Implementação

### Arquitetura (server)

Sistema **totalmente paralelo**, o mais complexo do catálogo até aqui —
única mecânica nova de licitação em **duelo de 2 rounds** (nem o leilão
livre nem a escalada do Truco se aplicam):

```
server/src/skat/
├── deck.ts          # baralho de 32 cartas, ranking triplo (naipe / grande / null)
└── gameEngine.ts     # SkatGame — máquina de estados
server/src/skatRoom.ts   # SkatRoom — assentos (3 ou 4), ciclo de mãos, rotação de sentar-fora, revanche, timeout
```

**`SkatGame` — estados da mão:**

1. `dealing` — distribui 10+10+10+2(Skat).
2. `bidding_duel1` — Mittelhand propõe / Vorhand responde.
3. `bidding_duel2` — Hinterhand propõe / vencedor do duelo 1 responde.
4. `no_bidder` — todos passaram → resolve conforme modo Ramsch/redeal da
   mesa.
5. `contract_decision` — declarante decide pegar Skat (e descarta 2) ou
   jogar Hand; escolhe tipo de jogo (naipe/Grande/Null) e, se Hand,
   opcionalmente anuncia Schneider/Schwarz/Ouvert **antes** da 1ª carta.
6. `playing` — 10 vazas.
7. `hand_complete` — calcula pontos de carta, valor do jogo real, checa
   Überreizt, aplica placar (só o declarante muda).
8. `match_complete` — critério de fim (`hands`/`target`) atingido.

**Funções auxiliares que precisam de teste dedicado** (`bun test`), maior
risco de bug silencioso do catálogo:
- `countMatadors(declarerHand, gameType, trumpSuit)` — "mit N" / "ohne N".
- `computeGameValue(gameType, matadors, bonuses)` — multiplicador completo.
- `checkUberreizt(bidValue, actualGameValue)`.
- `rankCard(card, gameType, trumpSuit)` — 3 tabelas de ranking diferentes
  (naipe, Grande, Null) que **não podem** compartilhar a mesma função ingênua
  de "rank do baralho" usada em Poker/Truco/Belote.

**Timeout de turno** (`SKAT_TIMEOUT`, sugestão 30s):
- Durante licitação: auto-passa.
- Durante jogo: auto-joga a **menor carta válida** (segue-naipe, sem regra
  de corte obrigatório — mais simples que Belote aqui).
- Durante `contract_decision`: timeout força **pegar o Skat + descartar as
  2 cartas de menor valor** e jogar o **naipe onde o declarante tem mais
  cartas** (heurística simples, nunca Null/Hand/anúncios — evita punir
  desconexão com um contrato agressivo que ele não escolheu).

**`SkatRoom`:**
- Suporta **3 ou 4 assentos**, decidido na criação da mesa.
- Com 4: campo `sittingOutSeat` rotaciona a cada mão junto com o
  baralhador; o jogador sentado fora daquela mão fica em estado
  `spectating_hand` (vê o jogo, não recebe cartas, não age).
- `index.ts`: `skatRooms` como `Map` separado; roteamento via
  `session.skatRoomId` + `currentSkatRoom()`, espelhando os outros jogos.

### Tipos compartilhados (`shared/types.ts`)

Mensagens com prefixo `skat_` (`skat_room_joined`, `skat_state`,
`skat_bid`, `skat_bid_response`, `skat_contract_decision`,
`skat_play_card`, `skat_hand_result`, etc.). Reusa `Card`/`Suit`/`Rank` —
sem tipo de carta próprio. Precisa de um tipo `SkatGameType = 'suit' |
'grand' | 'null'` e um tipo pros bônus anunciados (`SkatAnnouncement =
'schneider' | 'schwarz' | 'ouvert'`, cada um só válido junto com `hand:
true`).

### Arquitetura (front)

```
front/src/hooks/useSkatGame.ts       # useReducer, filtra type.startsWith('skat_')
front/src/components/SkatLobby.tsx   # criar/listar mesas (3 ou 4 jogadores, critério de fim hands/target)
front/src/components/SkatTable.tsx   # mesa: placar individual, indicador de baralhador/sentado-fora
                                      #   (mesa de 4), UI de duelo de licitação (números crescentes,
                                      #   sim/passo), decisão de contrato (pegar Skat + descartar 2 /
                                      #   Hand + anúncios), indicador de tipo de jogo + trunfo atual,
                                      #   vaza central, minha mão com jogadas inválidas desabilitadas,
                                      #   overlay de fim de mão (pontos de carta, valor do jogo,
                                      #   Überreizt se aplicável) e fim de partida/revanche
front/src/components/SkatGuide.tsx   # painel de regras, shell .hand-guide-* reusado — provavelmente
                                      #   o guia mais longo do catálogo dado o número de conceitos
```

Roteamento em `App.tsx`: nova aba `♣ Skat`.

### Fases sugeridas de implementação

1. **MVP do motor, mesa fixa de 3 jogadores, sem Ramsch/Ouvert/4º jogador**:
   distribuição, licitação em duelo (2 rounds), contrato (pegar Skat ou
   Hand, incluindo anúncios de Schneider/Schwarz quando Hand), jogo de
   naipe + Grande + Null, `countMatadors`, `computeGameValue`,
   `checkUberreizt`, pontuação, fim de partida por `hands` ou `target`.
   Modo "todos passam" resolve sempre como `redeal` nessa fase (Ramsch
   fica pra depois). Cobrir cada função auxiliar com `bun test` antes de
   qualquer rede.
2. **`SkatRoom` + roteamento no `index.ts`** (mesa de 3 apenas).
3. **Front**: hook + lobby + tabela + guia.
4. **Fase 2 (depois do MVP validado em produção)**:
   - Suporte a mesa de 4 jogadores (rotação de sentar-fora).
   - Modo Ramsch quando todos passam.
   - Ouvert (naipe/Grande, não só Null) — a fonte também permite Ouvert em
     jogos de naipe/Grande em algumas variantes; **decisão própria**: MVP
     restringe Ouvert a Null (mais simples e mais comum), naipe/Grande
     Ouvert fica pra essa fase se houver demanda.

Antes de qualquer commit tocando isso: `cd server && bun test` e/ou
`cd front && bun x tsc -b`, conforme a Regra #1 do `CLAUDE.md`.
