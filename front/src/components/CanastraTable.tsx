import { useState, useEffect } from 'react'
import type {
  CanastraCard, CanastraMeld, CanastraMeldPlan, CanastraPlayer, CanastraRoomConfig, CanastraTableState,
} from '../../../shared/types'
import { PlayingCard } from './PlayingCard'
import { CanastraGuide } from './CanastraGuide'
import type { CanastraRoundEnd, CanastraRematchStatus } from '../hooks/useCanastraGame'

interface Props {
  myId: string
  roomName: string
  config: CanastraRoomConfig
  players: CanastraPlayer[]
  tableState: CanastraTableState | null
  myCards: CanastraCard[]
  isStarted: boolean
  turnDeadline: number | null
  roundEnd: CanastraRoundEnd | null
  rematch: CanastraRematchStatus | null
  onLeave: () => void
  onDrawStock: () => void
  onTakeDiscard: (plan: CanastraMeldPlan) => void
  onLayMeld: (cardIds: string[]) => void
  onAddToMeld: (meldId: string, cardIds: string[]) => void
  onDiscard: (cardId: string) => void
  onRematchVote: (accept: boolean) => void
}

function CanastraCardFace({ card, width = 52 }: { card: CanastraCard; width?: number }) {
  if (card.isJoker) {
    const height = Math.round(width * 1.4)
    return (
      <svg width={width} height={height} viewBox="0 0 52 74" xmlns="http://www.w3.org/2000/svg">
        <rect width="52" height="74" rx="5" fill="#fff8e1" stroke="#e0a800" strokeWidth="1.5" />
        <text x="26" y="30" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#b8860b">CORINGA</text>
        <text x="26" y="55" textAnchor="middle" fontSize="22" fill="#b8860b">🃏</text>
      </svg>
    )
  }
  return <PlayingCard card={{ suit: card.suit!, rank: card.rank! }} width={width} />
}

