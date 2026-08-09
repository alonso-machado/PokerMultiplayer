import { useState, useEffect } from 'react'
import type {
  PushYourLuckDrawCard, PushYourLuckDrawPlayer, PushYourLuckDrawRoomConfig, PushYourLuckDrawTableState,
} from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { PushYourLuckDrawGuide } from './PushYourLuckDrawGuide'
import type {
  PushYourLuckDrawDrawEvent, PushYourLuckDrawMatchEnd, PushYourLuckDrawRematchStatus, PushYourLuckDrawStopEvent,
} from '../hooks/usePushYourLuckDrawGame'

interface Props {
  myId: string
  roomName: string
  config: PushYourLuckDrawRoomConfig
  players: PushYourLuckDrawPlayer[]
  tableState: PushYourLuckDrawTableState | null
  isStarted: boolean
  myTurn: boolean
  turnDeadline: number | null
  lastDraw: PushYourLuckDrawDrawEvent | null
  lastStop: PushYourLuckDrawStopEvent | null
  roundEnd: { players: PushYourLuckDrawPlayer[]; tableState: PushYourLuckDrawTableState } | null
  matchEnd: PushYourLuckDrawMatchEnd | null
  rematch: PushYourLuckDrawRematchStatus | null
  onLeave: () => void
  onStartGame: () => void
  onDraw: () => void
  onStop: () => void
  onRematchVote: (accept: boolean) => void
}

function PushYourLuckDrawCardFace({ card, width = 44 }: { card: PushYourLuckDrawCard; width?: number }) {
  if (card.isJoker) {
    const height = Math.round(width * 1.4)
    return (
      <svg width={width} height={height} viewBox="0 0 52 74" xmlns="http://www.w3.org/2000/svg">
        <rect width="52" height="74" rx="5" fill="#fff8e1" stroke="#e0a800" strokeWidth="1.5" />
        <text x="26" y="30" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#b8860b">SAVE</text>
        <text x="26" y="55" textAnchor="middle" fontSize="20" fill="#b8860b">🃏</text>
      </svg>
    )
  }
  const isAce = card.suit === 'spades' && card.rank === 'A'
  return (
    <div className={isAce ? 'pyl-ace-wrap' : undefined} title={isAce ? 'Ás de Espadas — dobra a soma da rodada' : undefined}>
      <PlayingCard card={{ suit: card.suit!, rank: card.rank! }} width={width} />
    </div>
  )
}

function statusLabel(status: PushYourLuckDrawPlayer['status']): string {
  switch (status) {
    case 'stood': return 'Parou'
    case 'busted': return 'Estourou'
    case 'active': return 'Jogando'
    default: return 'Aguardando'
  }
}

