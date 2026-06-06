# Tournament — Regras de Negócio (DDD)

## Contexto

O torneio é um evento único e global — só existe **um torneio ativo por vez**.
É criado e gerenciado pelo admin via painel. Os jogadores se inscrevem antes do
início e são distribuídos em mesas automaticamente.

---

## Entidades e Agregados

### Tournament

Campo | Descrição
---|---
`id` | ID único gerado no servidor
`name` | Nome do torneio (máx 40 chars)
`status` | `registering → running → final_table → finished`
`scheduledStart` | ISO 8601 — auto-inicia se chegar a esse horário com ≥ 2 inscritos
`config` | `RoomConfig` dos blinds iniciais (nível 1)
`startingChips` | `bigBlind × 20` (config inicial)

### TournamentPlayer

Campo | Descrição
---|---
`id` | `playerId`
`chips` | Chips atuais (sincronizado da mesa a cada ranking broadcast)
`tableId` | Mesa atual (`null` se eliminado)
`rank` | Posição final (atribuída na eliminação, 1 = vencedor)
`eliminated` | `boolean`
`eliminatedAt` | Timestamp da eliminação

### BlindLevel

Campo | Descrição
---|---
`level` | Número do nível (começa em 1)
`smallBlind` | SB do nível
`bigBlind` | BB do nível
`ante` | Ante do nível (0 se desativado)
`durationMinutes` | Duração fixa: **10 minutos**

---

## Regras de Inscrição

1. Inscrição permitida somente enquanto `status = 'registering'`.
2. Cada jogador recebe um **token único** ao se inscrever — salvo no `localStorage`
   do cliente. Esse token é a credencial de reconexão durante o torneio.
3. É possível se desinscrever (`unregister_tournament`) enquanto `registering`.
4. Após o início, nenhuma inscrição ou desincrição é aceita.

---

## Regras de Início

1. O admin pode iniciar manualmente via `POST /api/admin/tournament/start`.
2. Auto-início: quando o `scheduledStart` é atingido com ≥ 2 jogadores inscritos,
   o torneio inicia automaticamente.
3. Precisa de no mínimo **2 inscritos** para iniciar.

---

## Distribuição em Mesas

1. Máximo de **6 jogadores por mesa**.
2. Os jogadores são distribuídos em `ceil(n / 6)` mesas de forma round-robin.
3. Cada mesa recebe os blinds iniciais do torneio.
4. Todas as mesas iniciam o jogo imediatamente após a distribuição.
5. Mesas de torneio são identificadas pelo campo `tournamentId` na `Room`.

---

## Regras de Blind Schedule

1. A progressão começa nos blinds iniciais configurados no torneio.
2. A cada **10 minutos**, os blinds **dobram** (SB, BB e Ante × 2).
3. São gerados **20 níveis** de blinds automaticamente.
4. Ao avançar de nível, **todas as mesas ativas** recebem `updateConfig` com os
   novos blinds — o efeito entra na próxima mão.
5. O servidor envia `blind_update` a todos os inscritos com o nível atual,
   o próximo, e os segundos restantes para o próximo aumento.

---

## Regras de Eliminação

1. Um jogador é eliminado quando sua mesa reporta `onPlayerEliminated` (chips = 0
   ao fim de uma mão).
2. A rank é atribuída em ordem decrescente de eliminação:
   - `rankCounter` começa em `totalPlayers` e decrementa a cada eliminação.
   - O vencedor recebe `rank = 1`.
3. Ao ser eliminado, o jogador recebe `tournament_eliminated { rank, totalPlayers }`.
4. O ranking é transmitido imediatamente a todos após cada eliminação.

---

## Regras de Rebalanceamento de Mesas

Executado após cada eliminação:

1. Compara a mesa com **mais jogadores** com a mesa com **menos jogadores**.
2. Se a diferença for **≥ 2** e a menor não estiver cheia, move um jogador.
3. O jogador movido **não pode ser Dealer, SB ou BB** da mão atual (para não
   interromper o ciclo de blinds).
4. O jogador recebe `tournament_table_assigned` com os dados da nova mesa.
5. Mesas com 0 jogadores são destruídas e removidas do servidor.

---

## Regras de Mesa Final

1. Quando o número de jogadores restantes cai para **≤ 8**, o torneio entra em
   `final_table`.
2. Todos os jogadores remanescentes são movidos para uma **nova mesa** chamada
   `"{nome} — Mesa Final"`.
3. Todos recebem `tournament_final_table { tableId }`.
4. Se já houver apenas 1 mesa ativa com ≤ 8 jogadores, ela vira a mesa final
   sem migração.

---

## Regras de Término

1. Quando restar **1 jogador** (todos os outros eliminados), o torneio termina.
2. O vencedor recebe `rank = 1`.
3. Todos os inscritos recebem `tournament_finished { winnerId, winnerName }`.
4. **60 segundos** após o fim, todas as mesas do torneio são destruídas e
   removidas da lista de salas.

---

## Modo Away (Ausência)

1. Exclusivo de torneios — não existe em salas de lobby.
2. Jogador pode marcar `set_away`: seu status vira `'away'` e ele faz fold
   automático em ~800ms quando for sua vez.
3. `set_back` restaura o status para `'active'`.
4. Away não elimina o jogador — ele permanece na mesa consumindo blinds.

---

## Reconexão em Torneio

1. O cliente salva o `tournamentToken` em `localStorage`.
2. Na reconexão, envia `hello { playerId, name, tournamentToken }`.
3. O servidor localiza o registro via token, atualiza a função `send`, e envia:
   - `session_restored { inTournament: true, roomId?, roomName?, config? }`
   - `tournament_info`
   - ranking atual via `tournament_ranking`
   - se em mesa: reconecta à mesa e envia estado atual

---

## Ranking Broadcast

- Transmitido imediatamente após cada eliminação.
- Transmitido a cada **30 segundos** enquanto `running` ou `final_table`.
- Jogadores ativos ordenados por chips decrescente; eliminados por rank crescente.

---

## Fluxo de Mensagens WS (Torneio)

### Inscrição
```
Client → register_tournament
Server → tournament_registered { token }
Server (broadcast) → tournament_info { registeredCount++ }
```

### Início
```
Server (broadcast) → tournament_started
Server (individual) → tournament_table_assigned { roomId, roomName, config }
Server (broadcast) → tournament_ranking { players, status }
```

### Avance de blinds
```
Server (broadcast) → blind_update { current, next, nextInSeconds }
```

### Eliminação
```
Server (individual) → tournament_eliminated { rank, totalPlayers }
Server (broadcast) → tournament_ranking { players, status }
```

### Mesa Final
```
Server (broadcast/individual) → tournament_final_table { tableId }
Server (individual) → tournament_table_assigned { roomId, roomName, config }
```

### Fim
```
Server (broadcast) → tournament_finished { winnerId, winnerName }
```
