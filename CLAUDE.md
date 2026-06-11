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
