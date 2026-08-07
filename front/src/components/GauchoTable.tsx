import { useState, useEffect } from 'react'
import type {
  Card, GauchoPlayer, GauchoRoomConfig, GauchoTableState,
  GauchoCallLevel, GauchoEnvidoCallLevel, GauchoFlorCallLevel,
} from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { GauchoGuide } from './GauchoGuide'
import type {
  GauchoHandEnd, GauchoMatchEnd, GauchoMaoDeOnzePrompt, GauchoRematchStatus,
  GauchoCallEvent, GauchoResultEvent,
} from '../hooks/useGauchoGame'

const TRUCO_LEVELS: GauchoCallLevel[] = [1, 2, 3, 4]
const TRUCO_LABEL: Record<number, string> = { 2: 'TRUCO!', 3: 'RETRUCO!', 4: 'VALE QUATRO!' }
const ENVIDO_LEVELS: GauchoEnvidoCallLevel[] = ['envido', 'real_envido', 'falta_envido']
const ENVIDO_LABEL: Record<GauchoEnvidoCallLevel, string> = { envido: 'ENVIDO!', real_envido: 'REAL ENVIDO!', falta_envido: 'FALTA ENVIDO!' }
const FLOR_LEVELS: GauchoFlorCallLevel[] = ['flor', 'contra_flor', 'contra_flor_e_o_resto']
const FLOR_LABEL: Record<GauchoFlorCallLevel, string> = { flor: 'FLOR!', contra_flor: 'CONTRA-FLOR!', contra_flor_e_o_resto: 'CONTRA-FLOR E O RESTO!' }
const HAND_REASON_LABEL: Record<GauchoHandEnd['reason'], string> = {
  vazas: 'venceu as vazas', corri: 'o outro time correu', mao_de_onze_run: 'correu na mão de 11',
}
// Strongest → weakest — see .claude/TrucoGaucho.md → "Manilhas".
const MANILHA_LABEL: Record<string, string> = {
  'spades-A': 'Espadilha', 'clubs-A': 'Basto', 'spades-7': '7 de Espadas', 'diamonds-7': '7 de Ouros',
}
const MANILHA_ORDER = ['spades-A', 'clubs-A', 'spades-7', 'diamonds-7']

interface Props {
  myId: string
  roomName: string
  config: GauchoRoomConfig
  players: GauchoPlayer[]
  tableState: GauchoTableState | null
  myCards: Card[]
  dealtCards: Card[]
  isStarted: boolean
  turnDeadline: number | null
  maoDeOnzePrompt: GauchoMaoDeOnzePrompt | null
  handEnd: GauchoHandEnd | null
  matchEnd: GauchoMatchEnd | null
  rematch: GauchoRematchStatus | null
  lastCall: GauchoCallEvent | null
  lastResult: GauchoResultEvent | null
  onLeave: () => void
  onPlayCard: (card: Card) => void
  onCallTruco: () => void
  onRespondTruco: (accept: boolean) => void
  onCallEnvido: () => void
  onRespondEnvido: (accept: boolean) => void
  onCallFlor: () => void
  onRespondFlor: (accept: boolean) => void
  onMaoDeOnzeDecision: (accept: boolean) => void
  onRematchVote: (accept: boolean) => void
}

