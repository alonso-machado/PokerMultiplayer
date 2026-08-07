import { useState, useEffect } from 'react'
import type { Card, BlackjackPlayer, BlackjackTableState, BlackjackHand } from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { BlackjackGuide } from './BlackjackGuide'
import type { BlackjackTurn } from '../hooks/useBlackjackGame'

interface Props {
  myId: string
  players: BlackjackPlayer[]
  tableState: BlackjackTableState | null
  isStarted: boolean
  turn: BlackjackTurn | null
  turnDeadline: number | null
  error: string | null
  onLeave: () => void
  onPlaceBet: (amount: number) => void
  onInsuranceBet: (amount: number) => void
  onHit: () => void
  onStand: () => void
  onDouble: () => void
  onSplit: () => void
}

// Client-side mirror of server/src/blackjack/deck.ts's handValue — display only.
function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let acesAs11 = 0
  for (const c of cards) {
    if (c.rank === 'A') { acesAs11++; total += 11 }
    else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K' || c.rank === '10') total += 10
    else total += Number(c.rank)
  }
  while (total > 21 && acesAs11 > 0) { total -= 10; acesAs11-- }
  return { total, soft: acesAs11 > 0 }
}

const OUTCOME_LABEL: Record<string, string> = {
  blackjack: '🂡 Blackjack! 3:2', win: '✅ Ganhou', push: '➖ Empate', lose: '❌ Perdeu',
}

function HandView({ hand, width = 52, active }: { hand: BlackjackHand; width?: number; active?: boolean }) {
  const { total, soft } = handTotal(hand.cards)
  return (
    <div className={`bj-hand${active ? ' active-turn' : ''}`}>
      <div className="bj-hand-cards">
        {hand.cards.map((c, i) => <PlayingCard key={`${c.suit}-${c.rank}-${i}`} card={c} width={width} />)}
      </div>
      <div className="bj-hand-meta">
        <span className="hint">{hand.cards.length > 0 ? `${total}${soft ? ' (soft)' : ''}` : ''}</span>
        <span className="hint">💰 {hand.bet}</span>
        {hand.isBusted && <span className="bj-badge bj-badge-lose">Estourou</span>}
        {hand.outcome && <span className={`bj-badge bj-badge-${hand.outcome === 'lose' ? 'lose' : 'win'}`}>{OUTCOME_LABEL[hand.outcome]}</span>}
      </div>
    </div>
  )
}

