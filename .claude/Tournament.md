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
5. **Token de um torneio anterior nunca é válido para um torneio novo.** Um único
   `activeTournament` existe por vez (novo só pode ser criado quando o anterior
   está `finished`), e cada `Tournament` tem seu próprio mapa de tokens
   (`byToken`/`registrations`). Quando o cliente reconecta (`hello`) com um
   `tournamentToken` que não resolve no torneio atual, o servidor:
   - limpa o token da sessão persistente e do cookie do cliente;
   - responde `tournament_unregistered`.

   Isso garante que o jogador veja "Inscrever-se" (não "✓ Você está inscrito")
   para o novo torneio. Em conexões já abertas (sem reload), o front também
   detecta a troca via `tournament_info.id` mudando e faz a mesma limpeza.

---

## Regras de Início

1. O admin pode iniciar manualmente via `POST /api/admin/tournament/start`.
2. Auto-início: quando o `scheduledStart` é atingido com ≥ 2 jogadores inscritos,
   o torneio inicia automaticamente.
3. Precisa de no mínimo **2 inscritos** para iniciar.
4. **Ordem de mensagens crítica:** para cada jogador, `tournament_started` e
   `tournament_table_assigned` são enviados **antes** de `room.startGame()` (que
   dispara `hand_dealt`/`your_turn`). O front troca para a view da mesa ao
   receber `tournament_table_assigned`, resetando cards/turno/tableState — se
   `hand_dealt` chegasse primeiro, esse reset apagaria o estado da primeira mão
   (bug original: torneio começava sem cartas, sem pot e sem ações).
5. **Jogador inscrito que estava em sala de lobby comum:** ao iniciar o torneio,
   o servidor remove esse jogador da sala de lobby (libera o assento, destrói a
   sala se ficar vazia) — ele vai direto para a mesa do torneio, sem notificação
   extra. Veja "Roteamento de Ações" abaixo para como as ações passam a ser
   roteadas corretamente para a mesa do torneio.

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

1. Um jogador é eliminado quando termina uma mão com chips = 0. A `Room` coleta
   **todos** os jogadores zerados naquela mão num único batch
   (`{ playerId, totalBet }[]`) e reporta via `onPlayersEliminated` — uma única
   chamada por mão, mesmo que vários jogadores tenham sido eliminados juntos
   (all-in múltiplo / side pots). Processar um por um causaria mesas "zumbi"
   se o primeiro elimination disparasse rebalance/mesa-final antes dos outros
   serem marcados.
2. **Critério de desempate (eliminações simultâneas, mesma mão):** os jogadores
   do batch são ordenados por `totalBet` (quanto cada um colocou no pote
   naquela mão), do menor para o maior:
   - Quem colocou **menos** fichas é ranqueado **pior** (rank atribuído primeiro,
     ou seja, valor de rank mais alto / mais perto do último lugar).
   - Quem colocou **mais** fichas é ranqueado **melhor** entre os eliminados
     do batch (mais perto do 1º lugar), mesmo tendo sido eliminado na mesma mão.
   - Todos os jogadores do batch recebem o **mesmo `eliminatedAt`** (timestamp
     único do batch).
3. A rank é atribuída em ordem decrescente:
   - `rankCounter` começa em `totalPlayers` e decrementa a cada eliminação
     (na ordem definida pelo critério acima).
   - O vencedor recebe `rank = 1` (atribuído em `checkFinished`, não no batch).
4. Ao ser eliminado, o jogador recebe `tournament_eliminated { rank, totalPlayers }`.
5. O ranking é transmitido imediatamente a todos após cada batch de eliminação.

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
5. **Conservação de fichas durante a migração:** se a mesa antiga está sendo
   destruída no meio de uma mão (pote ainda não resolvido), `getPlayerChips`
   (`gp.chips`) não inclui o que o jogador já apostou naquela mão. A migração
   usa `getPlayerMigrationChips`, que devolve `gp.chips + gp.totalBet` enquanto
   `tableState.pot > 0`, e `gp.chips` quando o pote já foi resolvido. Sem isso,
   fichas apostadas na mão em andamento "somem" ao destruir a mesa antiga.

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
4. **Token inválido/obsoleto** (torneio anterior já não existe ou foi
   substituído): o servidor limpa o token da sessão e responde
   `tournament_unregistered`, em vez de simplesmente ignorar — ver "Regras de
   Inscrição" acima.

---

## Roteamento de Ações durante o Torneio

`session.roomId` (estado por conexão WS) só é atualizado em `create_room`,
`join_room` e na reconexão (`hello`). Quando o torneio inicia, faz
rebalanceamento, ou monta a mesa final, o jogador é movido para outra `Room`
**sem** que `session.roomId` da conexão já aberta seja atualizado — apenas
`tournament_table_assigned` é enviado para o front trocar a view.

Por isso, `player_action`, `set_away`, `set_back` e `start_game` resolvem a sala
via `currentRoom(session)`:
- Se o jogador está registrado no torneio ativo e **não eliminado**
  (`activeTournament.getTableId(pid)` retorna uma mesa), usa essa mesa —
  fonte da verdade mantida pelo `Tournament` (start, rebalance, mesa final).
- Caso contrário, usa `session.roomId` (mesas de lobby, ou jogador eliminado
  que entrou numa mesa de lobby).

---

## Pós-Eliminação

1. Ao ser eliminado, o jogador **não** é forçado para uma tela separada — ele
   volta para a UI normal (lobby/abas), com a aba "🏆 Torneio" selecionada
   automaticamente.
2. Na aba Torneio, um banner mostra a colocação final (`rank/total`) e o nome
   do vencedor (se já houver), com um botão "OK" para dispensar o banner —
   isso não afeta o estado do torneio, só esconde o aviso.
3. O jogador eliminado continua recebendo `tournament_ranking` (ranking ao
   vivo e, depois, ranking final com `status: 'finished'`) — pode voltar à
   aba Torneio a qualquer momento, durante ou após o torneio, para conferir.
4. O jogador eliminado pode jogar normalmente em mesas de lobby. O front
   rastreia `inTournamentRoom` (true apenas enquanto sentado numa mesa de
   torneio) para decidir `isTournament` na `PokerTable` — evita esconder
   controles de lobby (ex.: "Sair da mesa") com base num token de torneio que
   ainda existe só para fins de exibição do ranking.

---

## Lobby Pub/Sub

`broadcastRoomList()`/`broadcastTournamentInfo()` usam
`server.publish('lobby', ...)`. Toda conexão WS chama `ws.subscribe('lobby')`
no `open()` — sem isso, esses broadcasts não chegam a clientes já conectados
(eles só veem o snapshot enviado na conexão), e um torneio novo criado pelo
admin fica "invisível" até o cliente recarregar a página.

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
