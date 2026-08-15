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

✅ Implementado em `server/src/pushyourluckdraw/` (+ `server/src/pushyourluckdrawRoom.ts`)
e `front/src/{hooks,components}/*PushYourLuckDraw*`. Este documento continua
sendo a fonte da verdade das regras — ver [Plano de Implementação](#plano-de-implementação)
no fim pra como o código está organizado.

---

## Visão Geral

- Jogo de **risco progressivo** (push-your-luck) tipo "pedir carta sem
  estourar", mas o estouro aqui não é por **soma passar de um número**
  (como no Blackjack) — é por **repetir um valor de carta** que o próprio
  jogador já tem na rodada.
- Todos os jogadores competem contra o **mesmo baralho compartilhado**, sem
  dealer/banca (diferente do [Blackjack](Blackjack.md)) — par-contra-par,
  sem casa, mesa livre de 2 a 8 jogadores.
- Uma "partida" é feita de **várias rodadas**, até alguém bater a
  pontuação-alvo.

| | |
|---|---|
| Jogadores por mesa | **2 a 8**, escolhido na criação da sala (sem times) |
| Baralho | baralho próprio — ver [Baralho](#baralho) |
| Modo de baralho | **único** — o monte é embaralhado 1x por partida e só reembaralha o descarte quando esgota (ver [Baralho](#baralho)) |
| Modo de Coringas | **`per_player`** (padrão, 3 por jogador sentado) ou **`fixed`** (sempre 6), escolhido na criação da mesa — ver [Coringas escalam com a mesa](#coringas-escalam-com-a-mesa-ou-ficam-fixos) |
| Pontuação-alvo | **150** por padrão, configurável na criação da mesa |
| Uma "rodada" | todos os jogadores ativos decidem, turno a turno, entre **Pedir carta**, **Parar**, ou **Jogar Coringa em alguém** — até todos terem parado ou estourado |

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
| **Coringa ("Save")** | depende do `jokerMode` da mesa — ver abaixo | 0 (não conta como valor — ver [Coringa](#coringa-guardar-ou-jogar)) |

Total de cartas numeradas + Ás: `1+2+3+4+5+6+7+8+9+10+11+12+13` = **91**,
mais os Coringas (variável — ver abaixo).

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

### Coringas escalam com a mesa, ou ficam fixos

Escolhido na criação da mesa via `jokerMode` — **não muda durante a
partida** (mesmo espírito da variante de manilha do [Truco](Truco.md)):

#### `per_player` (padrão)

`JOKERS_PER_PLAYER = 3` — a mesa sempre tem **3 Coringas por jogador
sentado**, não um número fixo. Isso vale tanto na montagem inicial do
baralho quanto **ao vivo, durante a partida**:

- **Jogador entra no meio da partida** (ver [Entrar a Qualquer
  Momento](#entrar-a-qualquer-momento)): `JOKERS_PER_PLAYER` Coringas novos
  são adicionados e embaralhados no monte **imediatamente**, mesmo antes
  desse jogador participar de uma rodada.
- **Jogador sai** (hoje só possível antes da partida começar — ver [Sair da
  Mesa](#sair-da-mesa)): `JOKERS_PER_PLAYER` Coringas são removidos de
  circulação, **na ordem**: primeiro do monte (cartas ainda não compradas
  nesta partida); só se o monte não tiver Coringas suficientes pra cobrir a
  remoção, completa tirando do descarte acumulado. **Nunca** mexe na
  reserva (`savesHeld`) ou na mão da rodada de um jogador que continua na
  mesa — um Coringa já guardado ou jogado como `@` não desaparece porque
  alguém saiu.

#### `fixed`

`FIXED_JOKER_COUNT = 6` — a mesa sempre tem **exatamente 6 Coringas**,
não importa quantos jogadores estão sentados. Jogar entra ou sai **não
mexe no baralho de jeito nenhum**: sem adicionar, sem remover — o número
de cartas no monte/descarte é o mesmo antes e depois. Mais previsível pra
mesas pequenas (menos Coringas relativos por jogador com mais gente
sentada) ou pra quem prefere um baralho de tamanho estável.

### Único modo de baralho

Não existe mais escolha de "baralho fresco por rodada" — o monte é
embaralhado **uma única vez no início da partida** (e de novo só numa
revanche aceita, que conta como partida nova), igual a um monte/descarte de
verdade (mesmo conceito de monte + lixo já usado na [Canastra](Canastra.md)):

- No **início da partida**, monta e embaralha o baralho completo (91 cartas
  numeradas + Ás + Coringas conforme o `jokerMode` da mesa — ver acima) como
  monte inicial, com um descarte vazio.
- Ao final de **cada rodada**, todas as cartas que estiveram na mão da
  rodada de qualquer jogador (de quem parou, de quem estourou, e as
  descartadas por causa de um "save" de Coringa) vão para o **descarte** —
  elas **não** voltam a fazer parte do monte automaticamente.
- A próxima rodada continua puxando do **mesmo monte**, sem reembaralhar.
- Se o monte esgotar (dentro de uma rodada ou entre rodadas), embaralha
  **todo o descarte acumulado até então** (de todas as rodadas da partida,
  não só da rodada atual) formando um novo monte — ver [Esgotamento do
  Monte](#esgotamento-do-monte).
- **Efeito de jogo real**: como o monte só é reembaralhado quando esgota,
  cartas de valor alto (que existem em mais cópias) ou os Coringas podem
  ficar **temporariamente escassos ou indisponíveis** por várias rodadas
  seguidas depois de serem muito puxados — a composição do monte "visível"
  (o que ainda pode sair) muda de rodada pra rodada dentro da mesma
  partida.

---

## Turno e Ações

- Ordem de assento fixa, sentido horário; jogador inicial roda a cada
  rodada (mesmo padrão de rodízio dos outros jogos).
- Na vez de cada jogador **ainda ativo na rodada** (não parou, não
  estourou), três ações possíveis:
  - **Pedir carta** ("Draw"): compra 1 carta do monte, vira pra própria
    área (pública a todos).
  - **Parar** ("Stop"): encerra a participação do jogador **nesta rodada**
    com a pontuação atual da mão travada — ele não joga mais até a próxima
    rodada, mas continua "no jogo" (diferente de estourar).
  - **Jogar Coringa em alguém** — só disponível com 2+ Coringas guardados;
    ver [Coringa](#coringa-guardar-ou-jogar).
- Cada turno resolve **exatamente 1 decisão** — qualquer uma das três ações
  passa a vez pro próximo jogador ainda ativo (não há "agir várias vezes
  seguidas" no mesmo turno, mesmo modelo de turno único do Blackjack).
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
    sem estourar. Só **1** Coringa é gasto por evento de estouro evitado,
    mesmo que o jogador tenha mais guardados.
- O Ás de Espadas nunca pode causar estouro por duplicata na prática (só
  existe **1 cópia** no baralho inteiro) — a lógica de estouro é genérica
  (compara valor de rank), não precisa de caso especial pro Ás no código;
  isso é só uma consequência natural da composição do baralho, documentada
  aqui pra não ser "corrigida" à toa depois.

---

## Coringa: guardar ou jogar

- Ao comprar um Coringa, ele **não conta como carta de valor** (não soma
  pontos, não conta como "já tenho esse valor" pra checagem de duplicata,
  não pode por si causar estouro) — vai pra uma **reserva separada** do
  jogador (`savesHeld`), visível a todos.
- Comprar um Coringa consome o turno normalmente (como comprar qualquer
  carta) — não dá ação extra.
- Coringas guardados só têm efeito **na rodada em que foram comprados** —
  ao final da rodada (parou, estourou, ou a rodada termina pra ele de
  qualquer forma), qualquer Coringa não usado **é perdido** junto com o
  resto da mão (não acumula pra rodada seguinte). Isso evita "bancar"
  Coringas indefinidamente entre rodadas.

### O 1º Coringa é proteção obrigatória

O **primeiro** Coringa que um jogador junta numa rodada fica **travado**
como proteção contra estouro (ver [Regra de Estouro](#regra-de-estouro-duplicata))
— ele **nunca** pode ser jogado ofensivamente em outro jogador, mesmo que o
dono queira. Na prática: jogar um Coringa em alguém só é permitido quando
`savesHeld ≥ 2` no momento da ação — sempre sobra pelo menos 1 de reserva.

### 2º Coringa em diante: guardar de novo ou jogar em alguém

A partir do segundo Coringa guardado numa rodada, o jogador escolhe, no seu
turno:

- **Guardar** — não faz nada de especial: simplesmente não gasta o Coringa
  extra agora, continua valendo como mais uma proteção contra estouro (a
  mesma regra de "consome 1 por evento de estouro evitado" já cobre ter
  vários guardados).
- **Jogar em outro jogador** (ação de turno, disputando um Coringa da
  reserva): escolhe **um jogador ainda ativo na rodada** (ainda decidindo
  entre pedir/parar — não pode mirar em quem já parou ou estourou) e
  **não pode mirar em si mesmo**. Isso:
  - Gasta **1** Coringa da reserva do jogador que jogou.
  - Coloca uma carta especial **`@`** na mão da rodada do alvo — visível
    pra todo mundo, do mesmo jeito que qualquer carta da mão.
  - **Um jogador só pode carregar um `@` por rodada** — se o alvo
    escolhido já tem um `@` na mão desta rodada, a jogada é **rejeitada**
    (o Coringa não é gasto, o turno de quem tentou jogar continua
    pendente). Não existe "empilhar" halvings no mesmo alvo na mesma
    rodada.
  - O `@` não conta como carta de valor pra checagem de duplicata (rank
    nulo, igual ao Coringa) e não pode por si causar estouro.
  - Efeito de pontuação do `@`: ver [Poder do Ás de
    Espadas](#poder-do-ás-de-espadas) (interação com o multiplicador) e
    [Fim de Rodada e Pontuação](#fim-de-rodada-e-pontuação).

---

## Poder do Ás de Espadas

- O Ás de Espadas **não soma valor próprio** à pontuação da rodada (não
  vale "1 ponto") — sua função é **multiplicar por 2 a soma de todas as
  outras cartas** da mão da rodada do jogador.
- Só tem efeito se o jogador **parar (ou a rodada terminar) com o Ás ainda
  na mão** — se o jogador estourar naquela rodada, perde a mão inteira
  (incluindo o Ás) e não pontua nada, multiplicador incluído.
- Se a mesma mão tiver o Ás **e** um `@` (ver [Coringa](#coringa-guardar-ou-jogar)),
  o Ás dobra **primeiro**, e o `@` divide o resultado por 2 **depois** — uma
  mão com os dois volta pra soma simples (o multiplicador e a divisão se
  cancelam). Ver fórmula completa em [Fim de Rodada e
  Pontuação](#fim-de-rodada-e-pontuação).

---

## Fim de Rodada e Pontuação

- A rodada termina quando **todos os jogadores ativos** da mesa
  pararam ou estouraram (nenhuma decisão pendente).
- Pontuação de cada jogador nessa rodada:
  - **Estourou:** 0 pontos (o `@` que porventura estivesse na mão perdida
    não tem efeito nenhum — não há o que dividir).
  - **Parou (ou ficou sem decisão porque o monte esgotou de vez — ver
    abaixo):**
    1. Soma o valor das cartas na mão, ignorando o Ás e o `@`.
    2. Se tem o **Ás de Espadas** na mão, dobra essa soma.
    3. Se tem um **`@`** na mão, divide o resultado por 2 (arredondando
       pra baixo).
    - `pontos_da_rodada = (soma × (tem_ás ? 2 : 1)) ÷ (tem_@ ? 2 : 1)`,
      com a divisão arredondada pra baixo.
- Pontos da rodada somam ao placar acumulado de cada jogador.
- Depois de somar, checa se **algum jogador atingiu ou ultrapassou a
  pontuação-alvo** (padrão 150). Se sim, a partida termina **ao final
  dessa rodada** (nunca no meio) — vence quem tiver **a maior pontuação**
  entre todos (não necessariamente só quem bateu o alvo, já que outro
  jogador pode ter uma pontuação acumulada maior ainda sem ter cruzado o
  alvo sozinho naquela rodada).
  - Empate exato no topo: **resolução própria** (sem critério na regra
    original) — os empatados dividem a vitória.
- Se ninguém bateu o alvo, roda o dealer/jogador inicial em +1 e começa
  nova rodada, **continuando do monte atual** (cartas da rodada que
  terminou vão pro descarte acumulado, sem reembaralhar, salvo
  esgotamento — ver abaixo).

### Esgotamento do Monte

Se o monte esgotar **no meio de uma rodada** (ou já começar uma rodada sem
cartas suficientes) e ainda houver jogador decidindo entre pedir/parar:
- Embaralha **todo o descarte acumulado da partida** até aquele momento
  (não só desta rodada) formando um novo monte, e continua normalmente.
- Se mesmo assim não houver carta suficiente (caso extremo, praticamente
  impossível com até 8 jogadores), qualquer jogador ainda ativo sem carta
  pra comprar é tratado como **parado automaticamente** com a pontuação
  atual da mão (nunca como estouro forçado).

---

## Timeout de Turno

`PUSHYOURLUCKDRAW_TIMEOUT` (sugestão 20s, mesmo espírito da janela de aposta
do Blackjack): sem ação, o jogador **para automaticamente** com a
pontuação atual da mão — nunca pede carta às cegas por ele (evita punir
desconexão com um estouro que o jogador não escolheu).

---

## Entrar a Qualquer Momento

Mesa **family-friendly, "chega quando quiser"**: dá pra entrar numa mesa
**a qualquer momento**, mesmo com a partida em andamento, mesmo no meio de
uma rodada — a única trava é **ter vaga** (`maxPlayers` configurado na
criação). Aqui **não existe** bloqueio de "partida em andamento" ao entrar.

- Quem entra no meio de uma rodada fica com status **`waiting`** — só
  observa aquela rodada (não é chamado pra jogar, não pode travar o fim da
  rodada dos outros) e entra como jogador **ativo normal a partir da
  próxima rodada**, já com assento e placar zerado.
- No modo `per_player`, a entrada também dispara o [ajuste ao vivo de
  Coringas](#coringas-escalam-com-a-mesa-ou-ficam-fixos): `JOKERS_PER_PLAYER`
  Coringas novos entram no monte imediatamente, mesmo enquanto esse
  jogador ainda está `waiting`. No modo `fixed`, entrar não mexe no
  baralho.
- Quem entra durante a janela de votação de revanche (depois de um
  `match_complete`) recebe o resultado da partida que terminou e a
  contagem de votos até então, podendo votar normalmente — inclusive numa
  partida que ele não jogou.
- Se essa identidade **saiu ou desconectou durante a partida atual** (ver
  [Sair da Mesa](#sair-da-mesa) abaixo) e ainda não começou uma partida
  **nova** desde então, a pontuação acumulada dela nessa partida é
  **restaurada automaticamente** ao entrar de novo — do contrário, entra
  zerada, como qualquer jogador novo.

## Sair da Mesa

**Diferente de todos os outros jogos do catálogo (Truco/Canastra/etc.), sair
no meio de uma partida em andamento não dissolve mais a mesa** — a mesa só
fecha de verdade quando fica **completamente vazia** (0 jogadores). Isso
vale tanto pro botão explícito "Sair da mesa" quanto pra uma desconexão real
(fechar a aba/navegador — ver [Desconexão](#desconexão) abaixo), e também
pra recusar ou não votar a tempo numa revanche (ver
[Votação de Revanche](#votação-de-revanche)): em todos esses casos, o
jogador que saiu é **removido do assento** (não fica mais na lista, não
trava o turno dos outros, é excluído do monte/descarte igual a `removePlayer`
— ver [Baralho](#baralho)), mas a mesa **continua rodando normalmente** pra
quem ficou, mesmo que sobre só **1 jogador** (ele simplesmente joga rodadas
sozinho até alguém entrar de novo — mesmo espírito do "chega quando quiser").

- **A pontuação acumulada da partida atual é preservada** pra essa
  identidade (via token assinado, mesmo mecanismo de sessão persistente
  usado no resto do app) — se ela entrar de novo **nessa mesma mesa antes
  de uma partida nova começar**, o placar volta exatamente de onde parou.
  A mão da rodada em andamento, Coringas guardados e status não são
  preservados — só a pontuação total da partida (ver
  [Entrar a Qualquer Momento](#entrar-a-qualquer-momento) acima).
- **Esse placar salvo só vale pra partida em que a saída aconteceu.** No
  instante em que uma partida nova começa (primeiro início, ou uma revanche
  aceita), qualquer placar salvo de saídas da partida anterior é
  **descartado por completo**. Isso é proposital: sem esse corte, alguém
  que saiu com 90 pontos poderia voltar horas depois, já com uma partida
  nova e diferente rolando na mesma mesa, e entrar "de graça" com 90 pontos
  numa partida que nem começou pra valer — quebrando o placar de todo
  mundo. Depois desse corte, reentrar conta como **jogador novo**, do zero.
- Sair antes da partida começar apenas libera o assento normalmente (não há
  placar de partida ainda pra preservar) — e, no modo `per_player`, dispara
  a remoção de `JOKERS_PER_PLAYER` Coringas do monte/descarte (ver
  [Baralho](#baralho); no modo `fixed`, sair não mexe no baralho).

### Desconexão

Fechar a aba/app (sem clicar em "Sair da mesa") é tratado **exatamente
como sair explicitamente** — diferente do resto do app, onde uma sessão
persistente deixa o jogador "pausado" no lugar esperando reconectar. Aqui
não: a saída é imediata (assento liberado, turno pulado se era a vez dele,
placar preservado pro mesmo motivo acima). Isso significa que um simples
**F5/reload** também conta como sair — o placar fica salvo e a pessoa só
precisa clicar em "Entrar na Mesa" de novo na mesma mesa pra retomar de
onde parou, mas não é um reconnect automático e silencioso como em
Truco/Canastra/Poker.

---

## Votação de Revanche

Ao final de uma partida (`match_complete`), todos os jogadores sentados
votam: **Jogar novamente** ou **Sair**. Diferente do padrão do resto do
catálogo, uma recusa (ou não votar dentro da janela de 60s) **não** fecha a
mesa pros outros — é tratada exatamente como [Sair da
Mesa](#sair-da-mesa): esse jogador é removido (placar daquela partida que
já terminou fica salvo, mas — como uma partida nova ainda não começou até
todo mundo confirmar — só é útil se ele reentrar antes da revanche
realmente começar) e a votação continua com quem restou.

- Assim que **todos os jogadores que ainda estão na mesa** tiverem votado
  "Jogar novamente", a revanche começa — mesmo que só reste **1 jogador**
  (nesse caso ele começa uma partida nova sozinho, esperando alguém entrar).
- A mesa só é fechada de verdade se a votação terminar com **0 jogadores**
  restantes (todos recusaram ou o tempo esgotou pra todos).

---

## Plano de Implementação

### Arquitetura (server)

Sistema **totalmente paralelo**, sem times — mesa livre 2-8, sem
dealer/banca, mas com o **modelo de turno hit/stand do Blackjack** (uma
decisão por vez, sem comprar múltiplas cartas no mesmo turno):

```
server/src/pushyourluckdraw/
├── deck.ts          # baralho próprio (composição de cópias diferente do createDeck do poker)
└── gameEngine.ts     # PushYourLuckDrawGame — máquina de estados
server/src/pushyourluckdrawRoom.ts   # PushYourLuckDrawRoom — assentos, ciclo de rodadas, timeout, fim de partida
```

**`PushYourLuckDrawGame` — estados da rodada:**

1. `playing` — turnos sequenciais de pedir/parar/jogar-Coringa entre os
   jogadores ainda ativos (estado único — não há sub-fases como
   aposta/distribuição separadas, já que não há aposta em fichas neste
   jogo).
2. `round_complete` — todos pararam/estouraram; pontuação calculada,
   placar atualizado.
3. `match_complete` — alvo atingido, aguardando revanche.

**Estado do baralho não é "por rodada", é do jogo inteiro** — diferença
importante em relação aos outros jogos do catálogo: `monte` e `descarte`
vivem no nível da `PushYourLuckDrawGame`, não são recriados a cada
`playing`. O início de cada rodada (`startRound()`) **sempre reaproveita**
o `monte`/`descarte` que sobrou da rodada anterior — só uma nova
**partida** (`match_complete` → revanche aceita, ou a primeira vez) chama
`startMatch()` e reseta pra um baralho novo (dimensionado pro número de
jogadores sentados naquele momento).

**Funções auxiliares que precisam de teste dedicado** (`bun test`):
- `buildDeck(playerCount, jokerMode)` / `jokerCountFor(jokerMode,
  playerCount)` — validar a composição exata (cópias(rank) = valor(rank)
  para 2 ao K, 1 Ás) e os dois modos de Coringa (`per_player` =
  `JOKERS_PER_PLAYER × playerCount`; `fixed` = sempre `FIXED_JOKER_COUNT`,
  ignorando `playerCount`).
- `checkDuplicate(playerRoundHand, drawnCard)` — decide estouro, ignorando
  coringas/`@` na comparação.
- `applyJokerSave(player)` — consome 1 coringa da reserva, descarta a
  carta duplicada, **não** marca estouro.
- `throwJoker(fromId, targetId)` — exige `savesHeld ≥ 2` no jogador de
  origem, alvo `active` e sem `@` já na mão; consome 1 coringa, injeta o
  `@` na mão do alvo, consome o turno de quem jogou.
- `computeRoundScore(playerRoundHand, hasAce, hasHalf)` — soma → dobra se
  tem Ás → divide por 2 (arredondado pra baixo) se tem `@`, só se o
  jogador não estourou.
- `addPlayer(id, name)` / `removePlayer(id)` — além do bookkeeping de
  assento, no modo `per_player` ajustam o monte/descarte em
  `±JOKERS_PER_PLAYER` Coringas **somente se a partida já começou**
  (`matchStarted`); no modo `fixed` nunca ajustam nada; pré-partida é só
  bookkeeping porque `startMatch()` vai reconstruir o baralho do zero de
  qualquer forma. Cobrir os dois `jokerMode` com testes separados — é o
  ponto mais fácil de inverter por engano.
- `reshuffleIfEmpty(game)` — recicla o descarte acumulado da partida
  inteira quando o monte esgota (ver [Esgotamento do
  Monte](#esgotamento-do-monte)).
- `disconnectPlayer(id)` — a saída "com placar preservado" (ver [Sair da
  Mesa](#sair-da-mesa)/[Desconexão](#desconexão)): remove como
  `removePlayer` (mesmo ajuste de Coringas), devolve um snapshot
  `{ totalScore, matchWins }` pro chamador guardar, e só mexe em
  turno/rodada se a fase for `playing` (avança o turno se era a vez de
  quem saiu; fecha a rodada se ninguém mais restou ativo). Em
  `round_complete`/`match_complete` é só remoção + snapshot, sem
  reprocessar fim de rodada/partida.
- `restoreScore(id, snapshot)` — sobrepõe um snapshot salvo num jogador
  recém-`addPlayer`ado (que sempre começa zerado) — usado pelo
  `PushYourLuckDrawRoom.join()` quando a mesma identidade reentra antes de
  uma partida nova começar.

**Diferença chave em relação ao Blackjack:** não existe "banca" comprando
por conta própria nem aposta de fichas — o motor só orquestra turnos entre
jogadores reais, então não tem uma fase equivalente à "jogada do dealer".

**`PushYourLuckDrawRoom`:**
- Assentos livres, 2 a 8 (definido na criação).
- Ciclo: nova rodada → turnos (pedir/parar/jogar Coringa) → pontuação →
  checa alvo → próxima rodada ou fim de partida → votação de revanche.
- **Único jogo do catálogo onde sair/desconectar/recusar-revanche nunca
  dissolve a mesa por si só** (ver [Sair da Mesa](#sair-da-mesa) e
  [Votação de Revanche](#votação-de-revanche)) — `leave()` chama
  `disconnectPlayer()` e só destrói a sala se `players.length === 0`
  depois da remoção; `handleDisconnect()` (chamado pelo `close` do
  WebSocket em `index.ts`) delega pro mesmo `leave()`. Um
  `disconnectedScores: Map<playerId, snapshot>` guarda os placares
  pendentes de resgate, e é **zerado por completo** toda vez que
  `this.game.startMatch()` é chamado (início normal ou revanche aceita) —
  esse é o corte que impede um placar velho de vazar pra uma partida nova.
- `index.ts`: `pushyourluckdrawRooms` como `Map` separado; roteamento via
  `session.pushyourluckdrawRoomId` + `currentPushYourLuckDrawRoom()`. O
  handler de `close` do WebSocket chama `disconnectPushYourLuckDrawPlayer()`
  (não o genérico "deixa a sessão persistente reconectar" usado pelo resto
  do app) e limpa `session.pushyourluckdrawRoomId` na sessão persistente —
  de propósito, pra um `hello` seguinte não tentar reconectar
  automaticamente alguém que já foi removido de verdade.

### Tipos compartilhados (`shared/types.ts`)

Mensagens com prefixo `pushyourluckdraw_` (`pushyourluckdraw_room_joined`,
`pushyourluckdraw_round_started`, `pushyourluckdraw_draw_result`,
`pushyourluckdraw_stop_result`, `pushyourluckdraw_throw_result`,
`pushyourluckdraw_round_end`, `pushyourluckdraw_match_end`, etc. — ver o
arquivo de tipos pra lista completa). **Tem um tipo de carta próprio**
porque o baralho não é um baralho padrão de 52 — mesmo formato do
`CanastraCard` (id único + `suit`/`rank` nuláveis), mais uma flag extra pro
`@`:

```ts
interface PushYourLuckDrawCard {
  id: string           // único por carta física — muitos ranks têm cópias duplicadas
  suit: Suit | null     // null quando isJoker/isHalf; o Ás de Espadas é suit:'spades', rank:'A' (única cópia do baralho inteiro)
  rank: Rank | null     // null quando isJoker/isHalf
  isJoker: boolean
  isHalf: boolean       // o '@' — nunca vem do monte, só é criada por throwJoker()
}
```

Todas as mãos da rodada são **públicas** (`PushYourLuckDrawPlayer.roundHand`
vai pra todo mundo) — diferente de todos os outros jogos do catálogo, não
há mensagem de "mão privada" nenhuma aqui.

### Arquitetura (front)

```
front/src/hooks/usePushYourLuckDrawGame.ts       # useReducer, filtra type.startsWith('pushyourluckdraw_')
front/src/components/PushYourLuckDrawLobby.tsx   # criar/listar mesas (nome + máximo de jogadores 2-8 +
                                                #   alvo de pontos, padrão 150 + modo de Coringas per_player/fixed)
front/src/components/PushYourLuckDrawTable.tsx   # mesa: placar acumulado de todos, jogador da vez em destaque,
                                                #   mão da rodada de cada jogador visível (cartas + coringas
                                                #   guardados + '@' recebidos), botões Pedir/Parar/Jogar-@ na
                                                #   minha vez, indicador de Ás de Espadas (multiplicador ativo)
                                                #   na mão de quem tiver, contador de cartas restantes no monte,
                                                #   overlay de fim de rodada (quem estourou, pontuação de cada
                                                #   um) e fim de partida/revanche
front/src/components/PushYourLuckDrawGuide.tsx   # painel de regras, shell .hand-guide-* reusado
```

Roteamento em `App.tsx`: aba `🍀 Push Your Luck`.

### Status

Todas as fases abaixo foram implementadas:

1. ✅ **Motor puro** (`gameEngine.ts` + `deck.ts` + `server/test/pushyourluckdraw.test.ts`):
   composição do baralho nos dois `jokerMode` (`per_player` escalado por
   jogador, `fixed` sempre `FIXED_JOKER_COUNT`), ajuste ao vivo de Coringas
   no join/leave (só em `per_player`), turnos pedir/parar/jogar-Coringa,
   checagem de duplicata, salvamento por coringa, `@` com checagem de
   não-empilhamento, multiplicador do Ás × divisão do `@`, pontuação,
   esgotamento de monte, gating de fim de partida (só no limite da rodada,
   maior total vence), `disconnectPlayer`/`restoreScore` (saída com placar
   preservado, nos três estados de fase relevantes).
2. ✅ **`PushYourLuckDrawRoom` + roteamento no `index.ts`**: inclui o
   "nunca dissolve sozinho" (leave/disconnect/recusa de revanche) com
   placar restaurável só dentro da mesma partida.
3. ✅ **Front**: `usePushYourLuckDrawGame` + `PushYourLuckDrawLobby` +
   `PushYourLuckDrawTable` + `PushYourLuckDrawGuide`, aba `🍀 Push Your
   Luck` no `App.tsx`.
4. Testes de integração ponta a ponta (WebSocket real) — não implementados,
   mesmo estado dos outros jogos do catálogo (cobertura só no nível do
   motor via `bun test`); a orquestração de sala (`PushYourLuckDrawRoom`)
   também não tem teste dedicado, mesmo padrão de todos os outros jogos do
   catálogo (nenhum tem `*Room.test.ts`) — validado manualmente via app
   rodando (`.claude/launch.json`).

Antes de qualquer commit tocando isso: `cd server && bun test` e/ou
`cd front && bun x tsc -b`, conforme a Regra #1 do `CLAUDE.md`.
