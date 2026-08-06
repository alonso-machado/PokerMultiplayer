import { useState } from 'react'
import type { CanastraMode, CanastraRoomConfig, CanastraRoomSummary } from '../../../shared/types'

interface Props {
  rooms: CanastraRoomSummary[]
  onCreateRoom: (roomName: string, config: CanastraRoomConfig) => void
  onJoinRoom: (roomId: string) => void
}

const MODE_LABEL: Record<CanastraMode, string> = { '1x1': '1x1', '2x2': '2x2 (duplas)' }

export function CanastraLobby({ rooms, onCreateRoom, onJoinRoom }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [roomName, setRoomName]     = useState('')
  const [mode, setMode]             = useState<CanastraMode>('2x2')

  function handleCreate() {
    onCreateRoom(roomName.trim() || 'Mesa', { mode })
    setShowCreate(false); setRoomName(''); setMode('2x2')
  }

  return (
    <>
      <div className="rooms-header">
        <h2>Mesas de Canastra / Buraco</h2>
        <button className="btn-create" onClick={() => setShowCreate(true)}>+ Criar mesa</button>
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
                  <span>{MODE_LABEL[room.config.mode]}</span>
                </div>
                <div className="room-card-players">
                  <span className={`room-status ${playing ? 'playing' : 'waiting'}`}>
                    {playing ? '🟡 Em jogo' : '🟢 Aguardando'}
                  </span>
                  <span className="player-count">{room.playerCount}/{room.maxPlayers}</span>
                </div>
              </div>
              <button className="btn-join" onClick={() => onJoinRoom(room.id)} disabled={full || playing}>
                {full ? 'Cheia' : playing ? 'Em jogo' : 'Entrar na Mesa'}
              </button>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <h2>Criar mesa de Canastra / Buraco</h2>

            <div className="field">
              <label>Nome da mesa</label>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Mesa do Buraco"
                maxLength={40}
              />
            </div>

            <div className="field">
              <label>Modo</label>
              <div className="option-row">
                <button type="button" className={`option-btn${mode === '1x1' ? ' active' : ''}`} onClick={() => setMode('1x1')}>1x1</button>
                <button type="button" className={`option-btn${mode === '2x2' ? ' active' : ''}`} onClick={() => setMode('2x2')}>2x2 (duplas)</button>
              </div>
              <span className="hint">108 cartas (2 baralhos + 4 curingões), 11 cartas por jogador, morto por time.</span>
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
