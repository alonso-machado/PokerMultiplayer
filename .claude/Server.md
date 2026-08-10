# Server — Decisões de Arquitetura

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Bun (≥ 1.x) |
| Linguagem | TypeScript ^6.0 (strict) |
| WebSocket | Bun native (`Bun.serve`) |
| HTTP | Bun native (mesmo servidor do WS) |
| Observabilidade | OpenTelemetry → New Relic (OTLP/HTTP) |
| Testes | Bun test (`bun test`) |

**Por que Bun native WebSocket?** `uWebSockets.js` é incompatível com o runtime
Bun. Não use `ws`, `socket.io` ou qualquer outra lib de WS — o `Bun.serve` com
`websocket:` já oferece tudo que precisamos com tipagem genérica na sessão.

## Estrutura de pastas

```
server/
├── src/
│   ├── index.ts          # Entry point — Bun.serve, roteamento HTTP, dispatch WS
│   ├── room.ts           # Classe Room — mesa de jogo, lifecycle, rebuy
│   ├── tournament.ts     # Classe Tournament — registro, blinds, mesas, ranking
│   ├── admin.ts          # Rotas HTTP /api/admin/* com Basic Auth
│   ├── telemetry.ts      # Bootstrap OpenTelemetry (DEVE ser o 1º import)
│   └── poker/
│       ├── deck.ts           # Criação e shuffle do baralho
│       ├── gameEngine.ts     # PokerGame — máquina de estados da mão
│       └── handEvaluator.ts  # Avaliação e comparação de mãos
└── test/
    └── game.test.ts
```

## Decisões arquiteturais

**Entry point obrigatório:** `telemetry.ts` é importado como **primeiro import**
de `index.ts`. Qualquer reordenação quebra a instrumentação auto do OTel (hooks
devem ativar antes de qualquer módulo de aplicação carregar).

**Sessões persistentes vs sessões WS:** há dois layers de sessão:
- `PersistentSession` (Map por `playerId`) — sobrevive a desconexões WS. Guarda `roomId` e `tournamentToken`.
- `Session` (dados do WS, tipagem genérica do `Bun.serve`) — efêmera, por conexão.

No `hello`, o servidor tenta recuperar a sessão persistente e reconectar o
jogador à sala ou ao torneio sem nenhuma ação do cliente.

**Salas de torneio vs lobby:** o campo `room.tournamentId` distingue os dois
tipos. Operações de lobby (leave, rebuy, expire) são bloqueadas em mesas de
torneio. O `index.ts` filtra `lobbyRoomList()` excluindo `tournamentId`.

**Limite de salas:** `MAX_LOBBY_ROOMS = 30`. Salas de torneio não contam nesse
limite.

**Auto-start no lobby:** quando o 2º jogador entra em uma sala de lobby, o jogo
inicia automaticamente após 300ms (via `setTimeout`). Não há botão de start no
lobby — qualquer jogador pode forçar via `start_game` como fallback.

**Broadcast:** feito via `server.publish('lobby', ...)` do Bun para room_list e
tournament_info. Toda conexão chama `ws.subscribe('lobby')` em `open()` — sem
essa subscrição o `publish` não entrega nada a sockets já conectados (eles só
recebem o snapshot inicial enviado no `open`). Mensagens específicas de jogador
são enviadas via `send()` diretamente.

**Roteamento de sala por jogador:** `currentRoom(session)` é a função central
para resolver em qual `Room` as ações de um jogador (`player_action`,
`set_away`, `set_back`, `start_game`) devem ser aplicadas. Para jogadores
registrados e não-eliminados num torneio, prefere
`activeTournament.getTableId(playerId)` (atualizado pelo `Tournament` em
start/rebalance/mesa-final) em vez do `session.roomId`, que só é atualizado em
`create_room`/`join_room`/`hello`. Veja `.claude/Tournament.md` → "Roteamento de
Ações durante o Torneio".

**Shared types:** importados com path relativo `../../shared/types`. Nunca duplique
tipos — qualquer tipo compartilhado entre front e server deve viver em `shared/`.

## Truco

Sistema totalmente paralelo ao Poker — não compartilha `Room`/`PokerGame`, apenas
o padrão de broadcast/expiry/reconnect. Ver `.claude/Truco.md` para as regras.

- `truco/deck.ts` — baralho de 40 cartas e resolução de manilha (`vira`/`fixed`).
- `truco/gameEngine.ts` (`TrucoGame`) — máquina de estados de uma partida: vazas,
  escalada de truco, mão de 11, placar.
- `trucoRoom.ts` (`TrucoRoom`) — assentos/times, ciclo de mãos, votação de
  revanche, timeout de turno (`TRUCO_TIMEOUT`, default 60s — auto-joga a carta
  mais fraca ou "corre" automaticamente de um truco/mão de 11 pendente).
