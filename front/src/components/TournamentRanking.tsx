import type { TournamentPlayer, TournamentStatus } from '../../../shared/types'

interface Props {
  players: TournamentPlayer[]
  status: TournamentStatus
  isFinalTable: boolean
  myId: string
}

export function TournamentRanking({ players, status, isFinalTable, myId }: Props) {
  const active = players.filter(p => !p.eliminated)
  const eliminated = players.filter(p => p.eliminated).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))

  return (
    <div className="ranking-panel">
      <div className="ranking-header">
        <span className="ranking-title">
          {isFinalTable ? '🔥 Mesa Final' : '🏆 Ranking do Torneio'}
        </span>
        <span className="ranking-count">{active.length} jogadores</span>
      </div>

      <div className="ranking-list">
        {active.map((p, i) => (
          <div key={p.id} className={`ranking-row${p.id === myId ? ' ranking-me' : ''}`}>
            <span className="ranking-pos">{i + 1}</span>
            <span className="ranking-name">{p.name}{p.id === myId ? ' ★' : ''}</span>
            <div className="ranking-right">
              {p.tableName && <span className="ranking-table">{p.tableName}</span>}
              <span className="ranking-chips">{p.chips.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      {eliminated.length > 0 && (
        <div className="ranking-eliminated-section">
          <div className="ranking-elim-header">Eliminados</div>
          {eliminated.map(p => (
            <div key={p.id} className="ranking-row ranking-elim">
              <span className="ranking-pos">{p.rank}º</span>
              <span className="ranking-name">{p.name}</span>
              <span className="ranking-chips">—</span>
            </div>
          ))}
        </div>
      )}

      {status === 'finished' && active[0] && (
        <div className="ranking-winner">🏆 Vencedor: {active[0].name}</div>
      )}
    </div>
  )
}
