# Blackjack / 21 — Regras Implementadas

Fonte: [How to Play Blackjack — Bicycle Cards](https://bicyclecards.com/how-to-play/blackjack).
**Esta é a única fonte usada para este jogo.** Existem dezenas de variações
de casa espalhadas pela internet (surrender, resplit, hit em soft 17,
double só em 9-10-11 etc.) — deliberadamente nenhuma delas foi consultada.
Onde a Bicycle descreve o essencial mas deixa uma lacuna real, essa lacuna
é resolvida aqui por escrito, não improvisada no código — mesmo espírito
de [Canastra.md](Canastra.md) e [TrucoGaucho.md](TrucoGaucho.md).

Este documento é a fonte da verdade das regras implementadas no motor do
jogo (`server/src/blackjack/`).

---

## Visão geral

Diferente de todos os outros jogos deste projeto, Blackjack não é
jogador-contra-jogador: cada jogador joga sua própria mão contra uma mão
compartilhada do **dealer** (a casa). Todas as cartas são públicas, exceto
a carta virada do dealer enquanto estiver escondida.

| | |
|---|---|
| Jogadores por mesa | até **7**, mesmo dealer |
| Entrada na mesa | sem criação/escolha de sala — `blackjack_join` entra em qualquer mesa com vaga, ou o servidor cria uma nova |
| Fichas iniciais | **100**, fixas |
| Recarga | **não existe** — fichas perdidas pro dealer não voltam; ao zerar, o jogador é removido da mesa automaticamente |
| Aposta | livre, de 1 até o total de fichas do jogador — não há mesa com limite mínimo/máximo configurado |
| Rodadas | contínuas (aposta → mão → resultado → aposta de novo), enquanto houver pelo menos 1 jogador sentado |

---

## Baralho

- **1 baralho de 52 cartas**, sem curinga — embaralhado do zero a cada rodada (sem sapata persistente entre rodadas).
- Valores: figuras (J, Q, K) valem 10; Ás vale 11 ou 1, o que não estourar a mão; as demais valem o número.

## Aposta

- Sem mesa com faixa configurada — cada jogador aposta o quanto quiser, de 1 até o total de fichas que tiver, a cada rodada.
- Janela de aposta é simultânea (20s), não por turno — todo mundo aposta ao mesmo tempo. Quem não apostar dentro do tempo simplesmente fica de fora da rodada (mantém o assento).
- **Uma aposta por rodada** — depois de confirmada não dá pra reapostar/ajustar.

## Distribuição

2 cartas para cada jogador que apostou (viradas), 2 para o dealer (1 virada, 1 escondida).

## A espiada do dealer (peek)

Se a carta virada do dealer for um **Ás** ou valer **10**, o dealer espia a
escondida antes de qualquer jogador agir:

- **Ás** → abre a janela de **seguro** (abaixo) antes da espiada valer.
- **Valendo 10** → espia direto, sem seguro (a Bicycle só menciona seguro
  com Ás).
- Se o dealer tiver Blackjack, ele revela na hora e **todas as mãos são
  resolvidas sem ninguém jogar** — mão de Blackjack do jogador empata
  (push), as outras perdem.
- Se não tiver, o jogo segue normalmente pros turnos dos jogadores.

Fora dessas duas cartas (2 a 9), não existe Blackjack possível pro dealer
naquela rodada — sem espiada, direto pros turnos.

## Seguro

- Só oferecido quando a carta virada é um Ás.
- Cada jogador decide independentemente, até **metade da própria aposta principal**.
- Se o dealer tiver Blackjack: seguro paga **2:1** (mais a aposta do seguro de volta).
- Se não tiver: o seguro é perdido, sem devolução, e o jogo segue.

## Sua vez (turnos sequenciais por assento)

- **Pedir:** compra mais uma carta.
- **Parar:** encerra a mão com o total atual.
- **Dobrar:** só como primeira decisão numa mão de 2 cartas — dobra a
  aposta, recebe exatamente mais 1 carta e para automaticamente. Permitido
  também numa mão vinda de divisão (double after split), desde que não seja
  uma mão de Ases divididos.
- **Dividir:** só com um par (mesmo valor) na mão inicial de 2 cartas, e só
  se o jogador tiver fichas pra cobrir a segunda aposta (igual à primeira).
  - **Sem redivisão** — no máximo 1 divisão por mão, resultando em no
    máximo 2 mãos. A fonte não define um limite; esta simplificação evita
    complexidade adicional sem alterar a experiência de jogo relevante.
  - **Ases divididos** recebem exatamente 1 carta cada e param
    automaticamente — sem pedir/dobrar depois.
  - **21 depois de divisão nunca conta como Blackjack natural** (mesmo
    Ás+carta de 10) — paga 1:1 como um 21 comum, não 3:2. Só a mão original
    de 2 cartas do início da rodada pode ser um Blackjack natural.

Timeout de 30s por turno — sem ação, o jogador para automaticamente
(mesmo padrão de auto-fold/auto-descarte dos outros jogos).

## Dealer

- Revela a carta escondida e compra até somar **17 ou mais**, parando em
  qualquer 17 — inclusive "soft" (Ás contando como 11). A Bicycle só diz
  "hit until reaching 17 or higher"; a leitura mais direta disso é parar em
  qualquer 17, sem distinção soft/hard.
- Sempre joga a mão até o fim (revela + compra conforme a regra acima),
  mesmo que todas as mãos dos jogadores já tenham estourado — não há o
  atalho comum de casino de pular a jogada do dealer nesse caso.

## Pagamentos

| Resultado | Pagamento |
|---|---|
| Blackjack natural (Ás + carta de 10, 2 cartas, sem ser de divisão) | 3:2 — `aposta + floor(aposta × 3 / 2)` |
| Vitória normal (total maior, ou dealer estourou) | 1:1 |
| Empate (push) | aposta de volta |
| Estourou ou perdeu | perde a aposta |

`floor()` no pagamento de Blackjack evita fichas fracionadas em apostas ímpares.

## Fichas zeradas

Sem recarga nesta mesa: ao terminar uma rodada com 0 fichas, o jogador é
removido da mesa automaticamente (`blackjack_room_left` com motivo
`busted`) e volta pro lobby. Precisa dar `blackjack_join` de novo para
entrar numa mesa nova (com 100 fichas outra vez).

## Sair da mesa

Sair no meio de uma rodada (depois das cartas distribuídas) **perde
qualquer aposta/mão em aberto** — sem devolução. Se era a vez do jogador, o
jogo segue pro próximo assento. Sair durante a janela de aposta (antes de
qualquer carta distribuída) devolve a aposta pendente normalmente, já que
nada começou de fato.

## Desconexão

Diferente de "Sair da mesa" (acima), uma queda de conexão real (fechar a
aba, perder a rede) **não** tira o jogador da mesa na hora — o assento,
aposta e mão em aberto ficam reservados por `BLACKJACK_DISCONNECT_GRACE_S`
(padrão 30s; ver `BlackjackRoom.handleDisconnect()`). Os timers de
aposta/seguro/turno já existentes cobrem o caso "não consegue agir" nesse
meio-tempo, então a mesa nunca trava — só muda o fato de uma queda breve não
custar mais a aposta na hora. Reconectar dentro da janela restaura a mão
exatamente de onde parou (ver `reconnect()`); se a janela expirar sem
reconexão, o jogador é removido normalmente, com a mesma perda de
aposta/mão em aberto do "Sair da mesa".

## Sem surrender, sem even money

A fonte não menciona nenhum dos dois — não foram implementados.
