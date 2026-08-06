import { useState, useCallback } from 'react'
import { usePostHog } from '@posthog/react'
import type {
  BlindLevel, Card, Player, PlayerAction,
  RoomConfig, RoomSummary, ServerMessage, TableState,
  TournamentInfo, TournamentPlayer, TournamentStatus,
} from '../../shared/types'
import { useSocket } from './hooks/useSocket'
import { useTrucoGame } from './hooks/useTrucoGame'
import { useGauchoGame } from './hooks/useGauchoGame'
import { useCanastraGame } from './hooks/useCanastraGame'
import { getOrCreateIdentity, saveName, saveIdentityToken, saveTournamentToken, clearTournamentToken } from './hooks/usePlayerToken'
import { Lobby } from './components/Lobby'
import { TournamentTab } from './components/TournamentTab'
import { PokerTable } from './components/PokerTable'
import { TrucoLobby } from './components/TrucoLobby'
import { TrucoTable } from './components/TrucoTable'
import { GauchoLobby } from './components/GauchoLobby'
import { GauchoTable } from './components/GauchoTable'
import { CanastraLobby } from './components/CanastraLobby'
import { CanastraTable } from './components/CanastraTable'
import { HandGuide } from './components/HandGuide'
import { AdminPage } from './pages/AdminPage'
import type { TrucoRoomSummary, GauchoRoomSummary, CanastraRoomSummary } from '../../shared/types'

interface TurnState { validActions: PlayerAction[]; callAmount: number; minRaise: number }
interface ShowdownEntry { playerId: string; playerName: string; cards: Card[]; bestCards: Card[]; handName: string; won: number }
type GameGroup = 'poker' | 'truco' | 'gaucho' | 'canastra'
type PokerTab = 'rooms' | 'tournament'

const identity = getOrCreateIdentity()

