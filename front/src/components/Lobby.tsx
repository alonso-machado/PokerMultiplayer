import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import type { RoomConfig, RoomSummary } from '../../../shared/types'
import { startingChipsFor } from '../../../shared/types'

const MAX_PLAYERS = 6   // always 6 in lobby

interface Blinds { smallBlind: number; bigBlind: number }

interface Props {
  rooms: RoomSummary[]
  onCreateRoom: (roomName: string, config: RoomConfig) => void
  onJoinRoom: (roomId: string) => void
}

/** Build the full RoomConfig from just the blinds: ante = bigBlind, maxPlayers = 6 */
function buildConfig(blinds: Blinds): RoomConfig {
  return {
    smallBlind: blinds.smallBlind,
    bigBlind:   blinds.bigBlind,
    ante:       blinds.bigBlind,   // ante = big blind (Texas Hold'em standard)
    maxPlayers: MAX_PLAYERS,
  }
}

const DEFAULT_BLINDS: Blinds = { smallBlind: 5, bigBlind: 10 }

export function Lobby({ rooms, onCreateRoom, onJoinRoom }: Props) {
  const posthog = usePostHog()
  const [showCreate, setShowCreate] = useState(false)
  const [roomName, setRoomName]     = useState('')
  const [blinds, setBlinds]         = useState<Blinds>({ ...DEFAULT_BLINDS })

  function setBlind(key: keyof Blinds, raw: string) {
    const val = Math.max(1, parseInt(raw) || 1)
    setBlinds(prev => {
      let next = { ...prev, [key]: val }
      // keep SB < BB
      if (key === 'bigBlind'   && next.smallBlind >= next.bigBlind) next.smallBlind = Math.max(1, Math.floor(next.bigBlind / 2))
      if (key === 'smallBlind' && next.smallBlind >= next.bigBlind) next.bigBlind   = next.smallBlind * 2
      return next
    })
  }

  function handleCreate() {
    const name   = roomName.trim() || 'Mesa'
    const config = buildConfig(blinds)
    posthog?.capture('lobby_created', { room_name: name, small_blind: blinds.smallBlind, big_blind: blinds.bigBlind })
    onCreateRoom(name, config)
    setShowCreate(false)
    setRoomName('')
    setBlinds({ ...DEFAULT_BLINDS })
  }

  return (
    <>
      <div className="rooms-header">
        <h2>Mesas disponíveis</h2>
        <button className="btn-create" onClick={() => setShowCreate(true)}>+ Criar mesa</button>
      </div>

      <div className="room-list">
        {rooms.length === 0 && <div className="empty-rooms">Nenhuma mesa aberta. Crie uma!</div>}
        {rooms.map(room => {
          const chips  = startingChipsFor(room.config)
          const full   = room.playerCount >= room.maxPlayers
          const playing = room.status === 'playing'
          return (
            <div className="room-card" key={room.id}>
              <div className="room-card-body">
                <div className="room-card-title">{room.name}</div>
                <div className="room-card-meta">
                  <span>👤 {room.creatorName}</span>
                  <span>💰 {chips} fichas</span>
                  <span>Blinds {room.config.smallBlind}/{room.config.bigBlind}</span>
                  <span>Ante {room.config.ante}</span>
                  <span>{room.maxPlayers} jogadores max</span>
                </div>
                <div className="room-card-players">
                  <span className={`room-status ${playing ? 'playing' : 'waiting'}`}>
                    {playing ? '🟡 Em jogo' : '🟢 Aguardando'}
                  </span>
                  <span className="player-count">{room.playerCount}/{room.maxPlayers}</span>
                </div>
              </div>
              <button className="btn-join" onClick={() => onJoinRoom(room.id)} disabled={full}>
                {full ? 'Cheia' : playing ? '▶ Entrar (em jogo)' : 'Entrar na Sala'}
              </button>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <h2>Criar mesa</h2>

            <div className="field">
              <label>Nome da mesa</label>
              <input
                value={roomName}
                onChange={e => setRoomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Mesa VIP"
                maxLength={40}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label>Small Blind</label>
                <input
                  type="number" min={1}
                  value={blinds.smallBlind}
                  onChange={e => setBlind('smallBlind', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Big Blind</label>
                <input
                  type="number" min={2}
                  value={blinds.bigBlind}
                  onChange={e => setBlind('bigBlind', e.target.value)}
                />
              </div>
            </div>

            {/* Auto-calculated values — read-only info */}
            <div className="create-auto-values">
              <div className="auto-row">
                <span>Ante</span>
                <strong>{blinds.bigBlind}</strong>
                <span className="hint">= big blind</span>
              </div>
              <div className="auto-row">
                <span>Máx. jogadores</span>
                <strong>{MAX_PLAYERS}</strong>
              </div>
              <div className="auto-row">
                <span>Fichas iniciais</span>
                <strong>{startingChipsFor(buildConfig(blinds))}</strong>
                <span className="hint">= 20× big blind</span>
              </div>
            </div>

            <div className="actions">
              <button className="btn-cancel" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button className="btn-confirm" onClick={handleCreate}>Criar mesa</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
