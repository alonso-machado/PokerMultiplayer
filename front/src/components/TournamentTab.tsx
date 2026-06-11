import { useState, useEffect } from 'react'
import type { TournamentInfo, TournamentPlayer } from '../../../shared/types'

interface Props {
  tournament: TournamentInfo | null
  myToken: string | null
  ranking: TournamentPlayer[]
  eliminated: { rank: number; total: number } | null
  winnerName: string | null
  onRegister: () => void
  onUnregister: () => void
  onDismissElimination: () => void
}

export function TournamentTab({ tournament, myToken, ranking, eliminated, winnerName, onRegister, onUnregister, onDismissElimination }: Props) {
  if (!tournament) {
    return (
      <div className="tournament-tab">
        <div className="no-tournament">
          <p>Nenhum torneio agendado no momento.</p>
          <p className="hint">Verifique mais tarde ou aguarde o anúncio.</p>
        </div>
      </div>
    )
  }

  const isRegistered = !!myToken
  const canRegister = tournament.status === 'registering' && !isRegistered
  const isRunning = tournament.status === 'running' || tournament.status === 'final_table'

  return (
    <div className="tournament-tab">
      {eliminated && (
        <div className="elim-banner">
          <span className="elim-rank">Você ficou em {eliminated.rank}º de {eliminated.total}</span>
          {winnerName && <span className="elim-winner">🏆 Vencedor: {winnerName}</span>}
          <button className="btn-dismiss" onClick={onDismissElimination}>OK</button>
        </div>
      )}

      <div className="tournament-card-main">
        <div className="tc-header">
          <span className="tc-name">{tournament.name}</span>
          <TournamentStatusBadge status={tournament.status} />
        </div>

        <div className="tc-details">
          <div className="tc-detail-row">
            <span>Fichas iniciais</span>
            <strong>{tournament.startingChips.toLocaleString()}</strong>
          </div>
          <div className="tc-detail-row">
            <span>Blinds</span>
            <strong>{tournament.config.smallBlind}/{tournament.config.bigBlind}{tournament.config.ante > 0 ? ` · Ante ${tournament.config.ante}` : ''}</strong>
          </div>
          <div className="tc-detail-row">
            <span>Inscritos</span>
            <strong>{tournament.registeredCount}</strong>
          </div>
          {isRunning && (
            <div className="tc-detail-row">
              <span>Em jogo</span>
              <strong>{tournament.activeCount} jogadores</strong>
            </div>
          )}
          <div className="tc-detail-row">
            <span>Mesa final</span>
            <strong>últimos 8 jogadores · sem rebuy</strong>
          </div>
        </div>

        {tournament.status === 'registering' && (
          <Countdown scheduledStart={tournament.scheduledStart} />
        )}

        {isRegistered && tournament.status === 'registering' && (
          <div className="registered-info">
            <span className="registered-check">✓ Você está inscrito</span>
            <button className="btn-unregister" onClick={onUnregister}>Cancelar inscrição</button>
          </div>
        )}

        {canRegister && (
          <button className="btn-register" onClick={onRegister}>
            Inscrever-se no torneio
          </button>
        )}

        {tournament.status === 'finished' && (
          <p className="tc-finished">Torneio encerrado.</p>
        )}
      </div>

      {(isRunning || tournament.status === 'final_table' || tournament.status === 'finished') && ranking.length > 0 && (
        <RankingPanel players={ranking} status={tournament.status} />
      )}
    </div>
  )
}

function TournamentStatusBadge({ status }: { status: TournamentInfo['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    registering:  { label: '📋 Inscrições abertas', cls: 'badge-registering' },
    running:      { label: '🟡 Em andamento',        cls: 'badge-running' },
    final_table:  { label: '🔥 Mesa Final',          cls: 'badge-final' },
    finished:     { label: '✅ Encerrado',            cls: 'badge-finished' },
  }
  const b = map[status] ?? { label: status, cls: '' }
  return <span className={`tc-badge ${b.cls}`}>{b.label}</span>
}

function Countdown({ scheduledStart }: { scheduledStart: string }) {
  const [diff, setDiff] = useState(0)

  useEffect(() => {
    const target = new Date(scheduledStart).getTime()
    const update = () => setDiff(target - Date.now())
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [scheduledStart])

  if (diff <= 0) return <p className="countdown-started">O torneio começa em breve!</p>

  const totalSec = Math.floor(diff / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  // Show local time (browser timezone, which may be GMT-3 or whatever the browser reports)
  const localTime = new Date(scheduledStart).toLocaleString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  })

  return (
    <div className="countdown-box">
      <p className="countdown-label">Início em</p>
      <div className="countdown-time">
        {d > 0 && <><span className="cd-num">{d}</span><span className="cd-unit">d</span></>}
        <span className="cd-num">{String(h).padStart(2, '0')}</span><span className="cd-unit">h</span>
        <span className="cd-num">{String(m).padStart(2, '0')}</span><span className="cd-unit">m</span>
        <span className="cd-num">{String(s).padStart(2, '0')}</span><span className="cd-unit">s</span>
      </div>
      <p className="countdown-date">{localTime}</p>
    </div>
  )
}

function RankingPanel({ players, status }: { players: TournamentPlayer[]; status: string }) {
  const active = players.filter(p => !p.eliminated)
  const elim   = players.filter(p => p.eliminated)
  return (
    <div className="tc-ranking">
      <h3>{
        status === 'finished'    ? '🏆 Ranking final' :
        status === 'final_table' ? '🔥 Mesa Final — Ranking' :
        '🏆 Ranking ao vivo'
      }</h3>
      <div className="tc-ranking-list">
        {active.map((p, i) => (
          <div key={p.id} className="tc-rank-row">
            <span className="tc-rank-pos">{i + 1}</span>
            <span className="tc-rank-name">{p.name}</span>
            {p.tableName && <span className="tc-rank-table">{p.tableName}</span>}
            <span className="tc-rank-chips">{p.chips.toLocaleString()}</span>
          </div>
        ))}
        {elim.length > 0 && (
          <>
            <div className="tc-rank-divider">Eliminados</div>
            {elim.map(p => (
              <div key={p.id} className="tc-rank-row tc-rank-elim">
                <span className="tc-rank-pos">{p.rank}º</span>
                <span className="tc-rank-name">{p.name}</span>
                <span className="tc-rank-chips">—</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
