# Truco — Regras Implementadas

Fontes: [Regras oficiais Copag](https://blog.copag.com.br/regras/truco) e
[Como se joga o Truco Paulista](https://blog.copag.com.br/a-copag/afinal-como-se-joga-o-truco-paulista).

Este documento é a fonte da verdade das regras implementadas no motor do
jogo (`server/src/truco/`). Qualquer ambiguidade de regra deve ser resolvida
aqui — não improvisada no código.

---

## Visão Geral

| Modo | Jogadores | Times |
|---|---|---|
| `1x1` | 2 | cada jogador é seu próprio time |
| `2x2` | 4 | 2 duplas — parceiros sentam em assentos opostos (0+2 vs 1+3) |

- Objetivo: ser o **primeiro time a 12 pontos**.
- Cada mão ("rodada") vale entre **1 e 12 pontos**, dependendo da aposta.
- Cada mão tem até **3 vazas** (trick, 1 carta por jogador cada).

---

## Baralho

- **40 cartas** — baralho padrão sem os `8`, `9`, `10` e sem curingas.
- **Ranking base** (mais fraca → mais forte), fora as manilhas:

| Ordem | Cartas |
|---|---|
| 1 (mais fraca) | 4 |
| 2 | 5 |
| 3 | 6 |
| 4 | 7 |
| 5 | Q (Dama) |
| 6 | J (Valete) |
| 7 | K (Rei) |
| 8 | A (Ás) |
| 9 | 2 |
| 10 (mais forte, fora manilha) | 3 |

Manilhas (ver abaixo) são sempre mais fortes que qualquer carta fora de
manilha, independente do rank base.

---

## Variantes de Manilha

Escolhida na criação da mesa — **não muda durante a partida**.

### `vira` — Truco Paulista

A cada mão, uma carta é virada face-up ("vira") depois do dealer distribuir.
A manilha é o **próximo rank acima do vira** na sequência do ranking base,
com wrap-around (`3` vira `4`). As 4 cartas desse rank (uma por naipe) são
manilha na mão.

Exemplo: vira = `7` → manilha = `Q` (todas as 4 Damas).

**Ordem de força dos naipes na manilha** (mais forte → mais fraca) — essa
ordem de naipe vale **igualmente nas duas variantes** (`vira` e `fixed`):

| Ordem | Naipe | Apelido |
|---|---|---|
| 1 (mais forte) | Paus (♣) | Zap |
| 2 | Copas (♥) | Copeta |
| 3 | Espadas (♠) | Espadilha |
| 4 (mais fraca) | Ouros (♦) | Pica-fumo |

### `fixed` — Truco Mineiro

Sem carta vira. As manilhas são **fixas durante toda a partida** — sempre as
mesmas 4 cartas, uma por naipe. A força entre elas segue a **mesma ordem de
naipe** de cima (Zap > Copas > Espadilha > Ouros):

| Ordem | Carta |
|---|---|
| 1 (mais forte, "zap") | 4 de Paus (4♣) |
| 2 | 7 de Copas (7♥) |
| 3 | Ás de Espadas (A♠) |
| 4 (mais fraca) | 7 de Ouros (7♦) |

Nenhuma outra carta é manilha neste modo — as demais 36 cartas seguem
apenas o ranking base.

---

## Estrutura da Mão

1. O dealer distribui **3 cartas** para cada jogador.
2. No modo `vira`, revela a carta vira (broadcast) antes da 1ª vaza.
3. Quem tem **"a mão"** (jogador seguinte ao dealer, sentido de jogo) puxa a
   **1ª vaza**. Quem vence uma vaza puxa a próxima.
4. Cada vaza: todos os jogadores jogam 1 carta; vence quem jogou a carta
   mais forte (manilha sempre vence carta fora de manilha).
5. Vence a mão quem fizer **2 das 3 vazas**.

### Empate de vaza ("empate"/"vaza de mão")

Empate só ocorre entre cartas fora de manilha de mesmo rank (manilhas nunca
empatam entre si — naipe sempre desempata).

| Situação | Resultado |
|---|---|
| 1ª vaza empata | quem ganhar a 2ª vaza ganha a mão |
| 1ª tem vencedor, 2ª empata | quem ganhou a 1ª vaza ganha a mão |
| 1ª e 2ª empatam | decide a 3ª vaza |
| as 3 vazas empatam | ninguém pontua ("mão de ninguém") |

---

## Escalada de Aposta (Truco)

| Chamada | Mão passa a valer |
|---|---|
| (nenhuma) | 1 ponto |
| `truco` | 3 pontos |
| `seis` | 6 pontos |
| `nove` | 9 pontos |
| `doze` | 12 pontos (teto — não dá pra aumentar mais) |

Regras da chamada:

- Só quem está com **prioridade** pode chamar — antes de jogar sua carta na
  vaza atual, ou logo após vencer uma vaza (início da próxima).
- Uma chamada pendente deve ser respondida antes do jogo continuar:
  **aceitar** (`quero`), **recusar** (`corro`), ou **aumentar direto** — responder
  a um `truco` já com `seis`, por exemplo, sem precisar aceitar o valor anterior
  primeiro (o valor pulado nunca chega a ser "aceito" para efeito da regra de
  recusa abaixo).
- **Recusar** entrega ao time que chamou os pontos do **último valor já
  aceito** antes dessa chamada (não o valor pedido).
  - Exemplo: mão vale 1, time A chama `truco` (pediria 3). Time B corre →
    time A ganha **1** ponto (valor antes do truco).
  - Exemplo: truco já aceito (mão vale 3), time B chama `seis`. Time A corre
    → time B ganha **3** pontos (valor antes do seis).

---

## Mão de 11 e Mão de Ferro

- **Mão de 11:** quando um time atinge **11 pontos**, antes da próxima mão
  começar, cada dupla pode **ver as cartas do parceiro** e decidir:
  - **jogar** a mão normalmente, ou
  - **correr de bandeja** (recusar sem jogar) — cede **1 ponto** ao
    adversário e a próxima mão é redistribuída.
- **Mão de Ferro:** condição especial quando **as duas duplas** estão em 11
  pontos simultaneamente — ambos os times veem todas as cartas da mesa antes
  de decidir jogar.
- No modo `1x1` não há parceiro para consultar: a decisão de jogar ou correr
  na mão de 11 é individual, olhando apenas a própria mão.

---

## Fim de Partida e Revanche

- A partida termina quando um time atinge **12 pontos**.
- O time vencedor recebe **1 vitória** (medalha) na mesa; a contagem de
  vitórias (`matchWins`) **persiste enquanto os jogadores continuam
  sentados** na mesma mesa.
- A mesa **não fecha automaticamente**: todos os jogadores sentados votam
  se querem revanche.
  - **Todos aceitam** → nova partida começa, placar zera (0 a 0), mas
    `matchWins` acumulado permanece.
  - **Qualquer recusa ou timeout** → a mesa é encerrada e os jogadores
    restantes voltam para o lobby de Truco.

---

## Estados do Jogador

| Status | Descrição |
|---|---|
| `waiting` | Sentado, aguardando início da partida (mesa incompleta) |
| `active` | Jogando a mão atual |
| `mao_de_onze_pending` | Time em 11 pontos, decidindo jogar ou correr |
| `disconnected` | Conexão caiu — assento reservado até reconectar |
