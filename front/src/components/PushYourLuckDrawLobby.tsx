import { useState } from 'react'
import type { PushYourLuckDrawDeckMode, PushYourLuckDrawRoomConfig, PushYourLuckDrawRoomSummary } from '../../../shared/types'

interface Props {
  rooms: PushYourLuckDrawRoomSummary[]
  onCreateRoom: (roomName: string, config: PushYourLuckDrawRoomConfig) => void
  onJoinRoom: (roomId: string) => void
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8] as const
const DEFAULT_TARGET_SCORE = 150

export function PushYourLuckDrawLobby({ rooms, onCreateRoom, onJoinRoom }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [roomName, setRoomName]     = useState('')
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [targetScore, setTargetScore] = useState(DEFAULT_TARGET_SCORE)
  const [deckMode, setDeckMode]     = useState<PushYourLuckDrawDeckMode>('fresh')

  function handleCreate() {
    onCreateRoom(roomName.trim() || 'Mesa', { maxPlayers, targetScore, deckMode })
    setShowCreate(false); setRoomName(''); setMaxPlayers(4); setTargetScore(DEFAULT_TARGET_SCORE); setDeckMode('fresh')
  }

  return (
    <>
      <div className="rooms-header">
        <h2>Mesas de Push Your Luck Draw</h2>
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
                  <span>alvo {room.config.targetScore} pts</span>
                  <span>{room.config.deckMode === 'fresh' ? 'baralho fresco' : 'baralho persistente'}</span>
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
            <h2>Criar mesa de Push Your Luck Draw</h2>

            <div className="field">
              <label>Nome da mesa</label>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Ex: Mesa do Push Your Luck"
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
            </div>

            <div className="field">
              <label>Pontuação-alvo</label>
              <input
                type="number"
                min={50}
                max={2000}
                step={10}
                value={targetScore}
                onChange={(e) => setTargetScore(Math.min(2000, Math.max(50, Number(e.target.value) || DEFAULT_TARGET_SCORE)))}
              />
              <span className="hint">A partida termina ao final da rodada em que alguém atinge ou ultrapassa essa pontuação — vence quem tiver a maior pontuação total naquele momento.</span>
            </div>

            <div className="field">
              <label>Modo de baralho</label>
              <div className="option-row">
                <button
                  type="button"
                  className={`option-btn${deckMode === 'fresh' ? ' active' : ''}`}
                  onClick={() => setDeckMode('fresh')}
                >
                  Fresco
                </button>
                <button
                  type="button"
                  className={`option-btn${deckMode === 'persistent' ? ' active' : ''}`}
                  onClick={() => setDeckMode('persistent')}
                >
                  Persistente
                </button>
              </div>
              <span className="hint">
                {deckMode === 'fresh'
                  ? 'Cada rodada embaralha as 95 cartas do zero.'
                  : 'O monte continua de onde parou entre rodadas — só reembaralha quando esgotar.'}
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
