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
tournament_info. Mensagens específicas de jogador são enviadas via `send()` diretamente.

**Shared types:** importados com path relativo `../../shared/types`. Nunca duplique
tipos — qualquer tipo compartilhado entre front e server deve viver em `shared/`.

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
