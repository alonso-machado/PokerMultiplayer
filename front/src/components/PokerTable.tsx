import { useState, useEffect, useRef } from 'react'
import type { BlindLevel, Card, Player, PlayerAction, RoomConfig, TableState, TournamentPlayer, TournamentStatus } from '../../../shared/types'
import { startingChipsFor } from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { TournamentRanking } from './TournamentRanking'

const ACTION_TIMEOUT_S = 90

interface Props {
  myId: string
  myName: string
  roomName: string
  config: RoomConfig
  players: Player[]
  tableState: TableState | null
  myCards: Card[]
  myTurn: boolean
  validActions: PlayerAction[]
  callAmount: number
  minRaise: number
  showdown: ShowdownEntry[] | null
  handResult: { winnerName: string; amount: number; handName?: string } | null
  rebuyPrompt: { startingChips: number } | null
  isStarted: boolean
  isAway: boolean
  isTournament: boolean
  isFinalTable: boolean
  tournamentRanking: TournamentPlayer[] | null
  tournamentStatus: TournamentStatus | null
  nextBlinds: BlindLevel | null
  nextBlindsInSec: number | null
  onLeave: () => void
  onAction: (action: PlayerAction, amount?: number) => void
  onRebuy: () => void
  onRebuyDecline: () => void
  onSetAway: () => void
  onSetBack: () => void
}

interface ShowdownEntry { playerId: string; playerName: string; cards: Card[]; bestCards: Card[]; handName: string; won: number }

// Seat positions — 0 is the local player (bottom-center, slightly higher to leave room for cards)
const SEAT_POSITIONS = [
  { left: '50%', top: '78%' },   // 0 — you (raised slightly so cards don't overlap)
  { left: '16%', top: '68%' },   // 1 — bottom-left
  { left: '9%',  top: '36%' },   // 2 — left
  { left: '50%', top: '10%' },   // 3 — top
  { left: '91%', top: '36%' },   // 4 — right
  { left: '84%', top: '68%' },   // 5 — bottom-right
]