function App() {
  if (window.location.pathname === '/admin') return <AdminPage />

  const posthog = usePostHog()
  const [myName, setMyNameState] = useState(identity.name)
  const [activeGame, setActiveGame] = useState<GameGroup>('poker')
  const [activePokerTab, setActivePokerTab] = useState<PokerTab>('rooms')
  const [rooms, setRooms]         = useState<RoomSummary[]>([])
  const [trucoRooms, setTrucoRooms] = useState<TrucoRoomSummary[]>([])
  const { trucoState, handleTrucoMessage } = useTrucoGame(identity.playerId)
  const [gauchoRooms, setGauchoRooms] = useState<GauchoRoomSummary[]>([])
  const { gauchoState, handleGauchoMessage } = useGauchoGame(identity.playerId)
  const [canastraRooms, setCanastraRooms] = useState<CanastraRoomSummary[]>([])
  const { canastraState, handleCanastraMessage } = useCanastraGame(identity.playerId)

  // Tournament
  const [tournamentInfo,       setTournamentInfo]       = useState<TournamentInfo | null>(null)
  const [myTournamentToken,    setMyTournamentToken]    = useState<string | null>(identity.tournamentToken)
  const [tournamentRanking,    setTournamentRanking]    = useState<TournamentPlayer[]>([])
  const [tournamentStatus,     setTournamentStatus]     = useState<TournamentStatus>('registering')
  const [tournamentEliminated, setTournamentEliminated] = useState<{ rank: number; total: number } | null>(null)
  const [tournamentWinner,     setTournamentWinner]     = useState<string | null>(null)
  const [isFinalTable,         setIsFinalTable]         = useState(false)
  const [nextBlinds,           setNextBlinds]           = useState<BlindLevel | null>(null)
  const [nextBlindsInSec,      setNextBlindsInSec]      = useState<number | null>(null)
  // Whether the player's current `roomId` is a tournament table (vs a regular
  // lobby room). Drives `isTournament` in PokerTable — distinct from
  // `myTournamentToken`, which stays set after elimination so the player can
  // keep watching the tournament ranking.
  const [inTournamentRoom,     setInTournamentRoom]     = useState(false)

  // Room / game
  const [roomId,    setRoomId]    = useState<string | null>(null)
  const [roomName,  setRoomName]  = useState('')
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null)
  const [players,   setPlayers]   = useState<Player[]>([])
  const [tableState, setTableState] = useState<TableState | null>(null)
  // communityCards is derived directly from tableState to stay in sync on mid-game joins
  const [myCards,   setMyCards]   = useState<Card[]>([])
  const [isStarted, setIsStarted] = useState(false)
  const [isAway,    setIsAway]    = useState(false)
  const [turn,      setTurn]      = useState<TurnState | null>(null)
  const [showdown,  setShowdown]  = useState<ShowdownEntry[] | null>(null)
  const [handResult, setHandResult] = useState<{ winnerName: string; amount: number; handName?: string } | null>(null)

  // Lobby rebuy
  const [rebuyPrompt, setRebuyPrompt] = useState<{ startingChips: number } | null>(null)

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room_list':       setRooms(msg.rooms); break
      case 'truco_room_list': setTrucoRooms(msg.rooms); break
      case 'gaucho_room_list': setGauchoRooms(msg.rooms); break
      case 'canastra_room_list': setCanastraRooms(msg.rooms); break
      case 'tournament_info':
        // A brand-new tournament (different id) means our previous registration
        // token is stale — let the player register again for this one.
        setTournamentInfo(prev => {
          if (msg.tournament && prev && prev.id !== msg.tournament.id) {
            setMyTournamentToken(null); clearTournamentToken()
            setTournamentRanking([]); setTournamentStatus('registering')
            setTournamentEliminated(null); setTournamentWinner(null); setIsFinalTable(false)
          }
          return msg.tournament
        })
        break

      case 'room_joined':
        setRoomId(msg.roomId); setRoomName(msg.roomName); setRoomConfig(msg.config)
        setIsStarted(false); setMyCards([]); setTableState(null)
        setTurn(null); setShowdown(null); setHandResult(null)
        setIsAway(false); setRebuyPrompt(null); setInTournamentRoom(false)
        posthog?.capture('lobby_joined', { room_id: msg.roomId, room_name: msg.roomName, big_blind: msg.config.bigBlind })
        break

      case 'room_left':
        setRoomId(null); setPlayers([])
        if (msg.reason !== 'chips') setRebuyPrompt(null)
        break

      case 'player_list':  setPlayers(msg.players); break
      case 'game_started': setIsStarted(true); setShowdown(null); setHandResult(null); break

      case 'hand_dealt':
        // communityCards reset to [] at hand start — tableState carries the ground truth
        setMyCards(msg.yourCards)
        setPlayers(msg.players)
        setTableState({ ...msg.tableState, communityCards: [] })
        setTurn(null); setShowdown(null); setHandResult(null); setRebuyPrompt(null)
        break

      case 'community_cards':
        // tableState.communityCards already contains the full accumulated list
        // Note: do NOT clear turn here — player_acted already cleared it, and
        // your_turn arrives after this message for whoever acts first on the new street.
        setTableState(msg.tableState)
        setPlayers(msg.players)
        break

      case 'your_turn':
        setTurn({ validActions: msg.validActions, callAmount: msg.callAmount, minRaise: msg.minRaise })
        break

      case 'player_acted':
        setTableState(msg.tableState); setPlayers(msg.players); setTurn(null)
        break

      case 'showdown':
        setShowdown(msg.results); setTableState(msg.tableState); setPlayers(msg.players)
        break

      case 'hand_end':
        setHandResult({ winnerName: msg.winnerName, amount: msg.amount, handName: msg.handName })
        posthog?.capture('hand_ended', { winner: msg.winnerName, amount: msg.amount, hand_name: msg.handName })
        setTimeout(() => { setShowdown(null); setHandResult(null) }, 4000)
        break

      case 'rebuy_prompt':
        setRebuyPrompt({ startingChips: msg.startingChips })
        break

      // Tournament
      case 'tournament_registered':
        setMyTournamentToken(msg.token); saveTournamentToken(msg.token)
        posthog?.capture('tournament_registered')
        break
      case 'tournament_unregistered':
        setMyTournamentToken(null); clearTournamentToken(); break
      case 'tournament_started':
        setTournamentEliminated(null); setTournamentWinner(null); setIsFinalTable(false)
        setNextBlinds(null); setNextBlindsInSec(null)
        break
      case 'tournament_table_assigned':
        setRoomId(msg.roomId); setRoomName(msg.roomName); setRoomConfig(msg.config)
        setIsStarted(false); setMyCards([]); setTableState(null)
        setTurn(null); setShowdown(null); setHandResult(null); setIsAway(false)
        setInTournamentRoom(true)
        break
      case 'tournament_ranking':
        setTournamentRanking(msg.players); setTournamentStatus(msg.status); break
      case 'tournament_final_table':
        setIsFinalTable(true); break
      case 'tournament_eliminated':
        setTournamentEliminated({ rank: msg.rank, total: msg.totalPlayers })
        setRoomId(null); setTurn(null); setMyCards([]); setTableState(null)
        setInTournamentRoom(false); setActiveGame('poker'); setActivePokerTab('tournament')
        posthog?.capture('tournament_eliminated', { rank: msg.rank, total_players: msg.totalPlayers })
        break
      case 'tournament_finished':
        setTournamentWinner(msg.winnerName); break

      case 'blind_update':
        setNextBlinds(msg.next); setNextBlindsInSec(msg.nextInSeconds)
        // Also update roomConfig so the table topbar is accurate
        setRoomConfig(prev => prev ? { ...prev, smallBlind: msg.current.smallBlind, bigBlind: msg.current.bigBlind, ante: msg.current.ante } : prev)
        break

      case 'session_restored':
        if (msg.roomId && msg.config) {
          setRoomId(msg.roomId); setRoomName(msg.roomName ?? '')
          setRoomConfig(msg.config); setIsStarted(true)
        }
        setInTournamentRoom(msg.inTournament)
        break

      case 'identity':
        // Server issued or re-issued a signed token — persist it for future connections.
        saveIdentityToken(msg.token)
        identity.playerId = msg.token
        break

      default:
        if (msg.type.startsWith('truco_')) handleTrucoMessage(msg)
        else if (msg.type.startsWith('gaucho_')) handleGauchoMessage(msg)
        else if (msg.type.startsWith('canastra_')) handleCanastraMessage(msg)
        break
    }
  }, [])

  const { send } = useSocket(identity, handleMessage)

  function setMyName(name: string) {
    setMyNameState(name); saveName(name); identity.name = name
    send({ type: 'set_name', name })
    // Identify the player in PostHog using their persistent cookie ID
    posthog?.identify(identity.playerId, { name })
  }

  function exitRoom() {
    if (myTournamentToken) return
    posthog?.capture('lobby_left', { room_name: roomName })
    send({ type: 'leave_room' })
    setRoomId(null); setPlayers([]); setTableState(null)
    setMyCards([]); setIsStarted(false); setTurn(null)
    setRebuyPrompt(null)
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  if (canastraState.roomId && canastraState.config) {
    return (
      <CanastraTable
        myId={canastraState.myId}
        roomName={canastraState.roomName}
        config={canastraState.config}
        players={canastraState.players}
        tableState={canastraState.tableState}
        myCards={canastraState.myCards}
        isStarted={canastraState.isStarted}
        turnDeadline={canastraState.turnDeadline}
        roundEnd={canastraState.roundEnd}
        rematch={canastraState.rematch}
        onLeave={() => send({ type: 'canastra_leave_room' })}
        onDrawStock={() => send({ type: 'canastra_draw_stock' })}
        onTakeDiscard={(meldPlan) => send({ type: 'canastra_take_discard', meldPlan })}
        onLayMeld={(cardIds) => send({ type: 'canastra_lay_meld', cardIds })}
        onAddToMeld={(meldId, cardIds) => send({ type: 'canastra_add_to_meld', meldId, cardIds })}
        onDiscard={(cardId) => send({ type: 'canastra_discard', cardId })}
        onRematchVote={(accept) => send({ type: 'canastra_rematch_vote', accept })}
      />
    )
  }

  if (gauchoState.roomId && gauchoState.config) {
    return (
      <GauchoTable
        myId={gauchoState.myId}
        roomName={gauchoState.roomName}
        config={gauchoState.config}
        players={gauchoState.players}
        tableState={gauchoState.tableState}
        myCards={gauchoState.myCards}
        dealtCards={gauchoState.dealtCards}
        isStarted={gauchoState.isStarted}
        turnDeadline={gauchoState.turnDeadline}
        maoDeOnzePrompt={gauchoState.maoDeOnzePrompt}
        handEnd={gauchoState.handEnd}
        matchEnd={gauchoState.matchEnd}
        rematch={gauchoState.rematch}
        lastCall={gauchoState.lastCall}
        lastResult={gauchoState.lastResult}
        onLeave={() => send({ type: 'gaucho_leave_room' })}
        onPlayCard={(card) => send({ type: 'gaucho_play_card', card })}
        onCallTruco={() => send({ type: 'gaucho_call_truco' })}
        onRespondTruco={(accept) => send({ type: 'gaucho_respond_truco', accept })}
        onCallEnvido={() => send({ type: 'gaucho_call_envido' })}
        onRespondEnvido={(accept) => send({ type: 'gaucho_respond_envido', accept })}
        onCallFlor={() => send({ type: 'gaucho_call_flor' })}
        onRespondFlor={(accept) => send({ type: 'gaucho_respond_flor', accept })}
        onMaoDeOnzeDecision={(accept) => send({ type: 'gaucho_mao_de_onze_decision', accept })}
        onRematchVote={(accept) => send({ type: 'gaucho_rematch_vote', accept })}
      />
    )
  }

  if (trucoState.roomId && trucoState.config) {
    return (
      <TrucoTable
        myId={trucoState.myId}
        roomName={trucoState.roomName}
        config={trucoState.config}
        players={trucoState.players}
        tableState={trucoState.tableState}
        myCards={trucoState.myCards}
        isStarted={trucoState.isStarted}
        turnDeadline={trucoState.turnDeadline}
        maoDeOnzePrompt={trucoState.maoDeOnzePrompt}
        handEnd={trucoState.handEnd}
        matchEnd={trucoState.matchEnd}
        rematch={trucoState.rematch}
        onLeave={() => send({ type: 'truco_leave_room' })}
        onPlayCard={(card) => send({ type: 'truco_play_card', card })}
        onCallTruco={() => send({ type: 'truco_call_truco' })}
        onRespond={(accept) => send({ type: 'truco_respond', accept })}
        onMaoDeOnzeDecision={(accept) => send({ type: 'truco_mao_de_onze_decision', accept })}
        onRematchVote={(accept) => send({ type: 'truco_rematch_vote', accept })}
      />
    )
  }

  if (roomId && roomConfig) {
    return (
      <>
        <PokerTable
          myId={identity.playerId} myName={myName}
          roomName={roomName} config={roomConfig}
          players={players} tableState={tableState} myCards={myCards}
          myTurn={turn !== null}
          validActions={turn?.validActions ?? []}
          callAmount={turn?.callAmount ?? 0}
          minRaise={turn?.minRaise ?? roomConfig.bigBlind * 2}
          showdown={showdown} handResult={handResult}
          rebuyPrompt={rebuyPrompt}
          isStarted={isStarted} isAway={isAway}
          isTournament={inTournamentRoom}
          isFinalTable={isFinalTable}
          tournamentRanking={inTournamentRoom ? tournamentRanking : null}
          tournamentStatus={inTournamentRoom ? tournamentStatus : null}
          nextBlinds={nextBlinds}
          nextBlindsInSec={nextBlindsInSec}
          onLeave={exitRoom}
          onAction={(action, amount) => { send({ type: 'player_action', action, amount }); setTurn(null) }}
          onRebuy={() => { send({ type: 'rebuy' }); setRebuyPrompt(null) }}
          onRebuyDecline={() => { send({ type: 'rebuy_decline' }); setRebuyPrompt(null); setRoomId(null); setPlayers([]) }}
          onSetAway={() => { send({ type: 'set_away' }); setIsAway(true); setTurn(null) }}
          onSetBack={() => { send({ type: 'set_back' }); setIsAway(false) }}
        />
        <HandGuide />
      </>
    )
  }

  return (
    <>
    <div className="lobby">
      <h1>
        {activeGame === 'poker' ? "♠ Texas Hold'em ♥"
          : activeGame === 'truco' ? '🂡 Truco'
          : activeGame === 'gaucho' ? '🧉 Truco Gaúcho'
          : '🎴 Canastra / Buraco'}
      </h1>
      <p className="subtitle">
        {activeGame === 'poker' ? 'Poker multiplayer em tempo real'
          : activeGame === 'truco' ? 'Truco multiplayer — Paulista ou Mineiro'
          : activeGame === 'gaucho' ? 'Truco Gaúcho / Espanhol — com Envido e Flor'
          : 'Canastra / Buraco multiplayer — 1x1 ou 2x2'}
      </p>
      <NameRow name={myName} onSave={setMyName} />

      <div className="tabs game-tabs">
        <button className={`tab${activeGame === 'poker' ? ' active' : ''}`} onClick={() => setActiveGame('poker')}>♠ Poker</button>
        <button className={`tab${activeGame === 'truco' ? ' active' : ''}`} onClick={() => setActiveGame('truco')}>🂡 Truco</button>
        <button className={`tab${activeGame === 'gaucho' ? ' active' : ''}`} onClick={() => setActiveGame('gaucho')}>🧉 Truco Gaúcho</button>
        <button className={`tab${activeGame === 'canastra' ? ' active' : ''}`} onClick={() => setActiveGame('canastra')}>🎴 Canastra</button>
      </div>

      {activeGame === 'poker' && (
        <>
          <div className="tabs">
            <button className={`tab${activePokerTab === 'rooms' ? ' active' : ''}`} onClick={() => setActivePokerTab('rooms')}>🃏 Mesas</button>
            <button className={`tab${activePokerTab === 'tournament' ? ' active' : ''}`} onClick={() => setActivePokerTab('tournament')}>🏆 Torneio</button>
          </div>
          {activePokerTab === 'rooms' && (
            <Lobby
              rooms={rooms}
              onCreateRoom={(name, cfg) => send({ type: 'create_room', roomName: name, config: cfg })}
              onJoinRoom={(id) => send({ type: 'join_room', roomId: id })}
            />
          )}
          {activePokerTab === 'tournament' && (
            <TournamentTab
              tournament={tournamentInfo}
              myToken={myTournamentToken}
              ranking={tournamentRanking}
              eliminated={tournamentEliminated}
              winnerName={tournamentWinner}
              onRegister={() => { send({ type: 'register_tournament' }) }}
              onUnregister={() => {
                send({ type: 'unregister_tournament' })
                posthog?.capture('tournament_unregistered')
                setMyTournamentToken(null); clearTournamentToken()
              }}
              onDismissElimination={() => setTournamentEliminated(null)}
            />
          )}
        </>
      )}

      {activeGame === 'truco' && (
        <TrucoLobby
          rooms={trucoRooms}
          onCreateRoom={(name, cfg) => send({ type: 'truco_create_room', roomName: name, config: cfg })}
          onJoinRoom={(id) => send({ type: 'truco_join_room', roomId: id })}
        />
      )}

      {activeGame === 'gaucho' && (
        <GauchoLobby
          rooms={gauchoRooms}
          onCreateRoom={(name, cfg) => send({ type: 'gaucho_create_room', roomName: name, config: cfg })}
          onJoinRoom={(id) => send({ type: 'gaucho_join_room', roomId: id })}
        />
      )}

      {activeGame === 'canastra' && (
        <CanastraLobby
          rooms={canastraRooms}
          onCreateRoom={(name, cfg) => send({ type: 'canastra_create_room', roomName: name, config: cfg })}
          onJoinRoom={(id) => send({ type: 'canastra_join_room', roomId: id })}
        />
      )}
    </div>
    <HandGuide />
    </>
  )
}

function NameRow({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [edit, setEdit] = useState(name)
  const [saved, setSaved] = useState(false)
  function save() {
    const n = edit.trim(); if (!n) return
    onSave(n); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  return (
    <div className="name-row">
      <label>Seu nome:</label>
      <input value={edit} maxLength={24} onChange={e => setEdit(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()} placeholder="Como quer ser chamado?" />
      <button onClick={save}>{saved ? '✓ Salvo' : 'Salvar'}</button>
    </div>
  )
}

export default App
