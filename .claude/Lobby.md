# Lobby — Regras de Negócio (DDD)

## Contexto

O Lobby é o espaço de criação e entrada livre em mesas de cash game. Qualquer
jogador pode criar uma sala, e qualquer jogador pode entrar em qualquer sala
disponível — não há filas, fichas de buy-in nem rake.

---

## Entidades e Agregados

### Room (Sala)

Campo | Tipo | Descrição
---|---|---
`id` | `string` | ID único gerado aleatoriamente
`name` | `string` | Nome da sala (máx 40 chars)
`creatorName` | `string` | Nome de quem criou
`config` | `RoomConfig` | smallBlind, bigBlind, ante, maxPlayers
`startingChips` | `number` | `bigBlind × 20` — fixo na criação
`status` | `'waiting' \| 'playing'` | Aguardando jogadores ou em jogo

### RoomConfig

Campo | Restrições
---|---
`smallBlind` | mínimo 1
`bigBlind` | mínimo 2
`ante` | mínimo 0
`maxPlayers` | 2 a 6

### Player (dentro da sala)

Campos relevantes ao Lobby: `chips`, `status`, `sittingOut`.

---

## Regras de Criação de Sala

1. Limite global de **30 salas de lobby** ativas simultaneamente.
2. Salas de torneio **não contam** nesse limite.
3. O criador da sala entra automaticamente ao criar.
4. Sala vazia com menos de 2 jogadores expira em **5 minutos** se o jogo não tiver iniciado.
5. Sala com ≥ 2 jogadores tem a expiração cancelada.

---

## Regras de Entrada em Sala

1. Jogador não pode entrar em sala **cheia** (`playerCount >= maxPlayers`).
2. Jogador não pode entrar em **mesa de torneio** via join manual.
3. Se o jogador já está em outra sala, ele sai dela automaticamente antes de entrar.
4. Entrada **mid-game é permitida**: o jogador recebe o estado atual da mesa mas
   fica com `status: 'waiting'` até a próxima mão. Suas hole cards ficam vazias
   `[]` até o próximo deal.

---

## Regras de Início de Jogo

1. O jogo inicia automaticamente **300ms** após o 2º jogador entrar (sem ação do usuário).
2. Qualquer jogador pode forçar início via mensagem `start_game` — útil se o
   auto-start falhar ou para salas que precisam de mais jogadores antes de começar.
3. Precisa de no mínimo **2 jogadores ativos** (não `sittingOut`) para iniciar.

---

## Regras de Reconexão

1. A sessão do jogador persiste no servidor por `playerId` (gerado no cliente e
   salvo em `localStorage`).
2. Ao reconectar (nova conexão WS + mensagem `hello`), o servidor detecta a sessão
   existente e reconecta o jogador à sala automaticamente.
3. O servidor envia `session_restored` com `inTournament: false` + dados da sala.
4. A função `send` do jogador é atualizada na nova conexão — as mensagens
   continuam chegando normalmente.

---

## Regras de Saída de Sala

1. Jogador pode sair manualmente via `leave_room`.
2. Ao sair, se a sala ficar com **0 jogadores**, ela é destruída imediatamente.
3. Se ficar com menos de 2 jogadores e o jogo não tiver iniciado, o timer de
   expiração de 5 minutos é reiniciado.
4. Jogadores em mesas de torneio **não podem sair** via `leave_room`.

---

## Saída automática ao iniciar um torneio

Se um jogador **inscrito no torneio** estiver sentado numa sala de lobby comum
quando o torneio iniciar:

1. O servidor remove esse jogador da sala de lobby (`room.leave`), libera o
   assento e destrói a sala se ela ficar vazia; `room_list` é re-transmitido.
2. O cliente já recebeu `tournament_table_assigned` (enviado pelo `Tournament`
   antes de qualquer `hand_dealt`) e troca a view para a mesa do torneio
   automaticamente — sem notificação extra, o jogador "vai direto para o
   torneio".
3. Ações subsequentes (`player_action`, etc.) são roteadas para a mesa do
   torneio via `currentRoom(session)` (ver `.claude/Server.md`), mesmo que
   `session.roomId` da conexão ainda aponte para a sala antiga.

---

## Regras de Rebuy (Lobby)

Rebuy existe **somente em salas de lobby** — não em torneios.

1. Ao terminar uma mão com **0 chips**, o jogador recebe `rebuy_prompt` com
   `startingChips` e tem **60 segundos** para decidir.
2. Se aceitar (`rebuy`): restaurado com `startingChips`, entra na próxima mão.
3. Se recusar (`rebuy_decline`): removido da sala.
4. Se o timer expirar sem resposta: removido automaticamente (comportamento de
   `rebuy_decline`).
5. `startingChips` = `bigBlind × 20` (config da sala no momento da criação — não
   muda se os blinds forem atualizados).

---

## Fluxo de Mensagens WS (Lobby)

### Criar sala
```
Client → create_room { roomName, config }
Server → room_joined { roomId, roomName, config }
Server → player_list { players }
Server (broadcast) → room_list { rooms }
```

### Entrar em sala
```
Client → join_room { roomId }
Server → room_joined { roomId, roomName, config }
Server → player_list { players }
Server (broadcast) → room_list { rooms }
-- se jogo já iniciado:
Server → game_started
Server → hand_dealt { yourCards: [], players, tableState }
```

### Rebuy
```
Server → rebuy_prompt { startingChips, timeoutSeconds: 60 }
Client → rebuy           -- aceitar
Client → rebuy_decline   -- recusar
```

### Reconexão
```
Client → hello { playerId, name }
Server → room_joined (implícito via reconnect)
Server → game_started
Server → hand_dealt { yourCards, players, tableState }
Server → player_list
Server → session_restored { inTournament: false, roomId, roomName, config }
```
