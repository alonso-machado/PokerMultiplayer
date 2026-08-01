import { useState, useEffect } from 'react'
import type { Card, TrucoPlayer, TrucoRoomConfig, TrucoTableState } from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { TrucoGuide } from './TrucoGuide'
import type { TrucoHandEnd, TrucoMatchEnd, TrucoMaoDeOnzePrompt, TrucoRematchStatus } from '../hooks/useTrucoGame'

const CALL_LABEL: Record<number, string> = { 3: 'TRUCO!', 6: 'SEIS!', 9: 'NOVE!', 12: 'DOZE!' }
const LEVELS = [1, 3, 6, 9, 12]
const REASON_LABEL: Record<TrucoHandEnd['reason'], string> = {
  vazas: 'venceu as vazas', corri: 'o outro time correu', mao_de_onze_run: 'correu na mão de 11',
}
// Zap (paus) > Copas > Espadilha (espadas) > Ouros — same order/naming in both variants.
const SUIT_STRENGTH: Record<Card['suit'], number> = { clubs: 4, hearts: 3, spades: 2, diamonds: 1 }
const SUIT_LABEL: Record<Card['suit'], string> = { clubs: 'Zap', hearts: 'Copas', spades: 'Espadilha', diamonds: 'Ouros' }

interface Props {
  myId: string
  roomName: string
  config: TrucoRoomConfig
  players: TrucoPlayer[]
  tableState: TrucoTableState | null
  myCards: Card[]
  isStarted: boolean
  turnDeadline: number | null
  maoDeOnzePrompt: TrucoMaoDeOnzePrompt | null
  handEnd: TrucoHandEnd | null
  matchEnd: TrucoMatchEnd | null
  rematch: TrucoRematchStatus | null
  onLeave: () => void
  onPlayCard: (card: Card) => void
  onCallTruco: () => void
  onRespond: (accept: boolean) => void
  onMaoDeOnzeDecision: (accept: boolean) => void
  onRematchVote: (accept: boolean) => void
}