export function PokerTable({
  myId, myName, roomName, config, players, tableState, myCards,
  myTurn, validActions, callAmount, minRaise,
  showdown, handResult, rebuyPrompt,
  isStarted, isAway, isTournament, isFinalTable,
  tournamentRanking, tournamentStatus,
  nextBlinds, nextBlindsInSec,
  onLeave, onAction, onRebuy, onRebuyDecline, onSetAway, onSetBack,
}: Props) {
  const [raiseAmount,    setRaiseAmount]    = useState(minRaise)
  const [rebuyCountdown, setRebuyCountdown] = useState(60)
  const [turnTimer,      setTurnTimer]      = useState(ACTION_TIMEOUT_S)
  const [redFlash,       setRedFlash]       = useState(false)
  const autoFoldedRef = useRef(false)

  // ── Rebuy countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!rebuyPrompt) { setRebuyCountdown(60); return }
    setRebuyCountdown(60)
    const id = setInterval(() => {
      setRebuyCountdown(prev => {
        if (prev <= 1) { clearInterval(id); onRebuyDecline(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [rebuyPrompt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 90s action timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!myTurn) {
      setTurnTimer(ACTION_TIMEOUT_S)
      autoFoldedRef.current = false
      return
    }
    setTurnTimer(ACTION_TIMEOUT_S)
    autoFoldedRef.current = false

    const id = setInterval(() => {
      setTurnTimer(prev => {
        if (prev <= 1) {
          clearInterval(id)
          if (!autoFoldedRef.current) {
            autoFoldedRef.current = true
            // Red flash then auto-fold
            setRedFlash(true)
            setTimeout(() => setRedFlash(false), 800)
            onAction('fold')
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [myTurn]) // eslint-disable-line react-hooks/exhaustive-deps

  const startingChips = startingChipsFor(config)
  const currentPlayer = tableState ? players[tableState.currentPlayerIndex] : null
  const phase         = tableState?.phase ?? 'waiting'
  const pot           = tableState?.pot ?? 0
  const effectiveMin  = Math.max(minRaise, config.bigBlind * 2)
  const myPlayer      = players.find(p => p.id === myId)
  const myChips       = myPlayer?.chips ?? 0

  const timerPct  = (turnTimer / ACTION_TIMEOUT_S) * 100
  const timerColor = timerPct > 50 ? '#2ecc71' : timerPct > 25 ? '#f39c12' : '#e74c3c'

  const ordered = [...players].sort((a, b) => {
    if (a.id === myId) return -1
    if (b.id === myId) return 1
    return a.seatIndex - b.seatIndex
  })

  return (
    <div className={`table-view${redFlash ? ' red-flash' : ''}`}>
      {/* Topbar */}
      <div className="table-topbar">
        <span className="room-title">
          {isFinalTable && <span className="final-badge">MESA FINAL </span>}
          {roomName}
        </span>
        <span className="topbar-blinds">
          Blinds {config.smallBlind}/{config.bigBlind}
          {config.ante > 0 ? ` · Ante ${config.ante}` : ''}
          {' · '}{startingChips} fichas
        </span>
        <span className="topbar-name">👤 {myName}</span>

        {isTournament && nextBlinds && nextBlindsInSec !== null && (
          <div className="blind-next">
            <span className="blind-next-label">Próx. blinds</span>
            <span className="blind-next-value">{nextBlinds.smallBlind}/{nextBlinds.bigBlind}</span>
            <span className="blind-next-timer">{formatTime(nextBlindsInSec)}</span>
          </div>
        )}

        {!isTournament && (
          <button className="btn-leave" onClick={onLeave}>Sair da mesa</button>
        )}
      </div>

      <div className="table-body">
        {/* Tournament ranking sidebar */}
        {isTournament && tournamentRanking && tournamentStatus && (
          <TournamentRanking
            players={tournamentRanking} status={tournamentStatus}
            isFinalTable={isFinalTable} myId={myId}
          />
        )}

        {/* Felt */}
        <div className="felt">
          {/* Seats */}
          <div className="seats">
            {ordered.map((p, i) => {
              const pos      = SEAT_POSITIONS[i]
              if (!pos) return null
              const isActive = currentPlayer?.id === p.id
              return (
                <div key={p.id} className={[
                  'seat',
                  isActive ? 'active-turn' : '',
                  p.status === 'folded' ? 'folded' : '',
                  p.status === 'away'   ? 'away'   : '',
                ].filter(Boolean).join(' ')}
                  style={{ left: pos.left, top: pos.top }}
                >
                  {p.isDealer && <span className="dealer-btn">D</span>}
                  <span className="seat-name">
                    {p.isSmallBlind && <span className="blind-badge">SB</span>}
                    {p.isBigBlind   && <span className="blind-badge">BB</span>}
                    {p.name}{p.id === myId ? ' ★' : ''}
                    {p.status === 'away'    && <span className="away-badge">⏸</span>}
                    {p.status === 'waiting' && isStarted && <span className="waiting-badge">⏳</span>}
                  </span>
                  <span className="seat-chips">💰 {p.chips.toLocaleString()}</span>
                  {p.bet > 0 && <span className="seat-bet">⬆ {p.bet.toLocaleString()}</span>}
                  {p.status === 'all-in' && <span className="allin-badge">ALL-IN</span>}
                  {p.status === 'folded'  && <span className="fold-badge">FOLD</span>}
                </div>
              )
            })}
          </div>

          {/* Board center */}
          <div className="board-center">
            {phase !== 'waiting' && <span className="phase-badge">{phaseLabel(phase)}</span>}
            <div className="pot-display">Pote: {pot.toLocaleString()} fichas</div>
            <div className="community-cards">
              {(tableState?.communityCards ?? []).concat(
                Array(Math.max(0, 5 - (tableState?.communityCards?.length ?? 0))).fill(null)
              ).map((card, i) =>
                card
                  ? <PlayingCard key={i} card={card} width={52} />
                  : <div key={i} className="card-placeholder" />
              )}
            </div>
          </div>

          {/* Showdown */}
          {showdown && showdown.length > 0 && (
            <div className="showdown-overlay">
              <div className="showdown-box">
                <h2>Showdown</h2>
                {handResult && (
                  <p className="hand-result-msg">
                    🏆 {handResult.winnerName} ganhou {handResult.amount.toLocaleString()}
                    {handResult.handName ? ` com ${handResult.handName}` : ''}
                  </p>
                )}
                {showdown.map(r => {
                  const holeKeys = new Set(r.cards.map(c => `${c.rank}${c.suit}`))
                  return (
                    <div key={r.playerId} className={`showdown-result${r.won > 0 ? ' winner' : ''}`}>
                      <span>{r.playerName}: <em>{r.handName}</em></span>
                      <div className="showdown-cards">
                        {r.bestCards.map((c, i) => (
                          <div key={i} className={`showdown-card-wrap${holeKeys.has(`${c.rank}${c.suit}`) ? ' hole-card' : ''}`}>
                            <PlayingCard card={c} width={40} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Lobby rebuy dialog */}
          {rebuyPrompt && !isTournament && (
            <div className="showdown-overlay">
              <div className="showdown-box rebuy-box">
                <h2>Fichas esgotadas</h2>
                <p className="rebuy-msg">Deseja fazer rebuy e continuar na mesa?</p>
                <p className="rebuy-chips"><strong>{rebuyPrompt.startingChips.toLocaleString()}</strong> fichas</p>
                <div className="rebuy-countdown">
                  <span>{rebuyCountdown}s</span>
                  <div className="rebuy-bar" style={{ width: `${(rebuyCountdown / 60) * 100}%` }} />
                </div>
                <div className="rebuy-actions">
                  <button className="btn-rebuy-yes" onClick={onRebuy}>♻ Rebuy ({rebuyPrompt.startingChips.toLocaleString()})</button>
                  <button className="btn-rebuy-no"  onClick={onRebuyDecline}>Sair da mesa</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <div className="action-bar">

        {/* Timer bar — separator between felt and actions, visible only on my turn */}
        {isStarted && myTurn && !isAway && (
          <div className="turn-timer-bar">
            <div
              className="turn-timer-fill"
              style={{ width: `${timerPct}%`, background: timerColor }}
            />
            <span className="turn-timer-count" style={{ color: timerColor }}>
              {turnTimer}s
            </span>
          </div>
        )}

        {/* ── My cards row (always bottom of action bar when in hand) ───── */}
        {(myCards.length > 0 || isAway) && (
          <div className="my-cards-row">
            {isAway ? (
              <>
                <span className="away-label">⏸ Afastado — auto-fold ativo</span>
                <button className="btn-back" onClick={onSetBack}>Voltar à mesa</button>
              </>
            ) : (
              <>
                <div className="my-cards-hand">
                  {myCards.map((c, i) => <PlayingCard key={i} card={c} width={72} />)}
                </div>
              </>
            )}
          </div>
        )}

        {/* Lobby waiting for second player */}
        {!isTournament && !isStarted && (
          <div className="action-btns">
            <span className="status-msg">
              {players.length < 2
                ? `Aguardando outro jogador… (${players.length}/2)`
                : 'Iniciando…'}
            </span>
          </div>
        )}

        {/* Waiting for another player's turn */}
        {isStarted && !myTurn && !isAway && !rebuyPrompt && (
          <div className="action-btns-row">
            <span className="status-msg">
              {currentPlayer ? `Vez de ${currentPlayer.name}…` : 'Aguardando próxima mão…'}
            </span>
            {isTournament && myChips > 0 && (
              <button className="btn-away" onClick={onSetAway}>⏸ Levantar</button>
            )}
          </div>
        )}

        {/* Action buttons — my turn */}
        {isStarted && myTurn && !isAway && (
          <>
            <div className="action-btns">
              {validActions.includes('fold')   && <button className="btn-fold"  onClick={() => onAction('fold')}>Fold</button>}
              {validActions.includes('check')  && <button className="btn-check" onClick={() => onAction('check')}>Check</button>}
              {validActions.includes('call')   && (
                <button className="btn-call" onClick={() => onAction('call')}>
                  Call{callAmount > 0 ? ` ${callAmount.toLocaleString()}` : ''}
                </button>
              )}
              {validActions.includes('raise')  && (
                <button className="btn-raise" onClick={() => onAction('raise', Math.max(raiseAmount, effectiveMin))}>
                  Raise {Math.max(raiseAmount, effectiveMin).toLocaleString()}
                </button>
              )}
              {validActions.includes('all-in') && <button className="btn-allin" onClick={() => onAction('all-in')}>All-in</button>}
              {isTournament && (
                <button className="btn-away" onClick={onSetAway}>⏸ Levantar</button>
              )}
            </div>
            {validActions.includes('raise') && myChips > effectiveMin && (
              <div className="raise-row">
                <span>Raise:</span>
                <input type="range" min={effectiveMin} max={myChips} step={config.bigBlind}
                  value={Math.max(raiseAmount, effectiveMin)}
                  onChange={e => setRaiseAmount(Number(e.target.value))} />
                <span>{Math.max(raiseAmount, effectiveMin).toLocaleString()}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function phaseLabel(phase: string): string {
  return ({ preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' } as Record<string, string>)[phase] ?? phase
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
