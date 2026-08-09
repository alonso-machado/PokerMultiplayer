# Hearts — Regras e Plano de Implementação

Fonte: [How to Play Hearts — Bicycle Cards](https://bicyclecards.com/how-to-play/hearts).
**Esta é a única fonte usada para este jogo** — mesma política do
[Blackjack.md](Blackjack.md) e [GoFish.md](GoFish.md): não foram
consultadas variações de casa. Onde a Bicycle deixa uma lacuna real, essa
lacuna é resolvida aqui por escrito, não improvisada no código — mesmo
espírito de [Canastra.md](Canastra.md).

> ⚠️ Este documento ainda **não tem código correspondente**. É a fonte da
> verdade para quando `server/src/hearts/` for criado — ver
> [Plano de Implementação](#plano-de-implementação) no fim.

---

## Visão Geral

| | |
|---|---|
| Jogadores por mesa | **exatamente 4** (não é variável como o Go Fish) |
| Times | nenhum — pontuação individual |
| Baralho | 1 baralho padrão de 52 cartas, sem curinga |
| Objetivo | **ter a MENOR pontuação** quando alguém atinge o teto (padrão: 100) |
| Uma "partida" | várias mãos, cada mão = 13 vazas, até o teto de pontos |

---

## Distribuição

- **13 cartas** para cada um dos 4 jogadores — o baralho inteiro é distribuído,
  sem monte.
- O baralhador roda a cada mão (rodízio de assento, sentido horário).

---

## Fase de Passar Cartas ("Passing")

Antes de cada mão (exceto a cada 4ª), cada jogador escolhe **3 cartas** da
própria mão e passa **fechado** (os destinatários só veem depois que todos
já escolheram). A direção roda em ciclo de 4 mãos:

| Mão (mod 4) | Direção |
|---|---|
| 1 | passa para a **esquerda** |
| 2 | passa para a **direita** |
| 3 | passa para o jogador **oposto** (através) |
| 4 (`0 mod 4`) | **sem passe** — joga a mão com as cartas recebidas da distribuição |

Só depois que os 4 jogadores tiverem confirmado as 3 cartas escolhidas é que
a troca é resolvida e as mãos atualizadas são reveladas a cada jogador
(nunca antes — ninguém vê o que vai receber antecipadamente).

---

## Início da Mão e Regra de Abertura

- Quem tem o **2 de Paus (2♣)** obrigatoriamente **lidera a primeira vaza**
  jogando essa carta (é a única jogada legal dele nesse momento).
- **Na primeira vaza da mão**, nenhum jogador pode descartar **copas** nem a
  **Dama de Espadas (Q♠)**, mesmo estando sem naipe pedido — **exceto** se a
  mão do jogador só contiver copas e/ou Q♠ (não há jogada legal alternativa).

---

## Regras de Jogada (segue-naipe)

- Cada vaza: todos os 4 jogadores jogam 1 carta, em sentido horário a partir
  de quem lidera.
- **Deve seguir o naipe pedido** se tiver carta desse naipe na mão.
- Se não tiver o naipe pedido, pode descartar **qualquer carta**, inclusive
  copas ou Q♠ (sujeito à restrição da primeira vaza acima).
- Vence a vaza quem jogou a **carta mais alta do naipe pedido** (não existe
  trunfo em Hearts). O vencedor lidera a próxima vaza.

### "Hearts Broken" (copas quebradas)

- Copas só podem ser **lideradas** (jogadas como 1ª carta de uma vaza) depois
  que algum jogador **descartou uma copa** em uma vaza anterior por estar sem
  o naipe pedido (isso "quebra" copas) — **ou** se o jogador que vai liderar
  só tem copas na mão (não há alternativa).
- A Q♠ pode ser jogada a qualquer momento quando o jogador está sem o naipe
  pedido (não é copas para efeito de "quebrar"), mas **não pode ser
  liderada antes de copas quebrarem** salvo a mesma exceção de "só tenho
  isso na mão" (a Bicycle trata Q♠ à parte de copas na regra de liderar:
  ambas ficam bloqueadas até quebrar, com a mesma exceção de mão sem
  alternativa).

---

## Pontuação por Mão

| Carta capturada | Pontos |
|---|---|
| Cada copa (♥ A–K) | 1 ponto |
| Dama de Espadas (Q♠) | 13 pontos |
| Qualquer outra carta | 0 pontos |

Total por mão: **26 pontos** distribuídos entre os 4 jogadores (13 copas +
13 da dama), somando ao placar acumulado de cada um.

### Shooting the Moon ("Estourar")

Se **um único jogador** capturar **as 13 copas E a Q♠** na mesma mão (as 26
cartas de pontuação), duas resoluções equivalentes existem na literatura —
esta implementação usa a formulação **"os outros ganham 26"**:
- O jogador que estourou soma **0** pontos naquela mão.
- Os outros 3 jogadores somam **26** pontos cada um naquela mão.

(Efeito idêntico a "subtrair 26 do estourador", mas evita placar negativo.)

---

## Fim de Partida

- Depois de cada mão completa (13 vazas), verificar se **algum jogador
  atingiu ou ultrapassou 100 pontos** (teto configurável na criação da mesa,
  padrão **100** — a fonte não fixa um valor universal, variações comuns são
  50/100/150).
- Se sim, a partida termina **imediatamente ao final daquela mão** (nunca
  interrompe uma mão em andamento) e **vence quem tiver a MENOR pontuação**
  entre os 4.
- Empate técnico no menor placar: sem critério de desempate na fonte —
  **resolução própria**: os empatados dividem a vitória (mesmo tratamento
  visual/estatístico, sem mão extra automática).
- Votação de revanche segue o mesmo padrão do Truco/Canastra/Go Fish: todos
  aceitam → placar zera e uma nova partida começa; qualquer recusa/timeout →
  mesa fecha.

---

## Plano de Implementação

### Arquitetura (server)

Sistema **totalmente paralelo**, mesmo padrão do Go Fish (sem times, sem
tipo de carta próprio — reusa `Card`/`Rank`/`Suit` de `shared/types.ts`,
baralho único de 52 sem duplicatas):

```
server/src/hearts/
├── deck.ts          # reusa createDeck/shuffle de poker/deck.ts (igual Go Fish)
└── gameEngine.ts     # HeartsGame — máquina de estados
server/src/heartsRoom.ts   # HeartsRoom — assentos, ciclo de partida, revanche, timeout
```

**Diferença estrutural chave em relação ao Go Fish:** a mesa **precisa
lotar em 4** antes de começar — não dá pra jogar Hearts com 3. Isso é mais
parecido com o padrão de "espera lotar" da Canastra (`2x2`) do que com o
auto-start do Go Fish. Criar a mesa já fixa `maxPlayers = 4`, sem opção de
escolher tamanho.

**`HeartsGame` — estados da mão:**

1. `passing` — aguardando os 4 jogadores confirmarem as 3 cartas escolhidas
   (irrelevante na mão "sem passe", pula direto pra `playing`).
2. `playing` — vazas em andamento; sub-estado implícito "hearts não quebrado /
   quebrado" e "primeira vaza" (flags no estado da mão, não estados
   separados).
