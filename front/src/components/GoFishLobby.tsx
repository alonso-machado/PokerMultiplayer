import { useState } from 'react'
import type { GoFishRoomConfig, GoFishRoomSummary } from '../../../shared/types'

interface Props {
  rooms: GoFishRoomSummary[]
  onCreateRoom: (roomName: string, config: GoFishRoomConfig) => void
  onJoinRoom: (roomId: string) => void
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const

export function GoFishLobby({ rooms, onCreateRoom, onJoinRoom }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [roomName, setRoomName]     = useState('')
  const [maxPlayers, setMaxPlayers] = useState(4)

  function handleCreate() {
    onCreateRoom(roomName.trim() || 'Mesa', { maxPlayers })
    setShowCreate(false); setRoomName(''); setMaxPlayers(4)
  }

  return (
    <>
      <div className="rooms-header">
        <h2>Mesas de Go Fish</h2>
        <button type="button" className="btn-create" onClick={() => setShowCreate(true)}>+ Criar mesa</button>
      </div>

      <div className="room-list">
        {rooms.length === 0 && <div className="empty-rooms">Nenhuma mesa aberta. Crie uma!</div>}
        {rooms.map((room) => {
          const full    = room.playerCount >= room.maxPlayers
          const playing = room.status === 'playing'
          return (
            <div className="room-card" key={room.id}>
              <div className="room-card-body">
                <div className="room-card-title">{room.name}</div>
                <div className="room-card-meta">
                  <span>👤 {room.creatorName}</span>
                  <span>até {room.config.maxPlayers} jogadores</span>
                </div>
                <div className="room-card-players">
                  <span className={`room-status ${playing ? 'playing' : 'waiting'}`}>
                    {playing ? '🟡 Em jogo' : '🟢 Aguardando'}
                  </span>
                  <span className="player-count">{room.playerCount}/{room.maxPlayers}</span>
                </div>
              </div>
              <button type="button" className="btn-join" onClick={() => onJoinRoom(room.id)} disabled={full || playing}>
                {full ? 'Cheia' : playing ? 'Em jogo' : 'Entrar na Mesa'}
              </button>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <h2>Criar mesa de Go Fish</h2>

            <div className="field">
              <label>Nome da mesa</label>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Mesa do Go Fish"
                maxLength={40}
              />
            </div>

            <div className="field">
              <label>Máximo de jogadores</label>
              <div className="option-row">
                {PLAYER_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`option-btn${maxPlayers === n ? ' active' : ''}`}
                    onClick={() => setMaxPlayers(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="hint">
                Começa automaticamente com 2 jogadores sentados — os demais podem entrar antes de começar.
                7 cartas cada com 2-3 jogadores, 5 cartas cada com 4+.
              </span>
            </div>

            <div className="actions">
              <button type="button" className="btn-cancel" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button type="button" className="btn-confirm" onClick={handleCreate}>Criar mesa</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
