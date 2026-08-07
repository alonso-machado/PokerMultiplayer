import { useState, useEffect } from 'react'
import type { Card, GoFishPlayer, GoFishRoomConfig, GoFishTableState, Rank } from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { GoFishGuide } from './GoFishGuide'
import type { GoFishAskEvent, GoFishRoundEnd, GoFishRematchStatus } from '../hooks/useGoFishGame'

interface Props {
  myId: string
  roomName: string
  config: GoFishRoomConfig
  players: GoFishPlayer[]
  tableState: GoFishTableState | null
  myCards: Card[]
  isStarted: boolean
  turnDeadline: number | null
  askableRanks: Rank[]
  lastAsk: GoFishAskEvent | null
  roundEnd: GoFishRoundEnd | null
  rematch: GoFishRematchStatus | null
  onLeave: () => void
  onStartGame: () => void
  onAsk: (targetPlayerId: string, rank: Rank) => void
  onRematchVote: (accept: boolean) => void
}

function describeAsk(ev: GoFishAskEvent, players: GoFishPlayer[], myId: string): string {
  const asker  = ev.askerId === myId ? 'Você' : (players.find((p) => p.id === ev.askerId)?.name ?? '?')
  const target = ev.targetId === myId ? 'você' : (players.find((p) => p.id === ev.targetId)?.name ?? '?')
  const books = ev.booksCompleted.length > 0
    ? ` 📚 Baralho completo de ${ev.booksCompleted.map((b) => b.rank).join(', ')}!`
    : ''
  if (ev.cardsTransferred > 0 && !ev.wentFish) {
    return `${asker} pediu ${ev.rank} pra ${target} — pegou ${ev.cardsTransferred}!${books}`
  }
  if (ev.drawnMatch) {
    return `${asker} pediu ${ev.rank} pra ${target}, foi pescar e tirou ${ev.rank} — pega de novo!${books}`
  }
  return `${asker} pediu ${ev.rank} pra ${target} — foi pescar!`
}

export function GoFishTable({
  myId, roomName, config, players, tableState, myCards, isStarted, turnDeadline, askableRanks, lastAsk,
  roundEnd, rematch, onLeave, onStartGame, onAsk, onRematchVote,
}: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const countdown = turnDeadline !== null ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null

  const [selectedRank, setSelectedRank] = useState<Rank | null>(null)
  useEffect(() => { setSelectedRank(null) }, [tableState?.turnPlayerId])

  const me = players.find((p) => p.id === myId)
  const others = players.filter((p) => p.id !== myId)
  const isMyTurn = !!tableState && tableState.phase === 'playing' && tableState.turnPlayerId === myId

  function handleAsk(targetId: string) {
    if (!selectedRank) return
    onAsk(targetId, selectedRank)
    setSelectedRank(null)
  }

  return (
    <div className="truco-table">
      <div className="truco-topbar">
        <div>
          <strong>{roomName}</strong>
          <span className="hint"> · até {config.maxPlayers} jogadores · Go Fish</span>
        </div>
        <button type="button" className="btn-cancel-small" onClick={onLeave}>Sair da mesa</button>
      </div>

      {!isStarted && (
        <div className="empty-rooms">
          Aguardando jogadores...
          {players.length >= 2 && (
            <div className="actions">
              <button type="button" className="btn-confirm" onClick={onStartGame}>Começar agora</button>
            </div>
          )}
        </div>
      )}

      {isStarted && tableState && (
        <>
          <div className="truco-others">
            {others.map((p) => {
              const active = p.id === tableState.turnPlayerId
              const canTarget = isMyTurn && !!selectedRank && p.status !== 'out'
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`truco-player-badge gf-player-badge${active ? ' active-turn' : ''}${p.status === 'out' ? ' gf-out' : ''}`}
                  disabled={!canTarget}
                  onClick={() => handleAsk(p.id)}
                  title={canTarget ? `Pedir ${selectedRank} pra ${p.name}` : undefined}
                >
                  <span className="seat-name">{p.name}{p.status === 'out' && ' (fora)'}</span>
                  <span className="hint">🂡×{p.handCount}</span>
                  {p.books.length > 0 && <span className="hint">📚×{p.books.length}</span>}
                  {active && countdown !== null && <span className="truco-countdown">{countdown}s</span>}
                </button>
              )
            })}
          </div>

          <div className="gf-stock">
            <span className="hint">Monte ({tableState.stockCount})</span>
            <PlayingCard faceDown width={44} />
          </div>

          {lastAsk && <div className="gf-log">{describeAsk(lastAsk, players, myId)}</div>}

          <div className={`truco-my-area${isMyTurn ? ' active-turn' : ''}`}>
            {me && me.books.length > 0 && (
              <div className="gf-my-books">
                {me.books.map((rank) => <span key={rank} className="gf-book-badge">📚 {rank}</span>)}
              </div>
            )}

            <div className="truco-hand">
              {myCards.map((c, i) => (
                <div key={`${c.suit}-${c.rank}-${i}`} className="truco-hand-card">
                  <PlayingCard card={c} width={56} />
                </div>
              ))}
            </div>

            <div className="truco-my-name">
              {me?.name}
              {isMyTurn && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
            </div>

            {isMyTurn && (
              <>
                <div className="option-row gf-rank-row">
                  {askableRanks.map((rank) => (
                    <button
                      key={rank}
                      type="button"
                      className={`option-btn${selectedRank === rank ? ' active' : ''}`}
                      onClick={() => setSelectedRank((prev) => (prev === rank ? null : rank))}
                    >
                      {rank}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  {selectedRank ? `Escolha um oponente pra pedir cartas de ${selectedRank}.` : 'Escolha uma carta pra pedir.'}
                </span>
              </>
            )}
          </div>
        </>
      )}

      {roundEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>
              {roundEnd.winnerIds.length > 1 ? 'Empate!'
                : roundEnd.winnerIds[0] === myId ? '🏆 Você venceu!' : `${roundEnd.players.find((p) => p.id === roundEnd.winnerIds[0])?.name ?? 'Alguém'} venceu!`}
            </h2>
            <div className="canastra-breakdown">
              {roundEnd.players.map((p) => (
                <div key={p.id} className="canastra-breakdown-team">
                  <strong>{p.id === myId ? 'Você' : p.name}</strong>
                  <div className="auto-row"><span>Baralhos</span><span>{p.books.length}</span></div>
                  {roundEnd.matchWins[p.id] !== undefined && (
                    <div className="auto-row"><span>Vitórias</span><span>{roundEnd.matchWins[p.id]}</span></div>
                  )}
                </div>
              ))}
            </div>
            {rematch && <p className="hint">Aguardando: {rematch.pending.length} jogador(es)...</p>}
            <div className="actions">
              <button type="button" className="btn-cancel" onClick={() => onRematchVote(false)}>Sair</button>
              <button type="button" className="btn-confirm" onClick={() => onRematchVote(true)}>Jogar novamente</button>
            </div>
          </div>
        </div>
      )}

      <GoFishGuide />
    </div>
  )
}
