# Poker Texas Hold'em — Multiplayer

Jogo de poker Texas Hold'em em tempo real com WebSockets.
Dois modos: **Lobby** (mesas casuais) e **Torneio** (único, gerenciado por admin).

---

## Estrutura do projeto

```
PokerMultiplayer/
├── front/     # React 19 + Vite + TypeScript  →  deploy Vercel
├── server/    # Bun + TypeScript + WebSocket nativo  →  deploy Render
├── shared/    # Tipos e funções compartilhados (sem dependência de framework)
└── README.md
```

---

## Regras — Lobby / Sala

- Qualquer jogador pode **criar uma sala** e definir: nome, big blind, small blind, ante e máximo de jogadores (2–6).
- **Fichas iniciais = 20 × big blind** (calculado automaticamente).
- Ao criar uma sala, o criador entra automaticamente.
- **Jogo auto-inicia** quando o segundo jogador entra — sem botão manual.
- É possível **entrar mid-game** (com mão em andamento) — o jogador é sentado e entra na próxima mão.
- **Sala vazia** por 5 minutos sem segundo jogador: expirada automaticamente.
- **Fichas zeradas → Rebuy**: ao final da mão, dialog com **60 segundos** para decidir:
  - **Rebuy** — volta com fichas iniciais.
  - **Sair da mesa** — retorna ao lobby.
  - Tempo expirado sem escolha → sai automaticamente.
- Não existe "away/levantar" em salas de lobby. Máximo **30 salas** simultâneas.

---

## Regras — Torneio

- **Único torneio ativo** por vez — criado e configurado exclusivamente pelo admin.
- Qualquer jogador pode se **inscrever** antes do início pelo countdown exibido na aba Torneio.
- Não há limite de jogadores inscritos.
- Ao iniciar, jogadores são distribuídos em mesas de até 6 (round-robin). O servidor rebalanceia automaticamente.
- **Sem rebuy** — ao zerar fichas o jogador é eliminado definitivamente.
- **Fichas iniciais = 20 × big blind inicial** (definido pelo admin).

### Away / Levantar (somente torneios)
- Botão disponível a qualquer momento durante a partida.
- Jogador permanece sentado mas **dobra automaticamente** a cada turno.
- Continua pagando small blind, big blind e ante normalmente.
- Clique em **"Voltar à mesa"** para retomar o jogo.

### Blinds crescentes
- Blinds **dobram a cada 10 minutos** automaticamente.
- Sequência: `SB/BB → 2×SB/2×BB → 4× → 8× → ...` (20 níveis)
- **Próximo nível + tempo restante** aparecem no canto superior direito da mesa.
- Todas as mesas do torneio atualizam os blinds simultaneamente.

### Mesa Final
- Quando restam **≤ 8 jogadores**, todos são consolidados em uma única **Mesa Final**.
- Badge "🔥 MESA FINAL" aparece na topbar.

### Ranking ao vivo
- Sidebar esquerda sempre visível nas mesas de torneio.
- Mostra todos os jogadores com fichas atuais e mesa em que estão jogando.
- Atualiza a cada **30 segundos** (performance) + imediatamente em eliminações.

---

## Painel Admin

- Rota `/admin` no próprio site (front React).
- Login com usuário/senha (variáveis de ambiente `ADMIN_USER` / `ADMIN_PASS`).
- Validação completa com **Zod** no formulário.
- Operações disponíveis:
  - **Criar torneio**: nome, data/hora de início, blinds, ante, máx. por mesa.
  - **Iniciar agora**: força início antes do horário agendado.
  - **Cancelar**: remove o torneio se ainda em fase de inscrição.
- Após o torneio iniciar, **nenhuma alteração** é possível.

---

## Protocolo WebSocket

Mensagens minimizadas — sem envio de estado redundante:

| Direção | Tipo | Descrição |
|---------|------|-----------|
| C→S | `hello` | Primeira mensagem — envia ID persistente (cookie) + token de torneio |
| S→C | `hand_dealt` | **Privado** — início de mão: 2 cartas + snapshot da mesa |
| S→C | `community_cards` | **Broadcast** — cartas abertas: `cards[]` com 3 (flop), 1 (turn) ou 1 (river) |
| S→C | `your_turn` | **Privado** — somente para o jogador da vez |
| S→C | `player_acted` | **Broadcast** — ação realizada + estado atualizado |
| S→C | `showdown` | **Broadcast** — revelação de mãos + vencedor |
| S→C | `hand_end` | **Broadcast** — fim de mão, quem ganhou e quanto |
| S→C | `blind_update` | **Broadcast** — novo nível de blinds no torneio |
| S→C | `tournament_ranking` | **Broadcast** — ranking a cada 30 s e em eliminações |
| S→C | `rebuy_prompt` | **Privado** — lobby: oferta de rebuy com countdown de 60 s |

O frontend **acumula** as `community_cards`:
`[] → [c,c,c] → [c,c,c,c] → [c,c,c,c,c]`

---