- `index.ts`: `trucoRooms` é um `Map` separado de `rooms`; roteamento via
  `session.trucoRoomId` + `currentTrucoRoom()`, espelhando `currentRoom()`.
- **Identidade:** `TrucoPlayer.id` é o id bruto verificado (igual ao Poker) —
  nunca compare com o token assinado do cliente (`identity.playerId`) sem antes
  extrair o id via uma mensagem do servidor (`truco_room_joined.yourId`).

## Canastra / Buraco

Sistema totalmente paralelo, mesmo padrão do Truco — não compartilha `Room`
nem estado com Poker/Truco/Gaúcho. Ver `.claude/Canastra.md` para as regras.
Diferença de arquitetura: aqui **uma "partida" é uma mão só** (sem repetir
mãos até uma pontuação alvo).

- `canastra/deck.ts` — baralho de 108 cartas (2×52 + 4 curingões) e
  validação de jogos (`validateMeld`: sequência/trinca, limite de curinga,
  detecção de canastra limpa/suja).
- `canastra/gameEngine.ts` (`CanastraGame`) — máquina de estados de uma mão:
  mãos, mortos, monte, lixo, jogos por time, turno (`draw`/`act`), batida
  (direta/indireta), pontuação final.
- `canastraRoom.ts` (`CanastraRoom`) — assentos/times, ciclo da mão,
  votação de revanche, timeout de turno (`CANASTRA_TIMEOUT`, default 60s —
  compra do monte se possível e descarta a 1ª carta da mão).
- `index.ts`: `canastraRooms` é um `Map` separado; roteamento via
  `session.canastraRoomId` + `currentCanastraRoom()`, espelhando
  `currentTrucoRoom()`/`currentGauchoRoom()`.

## Go Fish

Sistema totalmente paralelo, mesmo padrão da Canastra — não compartilha
`Room` nem estado com os outros jogos. Ver `.claude/GoFish.md` para as
regras. Diferenças de arquitetura em relação à Canastra: sem times, sem
tipo de carta próprio (reusa `Card`/`Rank` de `shared/types.ts` — baralho
único de 52, sem duplicatas), e a mesa **não** espera lotar pra começar —
segue o padrão de auto-start do lobby de Poker/Truco (300ms após o 2º
jogador entrar, com `gofish_start_game` manual como fallback).

- `gofish/gameEngine.ts` (`GoFishGame`) — reusa `createDeck`/`shuffle` de
  `poker/deck.ts` diretamente (mesmo baralho de 52, sem duplicar código).
  Máquina de estados de uma partida: mãos, monte, baralhos formados, pedir
  (`ask`) com toda a lógica de pegada/pescaria/continuação de turno, compra
  automática de mão vazia, eliminação por "fora da partida".
- `gofishRoom.ts` (`GoFishRoom`) — assentos, ciclo da partida, votação de
  revanche, timeout de turno (`GOFISH_TIMEOUT`, default 30s — pedido às
  cegas de um valor aleatório da mão a um oponente aleatório ainda em jogo).
- `index.ts`: `gofishRooms` é um `Map` separado; roteamento via
  `session.gofishRoomId` + `currentGoFishRoom()`, espelhando
  `currentCanastraRoom()`.

## Push Your Luck Draw

Sistema totalmente paralelo — regra **original** (não adaptada de terceiros),
ver `.claude/PushYourLuckDraw.md`. Arquitetura híbrida: entrada de sala livre
2-8 sem times (como o Go Fish, auto-start 300ms após o 2º join), mas o loop
de partida repete **várias rodadas até alguém atingir a pontuação-alvo**
(como o Truco: `round_end`/`match_end` + votação de revanche), diferente do
Go Fish (uma partida = um jogo só até o fim). Todas as mãos da rodada são
**públicas** — não há mensagem de mão privada, único jogo do catálogo assim.
**Único jogo do catálogo que aceita entrada a qualquer momento** — inclusive
com a partida em andamento/no meio de uma rodada (mesa "family-friendly",
só a lotação bloqueia); quem entra assim fica `waiting` até a próxima
rodada. Sair em andamento continua dissolvendo a mesa, como nos outros.

- `pushyourluckdraw/deck.ts` — baralho próprio de 95 cartas: cópias(rank) =
  valor(rank) para todo rank numerado/de figura (o 7 tem 7 cópias, o K tem
  13), 1 Ás de Espadas (multiplicador ×2) e 4 Coringas (save).
- `pushyourluckdraw/gameEngine.ts` (`PushYourLuckDrawGame`) — máquina de
  estados de uma partida: turnos pedir/parar (1 decisão por turno, sempre
  passa a vez), estouro por duplicata de rank, salvamento por Coringa,
  multiplicador do Ás, dois modos de baralho (`fresh` reconstrói 95 cartas
  a cada rodada; `persistent` mantém monte/descarte entre rodadas dentro da
  mesma partida, só reembaralhando ao esgotar), fim de rodada só quando
  todos pararam/estouraram, fim de partida só no limite da rodada (nunca no
  meio) com o **maior total** vencendo — não necessariamente quem cruzou o
  alvo primeiro.
