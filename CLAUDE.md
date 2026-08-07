# Regras para o Claude Code — PokerMultiplayer

Este arquivo é lido automaticamente pelo Claude Code a cada conversa.
Alonso pode ler e auditar estas regras a qualquer momento.

---

## 🚨 REGRA #2 — Mensagens de commit concisas

- **1-2 linhas, máximo ~200 caracteres**
- High-level: o QUE foi feito, não uma lista de arquivos
- Prefixo convencional: `feat:` / `fix:` / `refactor:` / `docs:`
- **Sem** `Co-Authored-By`, sem bullet points, sem parágrafos extras

Exemplos corretos:
```
feat: pre-action buttons + blue turn indicator + reconnect your_turn fix
fix: resolve showdown side pot distribution
```

---

## 🚨 REGRA #1 — Build e testes ANTES de qualquer commit

**Esta regra não tem exceção. Nem para mudanças "pequenas".**

Antes de sugerir ou executar qualquer `git commit`, rodar obrigatoriamente:

| Sub-repo tocado | Comando obrigatório |
|---|---|
| `server/` | `cd server && bun test` |
| `front/` ou `shared/` | `cd front && bun x tsc -b` |
| Ambos | Rodar os dois |

Só propor o commit depois de ver **zero erros** nos dois outputs.

**Por que existe esta regra:**
Um campo `bestCards` foi adicionado ao tipo `ShowdownResult` do server mas o
tipo `ShowdownEntry` do front não foi atualizado. O erro só apareceu no build
da Vercel — em produção, com usuários reais jogando. O deploy quebrou.
Isso não pode se repetir.

---

## 🚨 REGRA #3 — Lint (Biome) e auditoria de dependências (bun audit)

Automatizado via git hook (`.githooks/pre-commit`) — roda sozinho a cada
`git commit`, mas nenhum sub-agente deve tentar contornar ou pular o hook.

**Setup de uma vez por clone** (não persiste automaticamente):
```sh
git config core.hooksPath .githooks
```

| Checagem | Bloqueia o commit? |
|---|---|
| `biome check .` — erros | Sim |
| `biome check .` — warnings | Não (ver `biome.json` para o que foi rebaixado a warning e por quê) |
| `bun audit` (raiz, `server/`, `front/`) — high/critical | Sim |
| `bun audit` — moderate/low | Não, só aparece como aviso |

Vulnerabilidades em dependências transitivas são corrigidas via campo
`overrides` no `package.json` de cada sub-repo (não editar `bun.lock` à mão).
Ver `.claude/Server.md` / `.claude/Front.md` para o histórico do que já foi
fixado dessa forma.

`noNonNullAssertion` está desligado no `biome.json` — o operador `!` é usado
deliberadamente em todo o código (ex.: acesso a array já validado por
tamanho/bounds antes) e não deve ser "corrigido" para `?.`, que muda
silenciosamente o tipo de retorno e pode quebrar chamadas downstream.

---

## Estrutura do projeto

```
/
├── server/          Bun + WebSocket (backend)
├── front/           React + Vite (frontend)
├── shared/types.ts  Tipos compartilhados server ↔ front
├── .claude/         Documentação de regras de negócio do poker
│   ├── Poker.md     Regras Texas Hold'em implementadas (TDA 2024)
│   ├── Front.md
│   ├── Server.md
│   ├── Lobby.md
│   ├── Tournament.md
│   └── BloomFilter.md
├── .githooks/       Hook de pre-commit (Biome + bun audit) — ver Regra #3
├── biome.json       Config do linter (Biome) — cobre front/, server/, shared/
├── Dockerfile       Build Docker para Render.com (free tier)
└── render.yaml      Config de deploy no Render
```

## Deploy

Stack atual: **Vercel + Render**.

| Serviço | O que roda | Config |
|---|---|---|
| Render.com | Backend Bun via Docker | `render.yaml` |
| Vercel | Frontend React estático | `vercel.json` |

> **Histórico:** o backend já foi hospedado no **Railway**. Migramos para o
> Render por custo (free tier mais previsível). A config do Railway
> (`railway.toml` / `railway.json`) foi removida do repositório.

Variáveis de ambiente sensíveis (`PLAYER_SECRET`, `ADMIN_USER`, `ADMIN_PASS`)
nunca ficam em arquivos commitados — apenas nos painéis de cada plataforma.
