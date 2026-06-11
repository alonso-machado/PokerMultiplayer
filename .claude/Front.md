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