export function TrucoTable({
  myId, roomName, config, players, tableState, myCards, isStarted, turnDeadline,
  maoDeOnzePrompt, handEnd, matchEnd, rematch,
  onLeave, onPlayCard, onCallTruco, onRespond, onMaoDeOnzeDecision, onRematchVote,
}: Props) {
  // Ticks once/sec to re-render the countdown badge from `turnDeadline`.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const countdown = turnDeadline !== null ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null

  const me = players.find((p) => p.id === myId)
  const myTeam = me?.teamIndex ?? 0
  const otherTeam = myTeam === 0 ? 1 : 0
  const others = [...players].filter((p) => p.id !== myId).sort((a, b) => a.seatIndex - b.seatIndex)

  const canPlay = !!tableState && tableState.phase === 'playing'
    && tableState.awaitingResponseFromTeam === null && me?.seatIndex === tableState.currentSeat
  const canRespond = !!tableState && tableState.awaitingResponseFromTeam !== null
    && me?.teamIndex === tableState.awaitingResponseFromTeam
  // Next level is based on the pending call if one is up for grabs (raising a
  // pending "truco" answers with "seis" directly), otherwise the accepted stake.
  const baseStake = tableState ? (tableState.pendingStake ?? tableState.stake) : 1
  const canCallTruco = (canPlay || canRespond) && me?.teamIndex !== tableState?.stakeCalledByTeam && baseStake < 12
  const nextLevel = LEVELS[LEVELS.indexOf(baseStake) + 1]

  // Same suit-strength order and naming in both variants (Zap > Copas > Espadilha > Ouros).
  const manilhaOrder = tableState
    ? [...tableState.manilhaCards]
        .sort((a, b) => SUIT_STRENGTH[b.suit] - SUIT_STRENGTH[a.suit])
        .map((card) => ({ card, label: SUIT_LABEL[card.suit] }))
    : []

  return (
    <div className="truco-table">
      <div className="truco-topbar">
        <div>
          <strong>{roomName}</strong>
          <span className="hint"> · {config.mode === '1x1' ? '1x1' : '2x2 (duplas)'} · {config.manilhaVariant === 'vira' ? 'Vira (Paulista)' : 'Fixa (Mineiro)'}</span>
        </div>
        <button className="btn-cancel-small" onClick={onLeave}>Sair da mesa</button>
      </div>

      {!isStarted && <div className="empty-rooms">Aguardando jogadores...</div>}

      {isStarted && tableState && (
        <>
          <div className="truco-score-bar">
            <span className="truco-score">Nós {tableState.scores[myTeam]} × {tableState.scores[otherTeam]} Eles</span>
            <span className="truco-stake">Valendo {tableState.stake}</span>
          </div>

          <div className="truco-manilha-info">
            <div className="truco-manilha-vira">
              {config.manilhaVariant === 'vira' ? (
                tableState.vira ? (
                  <span title="A carta virada (vira) determina a manilha: a próxima carta da sequência, em todos os naipes, é a manilha desta mão.">
                    <span className="hint">Vira ⓘ</span> <PlayingCard card={tableState.vira} width={34} />
                  </span>
                ) : <span className="hint">Aguardando vira...</span>
              ) : (
                <span className="hint" title="Nesta variante não há vira — as manilhas são sempre as mesmas 4 cartas durante toda a partida.">Manilha fixa (Mineiro) ⓘ</span>
              )}
            </div>
            {manilhaOrder.length > 0 && (
              <div className="truco-manilha-order">
                <span className="hint">Manilhas (forte → fraca):</span>
                <div className="truco-manilha-cards">
                  {manilhaOrder.map(({ card, label }, i) => (
                    <div key={i} className="truco-manilha-card">
                      <PlayingCard card={card} width={28} />
                      <span className="hint">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="truco-others">
            {others.map((p) => {
              const active = p.seatIndex === tableState.currentSeat || tableState.awaitingResponseFromTeam === p.teamIndex
              return (
                <div key={p.id} className={`truco-player-badge team-${p.teamIndex}${active ? ' active-turn' : ''}`}>
                  <span className="seat-name">{p.seatIndex === tableState.dealerSeat && '🎴 '}{p.name}</span>
                  {p.matchWins > 0 && <span className="hint">🏅×{p.matchWins}</span>}
                  {active && countdown !== null && <span className="truco-countdown">{countdown}s</span>}
                </div>
              )
            })}
          </div>

          <div className="truco-vaza-row">
            <div className="truco-round-tracker">
              <span className="hint">Vazas</span>
              {[0, 1, 2].map((i) => {
                const winner = tableState.vazaWinners[i]
                const played = i < tableState.vazaWinners.length
                const cls = !played ? 'pending' : winner === null ? 'tie' : winner === myTeam ? 'won' : 'lost'
                return (
                  <div key={i} className={`truco-round-dot ${cls}`} title={
                    !played ? `Vaza ${i + 1}: ainda não jogada`
                      : winner === null ? `Vaza ${i + 1}: empatada`
                      : winner === myTeam ? `Vaza ${i + 1}: seu time venceu` : `Vaza ${i + 1}: o outro time venceu`
                  }>
                    {!played ? i + 1 : winner === null ? '=' : winner === myTeam ? '✓' : '✕'}
                  </div>
                )
              })}
            </div>

            <div className="truco-vaza-area">
              {tableState.vazaCardsPlayed.length === 0 && <span className="hint">Vaza {tableState.vaza} de 3</span>}
              {tableState.vazaCardsPlayed.map((vc, i) => {
                const p = players.find((pl) => pl.id === vc.playerId)
                return (
                  <div className="truco-played-card" key={i}>
                    <PlayingCard card={vc.card} width={44} />
                    <span className="hint">{p?.name}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className={`truco-my-area${canPlay || canRespond ? ' active-turn' : ''}`}>
            <div className="truco-hand">
              {myCards.map((c, i) => (
                <button key={i} className="truco-hand-card" disabled={!canPlay} onClick={() => onPlayCard(c)}>
                  <PlayingCard card={c} width={56} />
                </button>
              ))}
            </div>
            <div className="truco-my-name">
              {me?.seatIndex === tableState.dealerSeat && '🎴 '}{me?.name}
              {(canPlay || canRespond) && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
            </div>

            <div className="action-bar truco-action-bar">
              {canRespond && (
                <>
                  <span className="hint">Truco chamado! Você aceita?</span>
                  <div className="truco-respond-row">
                    <button className="btn-fold" onClick={() => onRespond(false)}>Não quero</button>
                    <button className="btn-call" onClick={() => onRespond(true)}>Quero</button>
                    {canCallTruco && nextLevel && (
                      <button className="btn-raise" onClick={onCallTruco}>{CALL_LABEL[nextLevel]}</button>
                    )}
                  </div>
                </>
              )}
              {!canRespond && canCallTruco && nextLevel && (
                <button className="btn-raise" onClick={onCallTruco}>{CALL_LABEL[nextLevel]}</button>
              )}
            </div>
          </div>

          {handEnd && (
            <div className="truco-hand-end-banner">
              {handEnd.winnerTeam === null
                ? 'Mão empatada — ninguém pontuou.'
                : `${handEnd.winnerTeam === myTeam ? 'Seu time' : 'O outro time'} ganhou ${handEnd.points} ponto(s) — ${REASON_LABEL[handEnd.reason]}.`}
            </div>
          )}
        </>
      )}

      {maoDeOnzePrompt && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{maoDeOnzePrompt.isFerro ? 'Mão de Ferro!' : 'Mão de 11!'}</h2>
            <p className="hint">
              Vocês estão com 11 pontos. Vejam as cartas do time e decidam: jogar ou correr (cede 1 ponto)?
              {countdown !== null ? ` (${countdown}s)` : ''}
            </p>
            <div className="truco-hand" style={{ margin: '0.8rem 0' }}>
              {maoDeOnzePrompt.teamCards.map((c, i) => <PlayingCard key={i} card={c} width={48} />)}
            </div>
            <div className="actions">
              <button className="btn-cancel" onClick={() => onMaoDeOnzeDecision(false)}>Correr</button>
              <button className="btn-confirm" onClick={() => onMaoDeOnzeDecision(true)}>Jogar</button>
            </div>
          </div>
        </div>
      )}

      {matchEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{matchEnd.winnerTeam === myTeam ? '🏆 Vocês venceram a partida!' : 'A outra dupla venceu a partida.'}</h2>
            <p className="hint">Placar final: {matchEnd.scores[0]} × {matchEnd.scores[1]}</p>
            <div className="truco-medal-tally">
              {players.map((p) => (
                <div key={p.id} className="auto-row">
                  <span>{p.name}{p.id === myId ? ' (você)' : ''}</span>
                  <strong>🏅×{matchEnd.matchWins[p.id] ?? 0}</strong>
                </div>
              ))}
            </div>
            {rematch && <p className="hint">Aguardando: {rematch.pending.length} jogador(es)...</p>}
            <div className="actions">
              <button className="btn-cancel" onClick={() => onRematchVote(false)}>Sair</button>
              <button className="btn-confirm" onClick={() => onRematchVote(true)}>Jogar novamente</button>
            </div>
          </div>
        </div>
      )}

      <TrucoGuide />
    </div>
  )
}
