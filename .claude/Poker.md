# Poker Texas Hold'em — Regras Implementadas

## Visão Geral do Jogo

Texas Hold'em com suporte a 2–6 jogadores. Cada mão segue as fases:
`preflop → flop → turn → river → showdown`.

---

## Estrutura de uma Mão

### Posições

| Posição | Descrição |
|---|---|
| Dealer (BTN) | Último a agir no pós-flop. Posta nada. |
| Small Blind (SB) | Obrigado a postar metade do big blind. |
| Big Blind (BB) | Obrigado a postar o big blind. Último a agir no pré-flop. |
| UTG (Under the Gun) | Primeiro a agir no pré-flop. Posta o ante (se configurado). |

**Heads-up (2 jogadores):** Dealer = SB, o outro é BB. UTG = Dealer (age primeiro
no pré-flop, último no pós-flop) — regra oficial do heads-up.

### Ante

- O ante é postado apenas pelo **UTG** (não por todos os jogadores).
- É **dead money** — vai para o pot mas **não** conta como bet live do UTG.
- UTG ainda precisa chamar, subir ou foldar o big blind normalmente.
- Com **2 jogadores (heads-up)** não há ante, independente da configuração.

### Deal

- 2 cartas hole são distribuídas para cada jogador ativo (round-robin).
- As cartas são **privadas** — cada jogador vê apenas as suas.
- O servidor envia `hand_dealt` com `yourCards` apenas para o destinatário.

---

## Betting Streets

### Pré-flop

- Primeiro a agir: **UTG** (player após o BB).
- Last to act: **BB** (pode raise mesmo que todos tenham chamado).

### Flop / Turn / River (pós-flop)

- Primeiro a agir: **primeiro jogador ativo à esquerda do Dealer**.
- 1 carta de burn antes de revelar cada street.
- Flop: 3 cartas. Turn: 1 carta. River: 1 carta.

---

## Ações Disponíveis

| Ação | Quando disponível | Efeito |
|---|---|---|
| `fold` | Sempre | Desiste da mão |
| `check` | `bet == currentBet` (sem dívida) | Passa a vez sem apostar |
| `call` | `chips >= (currentBet - bet)` | Iguala a aposta atual |
| `raise` | `chips > (currentBet - bet)` | Aumenta a aposta |
| `all-in` | `chips > 0` | Aposta todos os chips |

### Min Raise

`minRaise = bigBlind × 2` no início de cada street. Após um raise, `minRaise` =
diferença entre o novo `currentBet` e o anterior.

**Regra TDA 2024:** um raise deve ser pelo menos do tamanho do maior raise anterior
da mesma street. O servidor rejeita `raise` com `amount < currentBet + minRaise`.

### Restrição de re-raise após all-in parcial

| Situação | Reabre ação? | Efeito |
|---|---|---|
| All-in ≥ `minRaise` (full raise) | **Sim** — todos podem re-raise | `minRaise` atualiza, `noReraiseIds` limpo |
| All-in < `minRaise` (partial raise) | **Não** — só quem ainda não agiu pode raise | `noReraiseIds` recebe quem já atuou |

Jogadores em `noReraiseIds` veem apenas `fold`, `call` e `all-in` — sem `raise`.

---

## Fim de Street

Uma street termina quando:
1. **Todos os jogadores ativos** têm bets iguais ao `currentBet`, **E**
2. **Todos os jogadores ativos** já agiram pelo menos uma vez nessa street.

A condição 2 é necessária para evitar que rodadas de check terminem imediatamente
(quando `currentBet = 0` e ninguém ainda agiu).

---

## Casos Especiais de Avanço

**Todos foldaram exceto um:** o jogo vai para showdown imediatamente, sem revelar
mais cartas. O jogador restante ganha o pot.

**Apenas all-ins restam:** as cartas comunitárias restantes são reveladas
automaticamente até o river, sem ação dos jogadores.

---

## Showdown e Avaliação de Mãos

1. Contendores = jogadores com status `'active'` ou `'all-in'`.
2. Cada contendor tem sua melhor mão de 5 cartas avaliada a partir das 7
   disponíveis (2 hole + 5 comunitárias).
3. Mãos são comparadas **por side pot** (ver seção Side Pots abaixo).
4. Se apenas 1 contendor (todos os outros foldaram), ele vence sem mostrar cartas.

### Ranking de Mãos (maior para menor)