3. `hand_complete` — mão encerrada, pontuação calculada, aguardando checagem
   de fim de partida.
4. `match_complete` — teto atingido, aguardando votação de revanche.

**Validação de jogada** (`playCard`) precisa checar, nesta ordem:
1. É a vez do jogador?
2. Se é a 1ª jogada da mão inteira (não só da vaza): precisa ser 2♣.
3. Se está liderando a vaza (não a 1ª da mão): copas só permitido se
   `heartsBroken === true`, **ou** se a mão do jogador só tem copas.
4. Se não está liderando: precisa seguir o naipe pedido se tiver na mão.
5. Se é a 1ª vaza da mão: copas e Q♠ proibidos, salvo mão sem alternativa.

**Timeout de turno** (`HEARTS_TIMEOUT`, sugestão 30s, mesmo espírito do Go
Fish): auto-joga a **menor carta válida** disponível (calculada pela mesma
função de validação acima, iterando a mão do jogador do menor pro maior
rank) — nunca uma jogada aleatória, pra não punir desconexão com um
"estouro" acidental.

**`HeartsRoom`:**
- Assentos fixos (0–3), sem times.
- Ciclo: nova mão → fase de passe → jogo → pontuação → checa teto → próxima
  mão ou fim de partida → votação de revanche (mesmo mecanismo do Truco:
  todos aceitam zera placar e redistribui; qualquer recusa fecha a mesa).
- Rodízio de baralhador em +1 a cada mão (inclusive pós-revanche).
- `index.ts`: `heartsRooms` como `Map` separado; roteamento via
  `session.heartsRoomId` + `currentHeartsRoom()`, espelhando
  `currentGoFishRoom()`.

### Tipos compartilhados (`shared/types.ts`)

Novos tipos de mensagem (`hearts_room_joined`, `hearts_state`,
`hearts_pass_cards`, `hearts_play_card`, `hearts_hand_result`,
`hearts_match_complete`, `hearts_rematch_vote`, etc.) seguindo o prefixo
`hearts_` já estabelecido pelos outros jogos — sem tipo de carta próprio,
reusa `Card`.

### Arquitetura (front)

Mesmo padrão do Go Fish/Canastra/Truco:

```
front/src/hooks/useHeartsGame.ts        # useReducer, filtra ServerMessage.type.startsWith('hearts_')
front/src/components/HeartsLobby.tsx    # criar/listar mesas (sem opção de tamanho — sempre 4)
front/src/components/HeartsTable.tsx    # mesa: placar dos 4, indicador de "copas quebradas",
                                         #   fase de passe (selecionar 3 cartas + botão confirmar),
                                         #   vaza atual central, minha mão com jogadas inválidas
                                         #   desabilitadas visualmente, overlay de fim de mão
                                         #   (quem estourou, pontos ganhos) e fim de partida/revanche
front/src/components/HeartsGuide.tsx    # painel de regras, shell .hand-guide-* reusado
```

Roteamento em `App.tsx`: nova aba `♥ Hearts` no seletor de jogo, mesmo
padrão do `default:` case pro prefixo `hearts_`.

### Fases sugeridas de implementação

1. **Motor puro** (`gameEngine.ts` + testes `bun test`): distribuição, passe,
   validação de jogada, resolução de vaza, pontuação, shoot-the-moon, fim de
   partida — sem rede.
2. **`HeartsRoom` + roteamento no `index.ts`**: assentos, ciclo, timeout,
   revanche.
3. **Front**: hook + lobby + tabela + guia.
4. **Testes de integração** ponta a ponta (opcional, se o padrão dos outros
   jogos tiver isso).

Antes de qualquer commit tocando isso: `cd server && bun test` e/ou
`cd front && bun x tsc -b`, conforme a Regra #1 do `CLAUDE.md`.