- `pushyourluckdrawRoom.ts` (`PushYourLuckDrawRoom`) — assentos livres,
  ciclo de rodadas/partida, votação de revanche, timeout de turno
  (`PUSHYOURLUCKDRAW_TIMEOUT`, default 20s — **para automaticamente**, nunca
  compra carta às cegas).
- `index.ts`: `pushyourluckdrawRooms` é um `Map` separado; roteamento via
  `session.pushyourluckdrawRoomId` + `currentPushYourLuckDrawRoom()`,
  espelhando `currentGoFishRoom()`.

## Rotas HTTP

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `GET` | `/` | — | Health check `{"status":"ok"}` |
| `GET` | `/ws` | — | Upgrade para WebSocket |
| `GET` | `/api/tournament` | — | Info pública do torneio ativo |
| `GET` | `/api/admin/tournament` | Basic Auth | Info do torneio (admin) |
| `POST` | `/api/admin/tournament` | Basic Auth | Criar torneio |
| `POST` | `/api/admin/tournament/start` | Basic Auth | Iniciar torneio |
| `DELETE` | `/api/admin/tournament` | Basic Auth | Cancelar torneio |

CORS está habilitado com `*` em todas as rotas.

## Variáveis de Ambiente

Copie `server/.env.example` para `server/.env` e preencha:

```env
# Porta HTTP/WebSocket
# O Render injeta PORT automaticamente — não precisa setar em prod.
PORT=3001

# Ambiente (afeta o atributo deployment.environment no OTel)
NODE_ENV=development

# Credenciais do painel admin (/api/admin/*)
# Em produção, use valores fortes e defina como secrets.
ADMIN_USER=admin
ADMIN_PASS=changeme

# New Relic — Observabilidade via OpenTelemetry
# Deixe NEW_RELIC_LICENSE_KEY vazio para desabilitar OTel em dev local.
# Obtenha em: one.newrelic.com → API Keys → Ingest - License
NEW_RELIC_LICENSE_KEY=

# Endpoint OTLP do New Relic
# US: https://otlp.nr-data.net
# EU: https://otlp.eu01.nr-data.net
NEW_RELIC_OTLP_ENDPOINT=https://otlp.nr-data.net

# Nome do serviço exibido no New Relic APM
NEW_RELIC_APP_NAME=poker-server
```

> Se `NEW_RELIC_LICENSE_KEY` estiver vazio, `startTelemetry()` é no-op — seguro
> para rodar localmente sem nenhuma configuração adicional.

## Observabilidade (Server)

Implementada via **OpenTelemetry SDK** exportando para **New Relic** por OTLP/HTTP.

**Traces:** auto-instrumentação via `@opentelemetry/auto-instrumentations-node`.
Instrumentações de `fs` e `dns` estão desabilitadas (muito ruidosas, sem valor).
WebSocket não tem auto-instrumentação disponível — spans manuais se necessário.

**Métricas:** `PeriodicExportingMetricReader` com intervalo de **60 segundos**.

**Shutdown graceful:** `SIGTERM` e `SIGINT` chamam `shutdownTelemetry()` antes
de `process.exit(0)` — garante flush dos buffers antes de encerrar.

**Atributos de recurso:**
- `service.name` = `NEW_RELIC_APP_NAME` (default: `"poker-server"`)
- `service.version` = `"1.0.0"`
- `deployment.environment` = `NODE_ENV`
- `telemetry.sdk.runtime` = `"bun"`

## Como rodar localmente

```sh
cd server
bun install
bun dev        # watch mode — reinicia em mudanças
# ou
bun start      # sem watch
```

Testes:
```sh
bun test
```

## Auditoria de dependências (bun audit)

`bun audit` roda automaticamente no pre-commit (ver `.claude/CLAUDE.md` →
Regra #3). Vulnerabilidades em dependências transitivas do OpenTelemetry
foram fixadas via `overrides` no `package.json` — **não remover** sem
reconfirmar que a versão base (`@opentelemetry/sdk-node` etc.) já resolve
essas transitivas sozinha:

| Pacote (transitivo) | Via | Corrigido em |
|---|---|---|
| `@opentelemetry/propagator-jaeger` | `sdk-node` | `2.10.0` |
| `@opentelemetry/core` | várias | `2.10.0` |
| `protobufjs` | `sdk-node` → `exporter-trace-otlp-grpc` → `grpc-js` | `7.6.5` |
| `brace-expansion` | `auto-instrumentations-node` → ... → `minimatch` | `2.1.4` |

`protobufjs@7.6.5` tem um postinstall script (só imprime um aviso de
versionamento, sem efeitos colaterais) — já marcado como confiável em
`trustedDependencies`.
