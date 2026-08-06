# Front-end — Decisões de Arquitetura

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | React 19 (com React Compiler habilitado via `@vitejs/plugin-react`) |
| Build | Vite 6 |
| Linguagem | TypeScript ~5.8 (strict) |
| Analytics | PostHog (`@posthog/react` + `posthog-js`) |
| Validação | Zod 4 |
| Runtime dev | Bun (apenas para instalar deps e rodar scripts) |

React Compiler está ativo — **não use `useMemo`/`useCallback` manualmente** nas
regras normais do compilador, exceto em casos que o compilador explicitamente não
consiga otimizar (interop com libs externas, callbacks de WebSocket estáveis).

## Estrutura de pastas

```
front/
├── src/
│   ├── components/     # UI pura — sem lógica de negócio
│   │   ├── HandGuide.tsx
│   │   ├── Lobby.tsx
│   │   ├── PlayingCard.tsx
│   │   ├── PokerTable.tsx
│   │   ├── TournamentRanking.tsx
│   │   └── TournamentTab.tsx
│   ├── hooks/
│   │   ├── useSocket.ts      # WebSocket — única fonte de verdade da conexão
│   │   └── usePlayerToken.ts # Identidade persistente do jogador (localStorage)
│   ├── pages/
│   │   └── AdminPage.tsx     # Painel admin protegido por Basic Auth HTTP
│   ├── App.tsx               # Root — estado global do jogo, roteamento simples
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
└── vercel.json               # Deploy: Vercel (SPA fallback configurado)
```

## Decisões arquiteturais

**Shared types via alias Vite:** `@shared` aponta para `../shared/` (configurado
em `vite.config.ts`). Nunca copie tipos do shared — importe sempre de `@shared`.

**Identidade do jogador:** `usePlayerToken` persiste `playerId`, `name`, e
`tournamentToken` no `localStorage`. O `playerId` é gerado uma vez e reutilizado
em reconexões — isso viabiliza o `session_restored` no servidor.

**WebSocket:** `useSocket` abre uma única conexão por montagem, envia `hello`
imediatamente no `onopen`, e expõe apenas `send` e `connected`. O handler de
mensagens recebido como prop é atualizado via `ref` para evitar re-subscribe.

**Estado do jogo:** centralizado no `App.tsx` via `useState`. Não há Redux, Zustand
nem Context API — o jogo tem estado local suficientemente simples. Se crescer,
migrar para um reducer em App.

**Roteamento:** sem React Router. A seleção de view é feita por estado (`view: 'lobby' | 'table' | 'tournament'`).

