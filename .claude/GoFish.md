# Go Fish — Regras Implementadas

Fonte: [How to Play Go Fish — Bicycle Cards](https://bicyclecards.com/how-to-play/go-fish).
**Esta é a única fonte usada para este jogo** — mesma política do
[Blackjack.md](Blackjack.md): não foram consultadas variações de casa.
Onde a Bicycle descreve o essencial mas deixa uma lacuna real, essa lacuna é
resolvida aqui por escrito, não improvisada no código — mesmo espírito de
[Canastra.md](Canastra.md).

Este documento é a fonte da verdade das regras implementadas no motor do
jogo (`server/src/gofish/`).

---

## Visão geral

Arquitetura mais próxima da Canastra: sala livre (sem times), **uma
"partida" é um jogo só**, jogado até o fim, seguido de votação de revanche.
Diferente da Canastra, o tamanho da mesa é escolhido pelo criador (não um
modo fixo 1x1/2x2).

| | |
|---|---|
| Jogadores por mesa | **2 a 6**, escolhido na criação da sala |
| Baralho | 1 baralho de 52 cartas, sem curinga — usa o tipo `Card` comum (sem ids duplicados, ao contrário da Canastra) |
| Início | automático 300ms após o 2º jogador sentar (mesmo padrão do lobby de Poker/Truco), com `gofish_start_game` como fallback manual — **não** espera a mesa lotar, diferente da Canastra |
| Objetivo | formar o máximo de **baralhos** (4 cartas do mesmo valor); vence quem tiver mais ao final |

---

## Distribuição

- **7 cartas** por jogador com 2 ou 3 jogadores; **5 cartas** com 4 ou mais
  (a fonte só define até 5 jogadores — 6 jogadores estende a faixa de 5
  cartas como extensão própria desta implementação).
- O resto forma o **monte**, virado pra baixo.
- Quem começa: ordem de assento = ordem de entrada na sala. Na primeira
  partida começa o assento 0; a cada revanche o assento inicial roda em +1
  (mesma ideia do rodízio de baralhador da Canastra) — a fonte usa um método
  físico (menor carta virada é o baralhador) que não se aplica online.

---

## Seu turno

1. Escolha um valor que você **já tem na sua mão** e peça esse valor a um
   oponente específico (a fonte exige isso: *"the player who is fishing
   must have at least one card of the rank that was asked for"*).
2. Se o oponente tiver cartas daquele valor, ele entrega **todas** — e você
   pode pedir de novo (ao mesmo ou outro oponente), enquanto continuar
   "pegando".
3. Se não tiver, você "vai pescar": compra a carta do topo do monte.
   - Se essa carta for do valor pedido, **conta como uma pegada** — você
     pode pedir de novo. A fonte não deixa isso explícito (só diz que a vez
     passa "se não fizer uma pegada"), mas essa é a leitura mais literal —
     "pegar uma carta do valor pedido" não especifica a origem — e é a
     convenção quase universal do jogo real.
   - Se não for, a vez passa pro próximo jogador (à esquerda).
4. Ao completar 4 cartas do mesmo valor (na mão ou por causa da compra), o
   baralho é formado na hora, sai da mão, e não afeta a continuação do turno
   (pegar ainda conta como pegar, mesmo que esvazie a mão — ver abaixo).

---

## Mão vazia

Se a mão do jogador da vez está vazia, a compra é **automática e
obrigatória** antes de pedir qualquer coisa — não é uma decisão do jogador
(a fonte diz apenas *"eles podem, na sua vez, comprar do monte e então pedir
cartas daquele valor"*; aqui isso vira automático, silencioso, no início do
turno). Isso pode acontecer tanto no começo normal do turno quanto logo
depois de completar um baralho que esvaziou a mão inteira — em ambos os
casos a compra automática acontece antes de qualquer pedido.

## Eliminação ("fora da partida")

Se a mão está vazia **e** o monte também está vazio quando chega a vez do
jogador, ele fica **fora**: pulado no rodízio de turnos pelo resto da
partida. Ele ainda pode ser alvo de um pedido (resultando trivialmente em
"vai pescar", já que não tem nada) — não há necessidade de bloquear isso.

A partida **encerra antes do normal** se sobrar menos de 2 jogadores em
condição de jogar (ninguém sobra pra pedir ou ser pedido de forma útil) —
o vencedor é quem tiver mais baralhos até ali, mesma regra do fim normal.
Empate é possível (a fonte não define desempate) — ninguém ganha vitória
(`matchWins`) nesse caso, mesma convenção da Canastra.

---

## Fim de partida

Termina ao formar os **13 baralhos possíveis**, ou antecipadamente pela
regra de eliminação acima. Vence quem tiver mais baralhos.

---

## Sair da mesa

Sem backfill no meio da partida — sair depois que a partida começou encerra
a mesa pra todo mundo (`gofish_room_left` com motivo `abandoned`), mesmo
comportamento da Canastra.

---

## Fim de Partida e Revanche

A mesa não fecha automaticamente: todos os jogadores sentados votam se
querem revanche.
- **Todos aceitam** → novo jogo é distribuído (com o assento inicial
  rodando, ver "Distribuição" acima).
- **Qualquer recusa ou timeout (60s)** → a mesa é encerrada.

`matchWins` acumula por jogador enquanto a mesa continuar aberta, mesmo
padrão da Canastra/Truco — mas só é incrementado quando há um vencedor único
(sem empate).

---

## Estados do Jogador

| Status | Descrição |
|---|---|
| `waiting` | Sentado, aguardando início da partida |
| `active` | Jogando a partida atual |
| `out` | Ficou sem cartas com o monte também vazio — fora pelo resto da partida |
| `disconnected` | Conexão caiu — assento reservado até reconectar |