export function PushYourLuckDrawTable({
  myId, roomName, config, players, tableState, isStarted, myTurn, turnDeadline, lastDraw, lastStop,
  roundEnd, matchEnd, rematch, onLeave, onStartGame, onDraw, onStop, onRematchVote,
}: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const countdown = turnDeadline !== null ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null

  const me = players.find((p) => p.id === myId)
  const others = players.filter((p) => p.id !== myId)

  const lastEvent = !lastDraw && !lastStop ? null
    : (lastStop && (!lastDraw || lastStop.key > lastDraw.key)) ? lastStop : lastDraw
  const logLine = describeEvent(lastEvent, players, myId)

  return (
    <div className="truco-table">
      <div className="truco-topbar">
        <div>
          <strong>{roomName}</strong>
          <span className="hint"> · até {config.maxPlayers} jogadores · alvo {config.targetScore} pts · {config.deckMode === 'fresh' ? 'baralho fresco' : 'baralho persistente'}</span>
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
              return (
                <div key={p.id} className={`truco-player-badge pyl-player-badge${active ? ' active-turn' : ''}${p.status === 'busted' ? ' pyl-busted' : ''}`}>
                  <span className="seat-name">{p.name} — {statusLabel(p.status)}</span>
                  <span className="hint">Total {p.totalScore}{p.status !== 'active' && ` · Rodada ${p.roundScore}`}</span>
                  {p.savesHeld > 0 && <span className="hint">🃏×{p.savesHeld}</span>}
                  {p.roundHand.length > 0 && (
                    <div className="pyl-mini-hand">
                      {p.roundHand.map((c, i) => <PushYourLuckDrawCardFace key={`${c.id}-${i}`} card={c} width={30} />)}
                    </div>
                  )}
                  {active && countdown !== null && <span className="truco-countdown">{countdown}s</span>}
                </div>
              )
            })}
          </div>

          <div className="gf-stock">
            <span className="hint">Monte ({tableState.monteCount})</span>
            <PlayingCard faceDown width={44} />
          </div>

          {logLine && <div className="gf-log">{logLine}</div>}

          <div className={`truco-my-area${myTurn ? ' active-turn' : ''}`}>
            {me && (
              <div className="hint" style={{ textAlign: 'center' }}>
                Total {me.totalScore}{me.savesHeld > 0 && ` · 🃏×${me.savesHeld}`}
              </div>
            )}

            <div className="truco-hand">
              {me?.roundHand.map((c, i) => (
                <div key={`${c.id}-${i}`} className="truco-hand-card">
                  <PushYourLuckDrawCardFace card={c} width={56} />
                </div>
              ))}
              {me && me.roundHand.length === 0 && <span className="hint">Sem cartas nesta rodada ainda.</span>}
            </div>

            <div className="truco-my-name">
              {me?.name} — {me ? statusLabel(me.status) : ''}
              {myTurn && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
            </div>

            {myTurn && (
              <div className="actions">
                <button type="button" className="btn-cancel" onClick={onStop}>Parar</button>
                <button type="button" className="btn-confirm" onClick={onDraw}>Pedir carta</button>
              </div>
            )}
          </div>
        </>
      )}

      {roundEnd && !matchEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Fim de rodada</h2>
            <div className="canastra-breakdown">
              {roundEnd.players.map((p) => (
                <div key={p.id} className="canastra-breakdown-team">
                  <strong>{p.id === myId ? 'Você' : p.name}</strong>
                  <div className="auto-row"><span>{statusLabel(p.status)}</span><span>+{p.roundScore}</span></div>
                  <div className="auto-row"><span>Total</span><span>{p.totalScore}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {matchEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>
              {matchEnd.winnerIds.length > 1 ? 'Empate!'
                : matchEnd.winnerIds[0] === myId ? '🏆 Você venceu!' : `${matchEnd.players.find((p) => p.id === matchEnd.winnerIds[0])?.name ?? 'Alguém'} venceu!`}
            </h2>
            <div className="canastra-breakdown">
              {matchEnd.players.map((p) => (
                <div key={p.id} className="canastra-breakdown-team">
                  <strong>{p.id === myId ? 'Você' : p.name}</strong>
                  <div className="auto-row"><span>Total</span><span>{p.totalScore}</span></div>
                  {matchEnd.matchWins[p.id] !== undefined && (
                    <div className="auto-row"><span>Vitórias</span><span>{matchEnd.matchWins[p.id]}</span></div>
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

      <PushYourLuckDrawGuide />
    </div>
  )
}

function describeEvent(
  ev: PushYourLuckDrawDrawEvent | PushYourLuckDrawStopEvent | null,
  players: PushYourLuckDrawPlayer[],
  myId: string,
): string | null {
  if (!ev) return null
  const name = ev.playerId === myId ? 'Você' : (players.find((p) => p.id === ev.playerId)?.name ?? '?')
  if ('roundScore' in ev) return `${name} parou com ${ev.roundScore} pontos.`
  switch (ev.outcome) {
    case 'drew':   return `${name} comprou ${ev.card?.rank}.`
    case 'joker':  return `${name} comprou um Coringa — save guardado!`
    case 'saved':  return `${name} ia estourar em ${ev.card?.rank}, mas usou um Coringa pra se salvar!`
    case 'busted': return `${name} estourou em ${ev.card?.rank}!`
    case 'forced_stop': return `${name} parou automaticamente — o baralho esgotou.`
    default: return null
  }
}