export function GauchoTable({
  myId, roomName, config, players, tableState, myCards, dealtCards, isStarted, turnDeadline,
  maoDeOnzePrompt, handEnd, matchEnd, rematch, lastResult,
  onLeave, onPlayCard, onCallTruco, onRespondTruco, onCallEnvido, onRespondEnvido,
  onCallFlor, onRespondFlor, onMaoDeOnzeDecision, onRematchVote,
}: Props) {
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

  const anyResponsePending = !!tableState && (
    tableState.awaitingResponseFromTeam !== null
    || tableState.envido.awaitingResponseFromTeam !== null
    || tableState.flor.awaitingResponseFromTeam !== null
  )
  const canPlay = !!tableState && tableState.phase === 'playing' && !anyResponsePending && me?.seatIndex === tableState.currentSeat

  // I hold Flor when my *original* 3-card deal (not the shrinking `myCards`
  // as I play them) is all one suit — computed locally so this stays correct
  // even after I've already played a card this vaza.
  const iHaveFlor = dealtCards.length === 3 && dealtCards[0]!.suit === dealtCards[1]!.suit && dealtCards[1]!.suit === dealtCards[2]!.suit

  const trucoBase = tableState ? (tableState.pendingStake ?? tableState.stake) : 1
  const trucoNext = TRUCO_LEVELS[TRUCO_LEVELS.indexOf(trucoBase) + 1]
  const envidoNext = tableState
    ? ENVIDO_LEVELS[tableState.envido.pendingCall ? ENVIDO_LEVELS.indexOf(tableState.envido.pendingCall) + 1 : 0]
    : undefined
  const florNext = tableState
    ? FLOR_LEVELS[tableState.flor.pendingCall ? FLOR_LEVELS.indexOf(tableState.flor.pendingCall) + 1 : 0]
    : undefined

  // Everything below is derived straight from `tableState` (broadcast to
  // everyone on every relevant message) rather than from a narrowly-targeted
  // "your turn" push — otherwise a player who isn't the very next one to play
  // a card (e.g. the team that just responded to Envido) never learns the
  // negotiation closed and is left looking at a stale prompt.
  const respondingTruco = !!tableState && tableState.awaitingResponseFromTeam !== null && myTeam === tableState.awaitingResponseFromTeam
  const respondingEnvido = !!tableState && tableState.envido.awaitingResponseFromTeam !== null && myTeam === tableState.envido.awaitingResponseFromTeam
  const respondingFlor = !!tableState && tableState.flor.awaitingResponseFromTeam !== null && myTeam === tableState.flor.awaitingResponseFromTeam && iHaveFlor

  const canRespondTruco = respondingTruco
  const canRespondEnvido = respondingEnvido
  const canRespondFlor = respondingFlor

  const canOpenTruco = canPlay && tableState !== null && myTeam !== tableState.stakeCalledByTeam && tableState.stake < 4
  const canOpenEnvido = canPlay && tableState !== null && tableState.envido.status === 'available' && myTeam !== tableState.envido.calledByTeam
  const canOpenFlor = canPlay && tableState !== null && tableState.flor.status === 'available' && iHaveFlor && myTeam !== tableState.flor.calledByTeam

  const canCallTruco = (canOpenTruco || (respondingTruco && trucoNext !== undefined))
  const canCallEnvido = (canOpenEnvido || (respondingEnvido && envidoNext !== undefined))
  const canCallFlor = (canOpenFlor || (respondingFlor && florNext !== undefined))

  function manilhaKey(card: Card) { return `${card.suit}-${card.rank}` }
  const manilhaOrder = tableState
    ? [...tableState.manilhaCards].sort((a, b) => MANILHA_ORDER.indexOf(manilhaKey(a)) - MANILHA_ORDER.indexOf(manilhaKey(b)))
    : []

  function resultText(r: GauchoResultEvent): string {
    const kindLabel = r.kind === 'envido' ? 'Envido' : 'Flor'
    const won = r.winnerTeam === myTeam
    if (r.reason === 'corri') return `${kindLabel}: ${won ? 'vocês ganharam' : 'o outro time ganhou'} ${r.points} ponto(s) — o outro time correu.`
    const valuesText = Object.entries(r.values).map(([pid, v]) => `${players.find((p) => p.id === pid)?.name ?? pid}: ${v}`).join(' · ')
    const uncontested = r.reason === 'uncontested' ? ' (sem resposta)' : ''
    return `${kindLabel}: ${won ? 'vocês ganharam' : 'o outro time ganhou'} ${r.points} ponto(s)${uncontested} — ${valuesText}`
  }

  return (
    <div className="truco-table">
      <div className="truco-topbar">
        <div>
          <strong>{roomName}</strong>
          <span className="hint"> · Truco Gaúcho · {config.mode === '1x1' ? '1x1' : '2x2 (duplas)'}</span>
        </div>
        <button type="button" className="btn-cancel-small" onClick={onLeave}>Sair da mesa</button>
      </div>

      {!isStarted && <div className="empty-rooms">Aguardando jogadores...</div>}

      {isStarted && tableState && (
        <>
          <div className="truco-score-bar">
            <span className="truco-score">Nós {tableState.scores[myTeam]} × {tableState.scores[otherTeam]} Eles</span>
            <span className="truco-stake">Valendo {tableState.stake}</span>
          </div>

          <div className="truco-manilha-info">
            <div className="truco-manilha-order">
              <span className="hint">Manilhas fixas (forte → fraca):</span>
              <div className="truco-manilha-cards">
                {manilhaOrder.map((card, i) => (
                  <div key={i} className="truco-manilha-card">
                    <PlayingCard card={card} width={28} />
                    <span className="hint">{MANILHA_LABEL[manilhaKey(card)]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="truco-others">
            {others.map((p) => {
              const active = p.seatIndex === tableState.currentSeat
                || tableState.awaitingResponseFromTeam === p.teamIndex
                || tableState.envido.awaitingResponseFromTeam === p.teamIndex
                || tableState.flor.awaitingResponseFromTeam === p.teamIndex
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

          <div className={`truco-my-area${canPlay || anyResponsePending ? ' active-turn' : ''}`}>
            <div className="truco-hand">
              {myCards.map((c, i) => (
                <button type="button" key={i} className="truco-hand-card" disabled={!canPlay} onClick={() => onPlayCard(c)}>
                  <PlayingCard card={c} width={56} />
                </button>
              ))}
            </div>
            <div className="truco-my-name">
              {me?.seatIndex === tableState.dealerSeat && '🎴 '}{me?.name}
              {(canPlay || anyResponsePending) && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
            </div>

            <div className="action-bar truco-action-bar">
              {canRespondTruco && (
                <>
                  <span className="hint">Truco chamado! Você aceita?</span>
                  <div className="truco-respond-row">
                    <button type="button" className="btn-fold" onClick={() => onRespondTruco(false)}>Não quero</button>
                    <button type="button" className="btn-call" onClick={() => onRespondTruco(true)}>Quero</button>
                    {canCallTruco && trucoNext && <button type="button" className="btn-raise" onClick={onCallTruco}>{TRUCO_LABEL[trucoNext]}</button>}
                  </div>
                </>
              )}
              {canRespondEnvido && (
                <>
                  <span className="hint">Envido chamado! Você aceita?</span>
                  <div className="truco-respond-row">
                    <button type="button" className="btn-fold" onClick={() => onRespondEnvido(false)}>Não quero</button>
                    <button type="button" className="btn-call" onClick={() => onRespondEnvido(true)}>Quero</button>
                    {canCallEnvido && envidoNext && <button type="button" className="btn-raise" onClick={onCallEnvido}>{ENVIDO_LABEL[envidoNext]}</button>}
                  </div>
                </>
              )}
              {canRespondFlor && (
                <>
                  <span className="hint">Flor chamada! Você aceita?</span>
                  <div className="truco-respond-row">
                    <button type="button" className="btn-fold" onClick={() => onRespondFlor(false)}>Não quero</button>
                    <button type="button" className="btn-call" onClick={() => onRespondFlor(true)}>Quero</button>
                    {canCallFlor && florNext && <button type="button" className="btn-raise" onClick={onCallFlor}>{FLOR_LABEL[florNext]}</button>}
                  </div>
                </>
              )}
              {!anyResponsePending && (canCallTruco || canCallEnvido || canCallFlor) && (
                <div className="truco-respond-row">
                  {canCallTruco && trucoNext && <button type="button" className="btn-raise" onClick={onCallTruco}>{TRUCO_LABEL[trucoNext]}</button>}
                  {canCallEnvido && envidoNext && <button type="button" className="btn-raise" onClick={onCallEnvido}>{ENVIDO_LABEL[envidoNext]}</button>}
                  {canCallFlor && florNext && <button type="button" className="btn-raise" onClick={onCallFlor}>{FLOR_LABEL[florNext]}</button>}
                </div>
              )}
            </div>
          </div>

          {lastResult && <div className="truco-hand-end-banner">{resultText(lastResult)}</div>}

          {handEnd && (
            <div className="truco-hand-end-banner">
              {handEnd.winnerTeam === null
                ? 'Mão empatada — ninguém pontuou.'
                : `${handEnd.winnerTeam === myTeam ? 'Seu time' : 'O outro time'} ganhou ${handEnd.points} ponto(s) — ${HAND_REASON_LABEL[handEnd.reason]}.`}
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
              <button type="button" className="btn-cancel" onClick={() => onMaoDeOnzeDecision(false)}>Correr</button>
              <button type="button" className="btn-confirm" onClick={() => onMaoDeOnzeDecision(true)}>Jogar</button>
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
              <button type="button" className="btn-cancel" onClick={() => onRematchVote(false)}>Sair</button>
              <button type="button" className="btn-confirm" onClick={() => onRematchVote(true)}>Jogar novamente</button>
            </div>
          </div>
        </div>
      )}

      <GauchoGuide />
    </div>
  )
}