**Pós-eliminação no torneio:** não existe mais uma tela cheia de "Você foi
eliminado". Ao receber `tournament_eliminated`, o app volta para a UI normal
(lobby + abas) com a aba "🏆 Torneio" selecionada e mostra um banner dispensável
com a colocação final / vencedor. O ranking (`tournament_ranking`) continua
sendo exibido na aba Torneio mesmo com `status: 'finished'` ("🏆 Ranking
final"), e o jogador pode jogar em mesas de lobby normalmente.

**`inTournamentRoom` vs `myTournamentToken`:** `myTournamentToken` indica
inscrição no torneio (usado para mostrar ranking/registro), mas **não** indica
que o jogador está sentado numa mesa de torneio agora — após a eliminação ele
pode estar numa mesa de lobby comum. `inTournamentRoom` (true somente entre
`tournament_table_assigned` e `room_joined`/`tournament_eliminated`) é o que
controla `isTournament` na `PokerTable` (esconder "Sair da mesa", mostrar
ranking lateral, etc.).

**Re-inscrição para um novo torneio:** quando `tournament_info.id` muda (novo
torneio criado pelo admin), o front limpa `myTournamentToken`/cookie e reseta
ranking/status/eliminação — o jogador vê "Inscrever-se" para o novo torneio.
O servidor reforça isso no `hello`: token que não resolve no torneio atual gera
`tournament_unregistered`.

**Deploy:** Vercel com `vercel.json` configurando fallback de SPA. O build usa
`npm` (não Bun) porque o runner de build do Vercel é Node/npm. Variáveis de
ambiente são injetadas no build pelo Vite como `import.meta.env.VITE_*`.

## Variáveis de Ambiente

Copie `front/.env.example` para `front/.env.local` e preencha:

```env
# URL do WebSocket do servidor
# Local:    ws://localhost:3001/ws
# Produção: wss://seu-app.onrender.com/ws
VITE_WS_URL=ws://localhost:3001/ws

# URL base HTTP do servidor (API admin + torneio público)
# Local:    http://localhost:3001
# Produção: https://seu-app.onrender.com
VITE_SERVER_URL=http://localhost:3001

# PostHog — analytics (deixe vazio para desabilitar)
# Obtenha em: app.posthog.com → Project Settings → Project API Key
VITE_POSTHOG_KEY=

# Host PostHog (US ou EU)
# US: https://us.i.posthog.com
# EU: https://eu.i.posthog.com
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

> Todas as vars **devem** começar com `VITE_` para serem acessíveis no bundle.
> `.env.local` está no `.gitignore` — nunca commite secrets.

## Truco

Aba separada (`♠ Poker` vs `🂡 Truco` no seletor de jogo, com `Mesas`/`Torneio`
como sub-abas apenas dentro de Poker). Estado isolado do Poker via
`useTrucoGame` (`hooks/useTrucoGame.ts`), um `useReducer` que recebe qualquer
`ServerMessage` cujo `type` comece com `truco_` (roteado no `default:` do
switch principal do `App.tsx` — não polui os ~24 cases do Poker).

- `TrucoLobby.tsx` — criar/listar mesas (modo 1x1/2x2, variante vira/fixa).
- `TrucoTable.tsx` — mesa: placar, manilhas em ordem de força (com tooltip
  explicando a vira), oponentes (nome + brilho/contagem regressiva no turno
  deles), minha mão + nome + botão de truco/responder logo abaixo, overlays de
  mão de 11 e fim de partida/revanche.
- `TrucoGuide.tsx` — painel de regras (reutiliza o shell CSS `.hand-guide-*`
  do `HandGuide.tsx`, mutuamente exclusivos na renderização).

**Identidade:** `identity.playerId` é o **token assinado** (`id.assinatura`),
mas `TrucoPlayer.id` do servidor é o **id bruto**. Comparações `player.id ===
myId` só funcionam com o id bruto — por isso `trucoState.myId` é preenchido a
partir de `truco_room_joined.yourId` (não de `identity.playerId`) e é isso que
deve ser passado como `myId` para `TrucoTable`.

## Canastra / Buraco

Aba separada (`🎴 Canastra` no seletor de jogo). Estado isolado via
`useCanastraGame` (`hooks/useCanastraGame.ts`), um `useReducer` que recebe
qualquer `ServerMessage` cujo `type` comece com `canastra_` (roteado no
`default:` do switch principal do `App.tsx`, mesmo padrão do Truco/Gaúcho).

- `CanastraLobby.tsx` — criar/listar mesas (modo 1x1/2x2).
- `CanastraTable.tsx` — mesa: placar (só após fim de mão), jogos na mesa por
  time (clicáveis pra selecionar como alvo de "acrescentar"), monte/lixo,
  badges de morto, minha mão com seleção múltipla (clicar pra
  selecionar cartas → "Formar jogo" / "Acrescentar" / "Descartar" /
  "Comprar monte" / "Comprar lixo"), overlay de fim de mão com placar
  detalhado e votação de revanche.
- `CanastraGuide.tsx` — painel de regras (reutiliza o shell CSS
  `.hand-guide-*` do `HandGuide.tsx`).

**Cartas:** usa `CanastraCard` (não `Card`) — tem `id` único (o baralho
duplo repete naipe+valor) e `suit`/`rank` nuláveis pros curingões.
`CanastraTable` renderiza via um wrapper local (`CanastraCardFace`) que
cai pro componente `PlayingCard` normal quando não é curingão.

## Observabilidade (Front)

Observabilidade client-side é feita via **PostHog**:
- Eventos de produto (join room, game actions, tournament registration)
- Session recording (opcional, configurável no dashboard PostHog)
- Feature flags (disponível, não implementado ainda)

Se `VITE_POSTHOG_KEY` estiver vazio, o PostHog **não inicializa** — comportamento
seguro para desenvolvimento local sem leak de dados.

## Como rodar localmente

```sh
cd front
bun install
bun dev        # http://localhost:5173
```

Build de produção:
```sh
bun run build  # dist/ pronto para Vercel / qualquer CDN
```