export function CanastraTable({
  myId, roomName, config, players, tableState, myCards, isStarted, turnDeadline, roundEnd, rematch,
  onLeave, onDrawStock, onTakeDiscard, onLayMeld, onAddToMeld, onDiscard, onRematchVote,
}: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const countdown = turnDeadline !== null ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null)

  // Reset selection whenever the turn/round moves on.
  useEffect(() => { setSelected(new Set()); setSelectedMeldId(null) }, [tableState?.currentSeat, tableState?.phase])

  const me = players.find((p) => p.id === myId)
  const myTeam = me?.teamIndex ?? 0
  const otherTeam = myTeam === 0 ? 1 : 0
  const others = [...players].filter((p) => p.id !== myId).sort((a, b) => a.seatIndex - b.seatIndex)

  const isMyTurn = !!tableState && tableState.phase === 'playing' && me?.seatIndex === tableState.currentSeat
  const canDraw = isMyTurn && tableState!.turnStage === 'draw' && tableState!.stockCount > 0
  const canTakeDiscardPile = isMyTurn && tableState!.turnStage === 'draw' && tableState!.discardPile.length > 0
  const canAct = isMyTurn && (tableState!.turnStage === 'act' || tableState!.stockCount === 0)

  const canFormNew = canAct && selected.size >= 3 && !selectedMeldId
  const canAppend = canAct && selected.size >= 1 && !!selectedMeldId
  const canDiscardSelected = canAct && selected.size === 1
  const canTakeNew = canTakeDiscardPile && !selectedMeldId && selected.size >= 2
  const canTakeAppend = canTakeDiscardPile && !!selectedMeldId && selected.size === 0
  const canTakeAction = canTakeNew || canTakeAppend

  function toggleCard(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleMeld(meld: CanastraMeld) {
    if (meld.ownerTeam !== myTeam) return
    setSelectedMeldId((prev) => (prev === meld.id ? null : meld.id))
  }

  function handleTakeDiscard() {
    if (!tableState) return
    const top = tableState.discardPile[tableState.discardPile.length - 1]
    if (!top) return
    if (selectedMeldId) onTakeDiscard({ kind: 'append', meldId: selectedMeldId, cardId: top.id })
    else onTakeDiscard({ kind: 'new', cardIds: [...selected, top.id] })
    setSelected(new Set()); setSelectedMeldId(null)
  }
  function handleLayMeld() { onLayMeld([...selected]); setSelected(new Set()) }
  function handleAddToMeld() { if (selectedMeldId) onAddToMeld(selectedMeldId, [...selected]); setSelected(new Set()); setSelectedMeldId(null) }
  function handleDiscard() { const [id] = [...selected]; if (id) onDiscard(id); setSelected(new Set()) }

  function MeldGroup({ meld, selectable }: { meld: CanastraMeld; selectable: boolean }) {
    const canastraClass = meld.isCanastra ? (meld.isClean ? ' canastra-clean' : ' canastra-dirty') : ''
    return (
      <button
        type="button"
        className={`canastra-meld${canastraClass}${selectedMeldId === meld.id ? ' selected' : ''}`}
        disabled={!selectable}
        onClick={() => toggleMeld(meld)}
      >
        {meld.isCanastra && <span className="canastra-meld-badge">{meld.isClean ? 'CANASTRA LIMPA' : 'CANASTRA SUJA'}</span>}
        <div className="canastra-meld-cards">
          {meld.cards.map((c) => <CanastraCardFace key={c.id} card={c} width={34} />)}
        </div>
      </button>
    )
  }

  function TeamPanel({ team, label }: { team: 0 | 1; label: string }) {
    const t = tableState!.teams[team]
    return (
      <div className={`canastra-team-panel team-${team}`}>
        <div className="canastra-team-header">
          <strong>{label}</strong>
          <span className="hint">🂠 Morto {t.mortoTaken ? 'pego' : `(${t.mortoCount})`}</span>
        </div>
        <div className="canastra-melds">
          {t.melds.length === 0 && <span className="hint">Nenhum jogo baixado</span>}
          {t.melds.map((m) => <MeldGroup key={m.id} meld={m} selectable={canAct && team === myTeam} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="truco-table canastra-table">
      <div className="truco-topbar">
        <div>
          <strong>{roomName}</strong>
          <span className="hint"> · {config.mode === '1x1' ? '1x1' : '2x2 (duplas)'} · Canastra / Buraco</span>
        </div>
        <button type="button" className="btn-cancel-small" onClick={onLeave}>Sair da mesa</button>
      </div>

      {!isStarted && <div className="empty-rooms">Aguardando jogadores...</div>}

      {isStarted && tableState && (
        <>
          {tableState.scores && (
            <div className="truco-score-bar">
              <span className="truco-score">Nós {tableState.scores[myTeam]} × {tableState.scores[otherTeam]} Eles</span>
            </div>
          )}

          <div className="truco-others">
            {others.map((p) => {
              const active = p.seatIndex === tableState.currentSeat
              return (
                <div key={p.id} className={`truco-player-badge team-${p.teamIndex}${active ? ' active-turn' : ''}`}>
                  <span className="seat-name">{p.name}</span>
                  <span className="hint">🂡×{p.handCount}</span>
                  {p.matchWins > 0 && <span className="hint">🏅×{p.matchWins}</span>}
                  {active && countdown !== null && <span className="truco-countdown">{countdown}s</span>}
                </div>
              )
            })}
          </div>

          <div className="canastra-teams">
            <TeamPanel team={myTeam} label="Seu time" />
            <TeamPanel team={otherTeam} label="Time adversário" />
          </div>

          <div className="canastra-piles">
            <div className="canastra-pile">
              <span className="hint">Monte ({tableState.stockCount})</span>
              <button type="button" className="canastra-stock" disabled={!canDraw} onClick={onDrawStock}>
                <PlayingCard faceDown width={44} />
              </button>
            </div>
            <div className="canastra-pile">
              <span className="hint">Lixo ({tableState.discardPile.length})</span>
              {tableState.discardPile.length > 0
                ? <CanastraCardFace card={tableState.discardPile[tableState.discardPile.length - 1]!} width={44} />
                : <span className="hint">vazio</span>}
            </div>
          </div>

          <div className={`truco-my-area${canAct || canDraw ? ' active-turn' : ''}`}>
            <div className="truco-hand">
              {myCards.map((c) => (
                <button type="button"
                  key={c.id}
                  className={`truco-hand-card${selected.has(c.id) ? ' selected' : ''}`}
                  onClick={() => toggleCard(c.id)}
                >
                  <CanastraCardFace card={c} width={56} />
                </button>
              ))}
            </div>
            <div className="truco-my-name">
              {me?.name}
              {(canAct || canDraw) && countdown !== null && <span className="truco-countdown"> {countdown}s</span>}
            </div>

            <div className="action-bar canastra-action-bar">
              <button type="button" className="btn-call" disabled={!canDraw} onClick={onDrawStock}>Comprar monte</button>
              <button type="button" className="btn-call" disabled={!canTakeAction} onClick={handleTakeDiscard}>Comprar lixo</button>
              <button type="button" className="btn-raise" disabled={!canFormNew} onClick={handleLayMeld}>Formar jogo</button>
              <button type="button" className="btn-raise" disabled={!canAppend} onClick={handleAddToMeld}>Acrescentar</button>
              <button type="button" className="btn-fold" disabled={!canDiscardSelected} onClick={handleDiscard}>Descartar</button>
            </div>
            <span className="hint">
              {selectedMeldId
                ? 'Jogo selecionado — escolha cartas da mão pra acrescentar, ou compre o lixo direto.'
                : 'Selecione 3+ cartas pra formar um jogo, ou 1 carta pra descartar.'}
            </span>
          </div>
        </>
      )}

      {roundEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>
              {roundEnd.winnerTeam === null ? 'Empate!'
                : roundEnd.winnerTeam === myTeam ? '🏆 Seu time venceu!' : 'O outro time venceu.'}
            </h2>
            <p className="hint">Placar final: {roundEnd.scores[0]} × {roundEnd.scores[1]}</p>
            <div className="canastra-breakdown">
              {([0, 1] as const).map((t) => (
                <div key={t} className="canastra-breakdown-team">
                  <strong>{t === myTeam ? 'Seu time' : 'Time adversário'}</strong>
                  <div className="auto-row"><span>Jogos</span><span>{roundEnd.breakdown[t].meldPoints}</span></div>
                  <div className="auto-row"><span>Cartas na mão</span><span>{roundEnd.breakdown[t].handPenalty}</span></div>
                  <div className="auto-row"><span>Morto</span><span>{roundEnd.breakdown[t].mortoPenalty}</span></div>
                  <div className="auto-row"><span>Batida</span><span>{roundEnd.breakdown[t].battingBonus}</span></div>
                  <div className="auto-row"><strong>Total</strong><strong>{roundEnd.breakdown[t].total}</strong></div>
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

      <CanastraGuide />
    </div>
  )
}
