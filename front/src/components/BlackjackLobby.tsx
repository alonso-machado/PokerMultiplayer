interface Props {
  stats: { tableCount: number; playerCount: number }
  onJoin: () => void
}

/** No room creation/browsing here — the server matchmakes a single "join"
 *  into whichever table has a free seat (up to 7 players per dealer), or
 *  opens a new one. See .claude/Blackjack.md → "Mesa". `stats` is a
 *  lobby-wide count only (not a pickable list) — enough to show there's
 *  activity without going back on the no-room-browsing design. */
export function BlackjackLobby({ stats, onJoin }: Props) {
  const tableLabel = stats.tableCount === 1 ? 'mesa aberta' : 'mesas abertas'
  const playerLabel = stats.playerCount === 1 ? 'jogador agora' : 'jogadores agora'

  return (
    <>
      <div className="rooms-header">
        <h2>Blackjack / 21</h2>
      </div>

      <div className="room-list">
        <div className="empty-rooms">
          {stats.tableCount > 0 && (
            <p className="bj-lobby-stats">{stats.tableCount} {tableLabel} · {stats.playerCount} {playerLabel}</p>
          )}
          <p>Você entra em uma mesa aberta com até 7 jogadores por dealer — sem escolher sala.</p>
          <p>Começa com 100 fichas. Aposte à vontade a cada rodada — o que for pro dealer não volta, não há recarga nesta mesa.</p>
          <button type="button" className="btn-create" onClick={onJoin}>🂡 Entrar na mesa</button>
        </div>
      </div>
    </>
  )
}
