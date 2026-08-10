import { useState, useEffect } from 'react'
import type {
  PushYourLuckDrawCard, PushYourLuckDrawPlayer, PushYourLuckDrawRoomConfig, PushYourLuckDrawTableState, Rank,
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

// ─── Live hand-value preview (front-end only) ──────────────────────────────
// Mirrors server/src/pushyourluckdraw/deck.ts's rankPoints/isAceOfSpades —
// purely a display computation off data that's already public (roundHand).
// The server itself only ever locks roundScore in at stop/bust time; while a
// player is still 'active' it stays 0 there, on purpose. See .claude/PushYourLuckDraw.md.
function rankPoints(rank: Rank): number {
  switch (rank) {
    case 'J': return 11
    case 'Q': return 12
    case 'K': return 13
    case 'A': return 0
    default: return Number(rank)
  }
}
function isAceOfSpades(card: PushYourLuckDrawCard): boolean {
  return !card.isJoker && card.suit === 'spades' && card.rank === 'A'
}
function liveHandValue(hand: PushYourLuckDrawCard[]): number {
  const hasAce = hand.some(isAceOfSpades)
  const sum = hand.filter((c) => !isAceOfSpades(c)).reduce((s, c) => s + rankPoints(c.rank!), 0)
  return hasAce ? sum * 2 : sum
}
/** What to show as "this round" for a player: the live front-end preview
 *  while they're still deciding, the server-locked value once they aren't. */
function displayRoundValue(p: PushYourLuckDrawPlayer): number {
  return p.status === 'active' ? liveHandValue(p.roundHand) : p.roundScore
}

/** Synthesizes placeholder Joker cards to render a player's banked saves as
 *  actual card faces (next to their round hand) instead of a "🃏×N" count —
 *  the server only sends a count (savesHeld), never the card objects themselves. */
function savedJokerCards(count: number): PushYourLuckDrawCard[] {
  return Array.from({ length: count }, (_, i) => ({ id: `save-${i}`, suit: null, rank: null, isJoker: true }))
}

function PushYourLuckDrawCardFace({ card, width = 44, highlight = false }: { card: PushYourLuckDrawCard; width?: number; highlight?: boolean }) {
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
  const isAce = isAceOfSpades(card)
  const wrapClass = [isAce && 'pyl-ace-wrap', highlight && 'pyl-bust-highlight'].filter(Boolean).join(' ') || undefined
  return (
    <div className={wrapClass} title={isAce ? 'Ás de Espadas — dobra a soma da rodada' : undefined}>
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

/** Vertical ranking, top to bottom — just the banked (totalScore) points,
 *  never the live in-round preview. Sits beside the table, near the monte. */
function Scoreboard({ players, myId }: { players: PushYourLuckDrawPlayer[]; myId: string }) {
  if (players.length === 0) return null
  const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore)
  const topScore = ranked[0]!.totalScore
  return (
    <div className="pyl-scoreboard">
      <div className="pyl-scoreboard-title">🏁 Placar</div>
      {ranked.map((p) => (
        <div key={p.id} className={`pyl-scoreboard-entry${p.totalScore === topScore && topScore > 0 ? ' leader' : ''}`}>
          <span className="pyl-scoreboard-name">
            {p.totalScore === topScore && topScore > 0 ? '🏆 ' : ''}{p.id === myId ? 'Você' : p.name}
          </span>
          <span className="pyl-scoreboard-score">{p.totalScore}</span>
        </div>
      ))}
    </div>
  )
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
  const bustEvent = lastEvent && lastDraw && lastEvent === lastDraw && lastDraw.outcome === 'busted' && lastDraw.bustedHand ? lastDraw : null
  const logLine = bustEvent ? null : describeEvent(lastEvent, players, myId)

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
        <div className="pyl-table-layout">
          <div className="pyl-table-main">
            <div className="truco-others">
              {others.map((p) => {
                const active = p.id === tableState.turnPlayerId
                return (
                  <div key={p.id} className={`truco-player-badge pyl-player-badge${active ? ' active-turn' : ''}${p.status === 'busted' ? ' pyl-busted' : ''}`}>
                    <span className="seat-name">{p.name} — {statusLabel(p.status)}</span>
                    <span className="hint">Total {p.totalScore} · Rodada {displayRoundValue(p)}</span>
                    {p.savesHeld > 0 && <span className="hint">🃏×{p.savesHeld}</span>}
                    {(p.roundHand.length > 0 || p.savesHeld > 0) && (
                      <div className="pyl-mini-hand">
                        {p.roundHand.map((c, i) => <PushYourLuckDrawCardFace key={`${c.id}-${i}`} card={c} width={30} />)}
                        {p.savesHeld > 0 && (
                          <div className="pyl-saves-group">
                            {savedJokerCards(p.savesHeld).map((c) => <PushYourLuckDrawCardFace key={c.id} card={c} width={30} />)}
                          </div>
                        )}
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

            {bustEvent ? (
              <div className="pyl-bust-panel">
                <div className="pyl-bust-title">
                  💥 {bustEvent.playerId === myId ? 'Você' : (players.find((p) => p.id === bustEvent.playerId)?.name ?? '?')} estourou — já tinha um {bustEvent.card?.rank} na mão:
                </div>
                <div className="pyl-bust-cards">
                  {bustEvent.bustedHand!.map((c, i) => (
                    <PushYourLuckDrawCardFace key={`${c.id}-${i}`} card={c} width={44} highlight={c.rank === bustEvent.card?.rank} />
                  ))}
                  {bustEvent.card && <PushYourLuckDrawCardFace card={bustEvent.card} width={44} highlight />}
                </div>
              </div>
            ) : (
              logLine && <div className="gf-log">{logLine}</div>
            )}

            <div className={`truco-my-area${myTurn ? ' active-turn' : ''}`}>
              {me && (
                <div className="hint" style={{ textAlign: 'center' }}>
                  Total {me.totalScore} · Rodada {displayRoundValue(me)}{me.savesHeld > 0 && ` · 🃏×${me.savesHeld}`}
                </div>
              )}

              <div className="truco-hand">
                {me?.roundHand.map((c, i) => (
                  <div key={`${c.id}-${i}`} className="truco-hand-card">
                    <PushYourLuckDrawCardFace card={c} width={56} />
                  </div>
                ))}
                {me && me.savesHeld > 0 && (
                  <div className="pyl-saves-group">
                    {savedJokerCards(me.savesHeld).map((c) => (
                      <div key={c.id} className="truco-hand-card">
                        <PushYourLuckDrawCardFace card={c} width={56} />
                      </div>
                    ))}
                  </div>
                )}
                {me && me.status === 'waiting' && <span className="hint">Você entrou no meio da partida — participa a partir da próxima rodada.</span>}
                {me && me.status !== 'waiting' && me.roundHand.length === 0 && me.savesHeld === 0 && <span className="hint">Sem cartas nesta rodada ainda.</span>}
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
          </div>

          <Scoreboard players={players} myId={myId} />
        </div>
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
              {matchEnd.winnerIds.length > 1 ? '🤝 Empate!'
                : matchEnd.winnerIds[0] === myId ? '🏆 Você venceu!' : `🏆 ${matchEnd.players.find((p) => p.id === matchEnd.winnerIds[0])?.name ?? 'Alguém'} venceu!`}
            </h2>
            <div className="canastra-breakdown">
              {[...matchEnd.players].sort((a, b) => b.totalScore - a.totalScore).map((p) => (
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