export function BlackjackTable({
  myId, players, tableState, isStarted, turn, turnDeadline, error,
  onLeave, onPlaceBet, onInsuranceBet, onHit, onStand, onDouble, onSplit,
}: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const countdown = turnDeadline !== null ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null

  const [betInput, setBetInput] = useState(10)
  const [betSubmitted, setBetSubmitted] = useState(false)
  const [insuranceInput, setInsuranceInput] = useState(0)
  const [insuranceSubmitted, setInsuranceSubmitted] = useState(false)

  const phase = tableState?.phase ?? 'waiting'
  // A fresh betting/insurance window always brings a new turnDeadline — reset local "already acted" flags then.
  useEffect(() => { if (phase === 'betting') setBetSubmitted(false) }, [turnDeadline, phase])
  useEffect(() => { if (phase === 'insurance') setInsuranceSubmitted(false) }, [turnDeadline, phase])
  useEffect(() => { if (error) { setBetSubmitted(false); setInsuranceSubmitted(false) } }, [error])

  const me = players.find((p) => p.id === myId)
  const others = players.filter((p) => p.id !== myId).sort((a, b) => a.seatIndex - b.seatIndex)
  const isMyTurn = turn !== null && tableState?.currentSeat === me?.seatIndex

  function submitBet() {
    const amt = Math.max(1, Math.min(betInput, me?.chips ?? 1))
    onPlaceBet(amt)
    setBetSubmitted(true)
  }
  function submitInsurance(amount: number) {
    onInsuranceBet(amount)
    setInsuranceSubmitted(true)
  }

  const dealer = tableState?.dealer
  const dealerValue = dealer && !dealer.holeHidden ? handTotal(dealer.cards) : null

  return (
    <div className="truco-table bj-table">
      <div className="truco-topbar">
        <div>
          <strong>Blackjack / 21</strong>
          <span className="hint"> · mesa de matchmaking · {players.length}/7</span>
        </div>
        <button type="button" className="btn-cancel-small" onClick={onLeave}>Sair da mesa</button>
      </div>

      {!isStarted && <div className="empty-rooms">Entrando na mesa...</div>}

      {isStarted && tableState && (
        <>
          <div className="bj-dealer-area">
            <span className="hint">Dealer</span>
            <div className="bj-hand-cards">
              {dealer!.cards.map((c, i) => <PlayingCard key={`${c.suit}-${c.rank}-${i}`} card={c} width={56} />)}
              {dealer!.holeHidden && <PlayingCard faceDown width={56} />}
            </div>
            {dealerValue && (
              <span className="hint">
                {dealerValue.total}{dealerValue.soft ? ' (soft)' : ''}
                {dealer!.isBusted && ' — estourou'}
                {dealer!.isBlackjack && ' — Blackjack!'}
              </span>
            )}
          </div>

          <div className="truco-others bj-seats">
            {others.map((p) => {
              const active = p.seatIndex === tableState.currentSeat
              return (
                <div key={p.id} className={`truco-player-badge bj-seat${active ? ' active-turn' : ''}`}>
                  <span className="seat-name">{p.name}</span>
                  <span className="hint">💰 {p.chips}</span>
                  {active && countdown !== null && <span className="truco-countdown">{countdown}s</span>}
                  <div className="bj-seat-hands">
                    {p.hands.map((h, i) => (
                      <HandView key={i} hand={h} width={34} active={active && tableState.currentHandIndex === i} />
                    ))}
                  </div>
                  {p.insuranceBet > 0 && <span className="hint">🛡️ seguro {p.insuranceBet}</span>}
                </div>
              )
            })}
          </div>

          <div className={`truco-my-area${isMyTurn ? ' active-turn' : ''}`}>
            {me && (
              <>
                <div className="bj-seat-hands bj-my-hands">
                  {me.hands.map((h, i) => (
                    <HandView key={i} hand={h} width={64} active={isMyTurn && tableState.currentHandIndex === i} />
                  ))}
                </div>
                <div className="truco-my-name">
                  {me.name} · 💰 {me.chips}
                  {isMyTurn && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
                </div>
              </>
            )}

            {error && <p className="hint bj-error">{error}</p>}

            {phase === 'betting' && (
              betSubmitted ? (
                <p className="hint">Aposta feita — aguardando os outros jogadores...</p>
              ) : (
                <div className="action-bar bj-bet-bar">
                  <input
                    type="number" min={1} max={me?.chips ?? 1} value={betInput}
                    onChange={(e) => setBetInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                  <button type="button" className="btn-raise" onClick={submitBet} disabled={!me || me.chips < 1}>Apostar</button>
                  <button type="button" className="btn-call" onClick={() => setBetInput(me?.chips ?? 1)}>Tudo</button>
                </div>
              )
            )}

            {phase === 'insurance' && me && me.hands.length > 0 && (
              insuranceSubmitted ? (
                <p className="hint">Decisão registrada — aguardando a espiada do dealer...</p>
              ) : (
                <div className="action-bar bj-bet-bar">
                  <input
                    type="number" min={0} max={Math.floor((me.hands[0]?.bet ?? 0) / 2)} value={insuranceInput}
                    onChange={(e) => setInsuranceInput(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                  <button type="button" className="btn-raise" onClick={() => submitInsurance(insuranceInput)}>Fazer seguro</button>
                  <button type="button" className="btn-fold" onClick={() => submitInsurance(0)}>Recusar</button>
                </div>
              )
            )}

            {phase === 'player_turns' && isMyTurn && turn && (
              <div className="action-bar">
                <button type="button" className="btn-call" onClick={onHit}>Pedir</button>
                <button type="button" className="btn-fold" onClick={onStand}>Parar</button>
                <button type="button" className="btn-raise" disabled={!turn.validActions.includes('double')} onClick={onDouble}>Dobrar</button>
                <button type="button" className="btn-raise" disabled={!turn.validActions.includes('split')} onClick={onSplit}>Dividir</button>
              </div>
            )}
          </div>
        </>
      )}

      <BlackjackGuide />
    </div>
  )
}