| # | Mão | Descrição |
|---|---|---|
| 1 | Royal Flush | A K Q J 10 do mesmo naipe |
| 2 | Straight Flush | 5 cartas sequenciais do mesmo naipe |
| 3 | Four of a Kind | Quadra |
| 4 | Full House | Trinca + Par |
| 5 | Flush | 5 cartas do mesmo naipe |
| 6 | Straight | 5 cartas em sequência |
| 7 | Three of a Kind | Trinca |
| 8 | Two Pair | Dois pares |
| 9 | One Pair | Um par |
| 10 | High Card | Carta mais alta |

---

## Gestão de Chips

- **Starting chips:** `bigBlind × 20` (calculado em `startingChipsFor(config)`).
- Jogador com 0 chips ao fim de uma mão:
  - **Lobby:** recebe `rebuy_prompt`, tem 60s para rebuy ou sai.
  - **Torneio:** é eliminado.
- All-in: jogador permanece na mão com status `'all-in'`. Não pode mais agir.

---

## All-In e Partial Raise

Quando um jogador vai all-in:

- **Full raise** (all-in ≥ `minRaise` acima do `currentBet`): a aposta sobe, `minRaise`
  atualiza, e a ação é **reaberta** para todos — qualquer jogador pode re-raise.
- **Partial raise** (all-in < `minRaise`): `currentBet` sobe mas `minRaise` não muda.
  Jogadores que **já agiram** nesta street só podem `call` ou `fold` — **não podem
  re-raise**. Jogadores que ainda não agiram podem `call`, `raise` ou `fold` normalmente.

Enquanto houver um jogador `active` com `bet < currentBet`, ele deve agir antes de
avançar a fase — mesmo que todos os outros estejam all-in.

## Side Pots (TDA Rule 50)

Quando um jogador vai all-in por um valor menor do que outro, cria-se um ou mais
side pots. `resolveShowdown` implementa isso corretamente via `buildSidePots()`.

### Algoritmo de construção de pots

1. Coletam-se os valores únicos de `totalBet` de todos os jogadores **não foldados**,
   ordenados de forma crescente. Cada valor é um "nível de pot".
2. Para cada nível, a contribuição de **todos** os jogadores (inclusive foldados) é
   `min(totalBet, nivel) − min(totalBet, nivelAnterior)`.
   Jogadores foldados contribuem com **dead money** — aumentam o pot mas **não são
   elegíveis** para ganhar.
3. Apenas jogadores **não foldados** cujo `totalBet >= nivel` são elegíveis para aquele
   pot. Um jogador all-in não é elegível para pots acima do seu totalBet.

### Exemplo (cenário de teste `sidepot.test.ts`)

| Jogador | totalBet | Status |
|---|---|---|
| P1 | 1050 | all-in |
| P2 | 850  | all-in |
| P3 | 1050 | active |
| P4 | 50   | folded |

| Pot | Valor | Elegíveis |
|---|---|---|
| Main pot (nível 850) | 2600 | P1, P2, P3 |
| Side pot (nível 1050) | 400 | P1, P3 |

**Se P2 ganhar o main pot:** P2 recebe 2600. P1 e P3 disputam por showdown o side pot
de 400 — o de melhor mão ganha os 400 (TDA Rule 57: Cards Speak). Só ocorre divisão
igual se as duas mãos forem exatamente empatadas (mesmo rank + mesmo kicker).

### Empate (split pot)

Quando dois ou mais jogadores elegíveis empatam exatamente, o pot é dividido em partes
iguais. Se o pot não for divisível pelo número de vencedores, o chip restante vai ao
primeiro vencedor por ordem de `seatIndex` (determinístico).

### Interface `HandResult`

```
HandResult.pots    — array de PotResult, um por side pot, ordem main → side
HandResult.winnerId — vencedor do maior pot (main pot)
HandResult.amount  — total de chips que o winnerId ganhou em todos os pots
ShowdownResult.won — total ganho pelo jogador em todos os pots combinados
```

---

## Rotação de Dealer

- O dealer roda entre os jogadores **ativos** a cada mão.
- `_dealerIndex` é armazenado como índice no array estável `this.players` (nunca
  reduz, posições são fixas por `seatIndex`).
- Na primeira mão, o dealer é o índice 0 do array de ativos.

---

## Estados do Jogador

| Status | Descrição |
|---|---|
| `waiting` | Sentado, aguardando próxima mão (entrou mid-game ou após rebuy) |
| `active` | Jogando a mão atual |
| `folded` | Foldou nesta mão |
| `all-in` | Apostou todos os chips, aguarda showdown |
| `away` | Torneio apenas: faz fold automático quando é sua vez |