## Sessão persistente (todos os jogadores)

- Cookie `pk_pid` — ID único do jogador (gerado uma vez, dura 1 ano).
- Cookie `pk_name` — nome do jogador.
- Cookie `pk_tid` — token de inscrição no torneio.
- Ao reconectar (refresh / fechar browser), o cliente envia `hello` com o ID do cookie.
- O servidor restaura o estado: sala de lobby ou mesa de torneio.

---

## Observabilidade e Analytics

### Servidor — New Relic (OpenTelemetry)
- SDK: `@opentelemetry/sdk-node` com exportador OTLP/HTTP para New Relic.
- Inicializado como **primeira linha** do `index.ts` (padrão Bun — sem `--require`).
- Envia traces e métricas a cada 60 s.
- Graceful shutdown em SIGTERM/SIGINT.
- **Endpoint US**: `https://otlp.nr-data.net` | **EU**: `https://otlp.eu01.nr-data.net`
- Sem `NEW_RELIC_LICENSE_KEY` → silenciosamente desabilitado (dev local seguro).

### Frontend — PostHog
- SDK: `posthog-js` + `@posthog/react` com `<PostHogProvider>`.
- Eventos capturados automaticamente: pageviews, cliques.
- Eventos customizados: `lobby_created`, `lobby_joined`, `lobby_left`, `hand_ended`, `tournament_registered`, `tournament_unregistered`, `tournament_eliminated`.
- Identificação do jogador via `posthog.identify(playerId, { name })` ao salvar o nome.
- **Sem `VITE_POSTHOG_KEY`** → silenciosamente desabilitado (dev local seguro).

---

## Deploy

### Frontend → Vercel

| Campo | Valor |
|-------|-------|
| Root directory | `front/` |
| Build command | `bun run build` |
| Output directory | `dist/` |
| SPA routing | `vercel.json` já configurado |

Variáveis de ambiente no painel Vercel:
```
VITE_WS_URL         wss://seu-server.onrender.com/ws
VITE_SERVER_URL     https://seu-server.onrender.com
VITE_POSTHOG_KEY    phc_...
VITE_POSTHOG_HOST   https://us.i.posthog.com
```

### Servidor → Render

O backend é buildado via **Docker** (`Dockerfile`) e configurado em `render.yaml`.

1. Conecte o repositório no Render como **Web Service** (runtime Docker).
2. O `render.yaml` já define build e start command — não precisa configurar manualmente.
3. Adicione as variáveis de ambiente no painel do Render:

```
PORT                3000           # Render injeta automaticamente
NODE_ENV            production
ADMIN_USER          <seu-usuario>
ADMIN_PASS          <senha-forte>
PLAYER_SECRET       <hex 32 bytes — openssl rand -hex 32>
NEW_RELIC_LICENSE_KEY   NRAK-...
NEW_RELIC_OTLP_ENDPOINT https://otlp.nr-data.net
NEW_RELIC_APP_NAME      poker-server
```

> **Histórico:** o backend já rodou no **Railway**. Migramos para o Render por
> ser mais econômico. A config do Railway foi removida do repositório.

---

## Rodar localmente

```bash
# Servidor (porta 3001)
cd server && bun install && bun dev

# Frontend (porta 5173)
cd front && bun install && bun dev
```

Copie os arquivos de exemplo e preencha:
```bash
cp server/.env.example server/.env
cp front/.env.example  front/.env.local
```

---

## Variáveis de ambiente — resumo

| Arquivo | Var | Obrigatório em prod | Descrição |
|---------|-----|---------------------|-----------|
| `server/.env` | `PORT` | ✓ (auto Render) | Porta HTTP/WS |
| `server/.env` | `NODE_ENV` | ✓ | `production` |
| `server/.env` | `ADMIN_USER` | ✓ | Login do painel admin |
| `server/.env` | `ADMIN_PASS` | ✓ | Senha do painel admin |
| `server/.env` | `NEW_RELIC_LICENSE_KEY` | — | Habilita New Relic |
| `server/.env` | `NEW_RELIC_OTLP_ENDPOINT` | — | US ou EU |
| `server/.env` | `NEW_RELIC_APP_NAME` | — | Nome no dashboard |
| `front/.env.local` | `VITE_WS_URL` | ✓ | URL WebSocket do servidor |
| `front/.env.local` | `VITE_SERVER_URL` | ✓ | URL HTTP do servidor |
| `front/.env.local` | `VITE_POSTHOG_KEY` | — | Habilita PostHog |
| `front/.env.local` | `VITE_POSTHOG_HOST` | — | US ou EU |

---

## Estrutura de blinds do torneio (exemplo com BB=50)

| Nível | Small | Big | Duração |
|-------|-------|-----|---------|
| 1 | 25 | 50 | 10 min |
| 2 | 50 | 100 | 10 min |
| 3 | 100 | 200 | 10 min |
| 4 | 200 | 400 | 10 min |
| 5 | 400 | 800 | 10 min |
| ... | × 2 | × 2 | 10 min |
