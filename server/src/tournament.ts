import type {
  BlindLevel, RoomConfig, ServerMessage,
  TournamentInfo, TournamentPlayer, TournamentStatus,
} from '../../shared/types'
import { startingChipsFor } from '../../shared/types'
import { Room, type SendFn } from './room'

const FINAL_TABLE_THRESHOLD = 8
const MAX_PER_TABLE         = 6
const BLIND_LEVEL_MINUTES   = 10
const RANKING_INTERVAL_MS   = 30_000

export interface TournamentRegistration {
  playerId: string
  name: string
  token: string
  send: SendFn
}

export interface TournamentConfig {
  name: string
  scheduledStart: Date
  config: RoomConfig
}

/** Generate a blind schedule: each level doubles SB/BB/Ante from the initial values */
function buildBlindSchedule(base: RoomConfig): BlindLevel[] {
  const levels: BlindLevel[] = []
  let sb = base.smallBlind, bb = base.bigBlind, ante = base.ante
  for (let i = 0; i < 20; i++) {
    levels.push({ level: i + 1, smallBlind: sb, bigBlind: bb, ante, durationMinutes: BLIND_LEVEL_MINUTES })
    sb = sb * 2; bb = bb * 2; ante = ante > 0 ? ante * 2 : 0
  }
  return levels
}

export class Tournament {
  readonly id: string
  readonly name: string
  readonly config: RoomConfig       // initial blinds (level 1)
  readonly startingChips: number
  readonly scheduledStart: Date

  status: TournamentStatus = 'registering'

  private byToken = new Map<string, TournamentRegistration>()
  readonly registrations = new Map<string, TournamentRegistration>()
  private activePlayers = new Map<string, TournamentPlayer>()
  private tables = new Map<string, Room>()
  private totalPlayers = 0
  private rankCounter  = 0

  // Blind schedule
  private blindSchedule: BlindLevel[]
  private currentBlindLevelIdx = 0
  private blindLevelStart = 0    // Date.now() when current level started
  private blindTimer: ReturnType<typeof setTimeout> | null = null

  // Timers
  private startTimer:   ReturnType<typeof setTimeout>  | null = null
  private rankingTimer: ReturnType<typeof setInterval> | null = null

  private onTablesChanged: (rooms: Map<string, Room>) => void
  private onFinished: (id: string) => void

  constructor(
    id: string, cfg: TournamentConfig,
    onTablesChanged: (rooms: Map<string, Room>) => void,
    onFinished: (id: string) => void,
  ) {
    this.id            = id
    this.name          = cfg.name
    this.config        = cfg.config
    this.startingChips = startingChipsFor(cfg.config)
    this.scheduledStart = cfg.scheduledStart
    this.blindSchedule  = buildBlindSchedule(cfg.config)
    this.onTablesChanged = onTablesChanged
    this.onFinished      = onFinished

    const ms = cfg.scheduledStart.getTime() - Date.now()
    if (ms > 0) this.startTimer = setTimeout(() => this.autoStart(), ms)
  }

  // ── Info ──────────────────────────────────────────────────────────────────

  info(): TournamentInfo {
    const current = this.blindSchedule[this.currentBlindLevelIdx] ?? null
    const next    = this.blindSchedule[this.currentBlindLevelIdx + 1] ?? null
    let nextInSec: number | null = null
    if (this.status !== 'registering' && current) {
      const elapsed = Date.now() - this.blindLevelStart
      nextInSec = Math.max(0, Math.round((BLIND_LEVEL_MINUTES * 60_000 - elapsed) / 1000))
    }
    return {
      id: this.id, name: this.name, status: this.status,
      scheduledStart: this.scheduledStart.toISOString(),
      registeredCount: this.registrations.size,
      activeCount: [...this.activePlayers.values()].filter(p => !p.eliminated).length,
      config: this.config, startingChips: this.startingChips,
      currentBlindLevel: current, nextBlindLevel: next, nextBlindInSeconds: nextInSec,
    }
  }

  // ── Registration ──────────────────────────────────────────────────────────

  register(pid: string, name: string, send: SendFn, token: string): boolean {
    if (this.status !== 'registering') return false
    const reg: TournamentRegistration = { playerId: pid, name, token, send }
    this.byToken.set(token, reg); this.registrations.set(pid, reg)
    send({ type: 'tournament_registered', token })
    return true
  }

  unregister(pid: string): void {
    const reg = this.registrations.get(pid); if (!reg) return
    this.byToken.delete(reg.token); this.registrations.delete(pid)
  }

  findByToken(token: string): TournamentRegistration | undefined { return this.byToken.get(token) }
  isRegistered(pid: string): boolean { return this.registrations.has(pid) }

  updateSendFn(pid: string, send: SendFn): void {
    const reg = this.registrations.get(pid); if (!reg) return
    reg.send = send
    const t = this.byToken.get(reg.token); if (t) t.send = send
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  private autoStart(): void {
    if (this.status !== 'registering' || this.registrations.size < 2) return
    this.start()
  }

  start(): void {
    if (this.status !== 'registering') return
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null }

    this.status      = 'running'
    this.totalPlayers = this.registrations.size
    this.rankCounter  = this.totalPlayers

    for (const reg of this.registrations.values()) {
      this.activePlayers.set(reg.playerId, {
        id: reg.playerId, name: reg.name, chips: this.startingChips,
        tableId: null, tableName: null, rank: 0, eliminated: false,
      })
    }

    const tableRooms = this.distributeToTables()
    this.startBlindTimer()

    // 30s ranking broadcast
    this.rankingTimer = setInterval(() => {
      if (this.status === 'running' || this.status === 'final_table') this.broadcastRanking()
    }, RANKING_INTERVAL_MS)

    // Tell each player which table they're on BEFORE dealing the first hand —
    // the front switches to the table view on `tournament_table_assigned`,
    // resetting cards/turn/table state. If `hand_dealt`/`your_turn` arrived
    // first (from room.startGame() below), that reset would wipe them out.
    for (const reg of this.registrations.values()) {
      reg.send({ type: 'tournament_started' })
      const tp = this.activePlayers.get(reg.playerId)
      if (tp?.tableId) {
        const room = this.tables.get(tp.tableId)
        if (room) reg.send({ type: 'tournament_table_assigned', roomId: room.id, roomName: room.name, config: room.config })
      }
    }

    for (const room of tableRooms) room.startGame()

    this.broadcastRanking()
  }

  // ── Blind timer ───────────────────────────────────────────────────────────

  private startBlindTimer(): void {
    this.currentBlindLevelIdx = 0
    this.blindLevelStart = Date.now()
    this.scheduleNextBlindAdvance()
  }

  private scheduleNextBlindAdvance(): void {
    if (this.blindTimer) { clearTimeout(this.blindTimer); this.blindTimer = null }
    this.blindTimer = setTimeout(() => this.advanceBlinds(), BLIND_LEVEL_MINUTES * 60_000)
  }

  private advanceBlinds(): void {
    if (this.status === 'finished') return
    this.currentBlindLevelIdx++
    if (this.currentBlindLevelIdx >= this.blindSchedule.length) return

    const current = this.blindSchedule[this.currentBlindLevelIdx]!
    const next    = this.blindSchedule[this.currentBlindLevelIdx + 1] ?? null
    this.blindLevelStart = Date.now()

    // Update all active tables with new config
    const newConfig: RoomConfig = {
      smallBlind: current.smallBlind,
      bigBlind:   current.bigBlind,
      ante:       current.ante,
      maxPlayers: this.config.maxPlayers,
    }
    for (const room of this.tables.values()) room.updateConfig(newConfig)

    // Broadcast blind update to all registered players
    this.broadcastAll({
      type: 'blind_update', current,
      next,
      nextInSeconds: BLIND_LEVEL_MINUTES * 60,
    })

    this.scheduleNextBlindAdvance()
  }

  // ── Table distribution ────────────────────────────────────────────────────

  /** Create tables and seat all registered players. Does NOT start dealing —
   *  callers must send `tournament_table_assigned` and then call
   *  `room.startGame()` on each returned room (see `start()`). */
  private distributeToTables(): Room[] {
    const players = [...this.registrations.values()]
    const count   = Math.ceil(players.length / MAX_PER_TABLE)
    const tableRooms: Room[] = []

    for (let i = 0; i < count; i++) {
      const room = new Room(
        generateId(), `${this.name} — Mesa ${i + 1}`, this.name, this.config,
        { tournamentId: this.id, onPlayersEliminated: (eliminations) => this.onEliminated(eliminations) },
      )
      tableRooms.push(room); this.tables.set(room.id, room)
    }

    players.forEach((reg, idx) => {
      const room = tableRooms[idx % count]!
      room.addTournamentPlayer(reg.playerId, reg.name, reg.send, this.startingChips)
      const tp = this.activePlayers.get(reg.playerId)
      if (tp) { tp.tableId = room.id; tp.tableName = room.name }
    })

    this.onTablesChanged(this.tables)
    return tableRooms
  }

  // ── Elimination ───────────────────────────────────────────────────────────

  private onEliminated(eliminations: { playerId: string; totalBet: number }[]): void {
    // Same-hand (simultaneous) eliminations are ranked by chips committed to
    // the pot that hand: the player who put in the LEAST is ranked worst
    // (assigned first, i.e. gets the lowest remaining rankCounter value),
    // and the player who put in the MOST is ranked best among the bustouts.
    const ordered = [...eliminations].sort((a, b) => a.totalBet - b.totalBet)
    const now = Date.now()
    for (const { playerId: pid } of ordered) {
      const tp = this.activePlayers.get(pid); if (!tp || tp.eliminated) continue
      tp.eliminated = true; tp.chips = 0; tp.tableId = null; tp.tableName = null
      tp.rank = this.rankCounter--; tp.eliminatedAt = now

      this.registrations.get(pid)?.send({ type: 'tournament_eliminated', rank: tp.rank, totalPlayers: this.totalPlayers })
    }

    this.broadcastRanking()  // immediate on elimination
    this.checkRebalance()
    this.checkFinalTable()
    this.checkFinished()
  }

  private checkRebalance(): void {
    const active = [...this.tables.values()].filter(t => t.playerCount > 0)
    if (active.length <= 1) return
    active.sort((a, b) => b.playerCount - a.playerCount)
    const largest = active[0]!, smallest = active[active.length - 1]!
    if (largest.playerCount - smallest.playerCount >= 2 && !smallest.isFull) {
      const gp = [...largest.game.players].find(p => !p.isDealer && !p.isSmallBlind && !p.isBigBlind && p.chips > 0)
      if (!gp) return
      const send = largest.getSendFn(gp.id); if (!send) return
      const moved = largest.moveTournamentPlayer(gp.id); if (!moved) return
      smallest.addTournamentPlayer(gp.id, moved.name, send, moved.chips)
      send({ type: 'tournament_table_assigned', roomId: smallest.id, roomName: smallest.name, config: smallest.config })
      const tp = this.activePlayers.get(gp.id)
      if (tp) { tp.tableId = smallest.id; tp.tableName = smallest.name }
    }
    for (const t of active) { if (t.playerCount === 0) { t.destroy(); this.tables.delete(t.id) } }
    this.onTablesChanged(this.tables)
  }

  private checkFinalTable(): void {
    const remaining = [...this.activePlayers.values()].filter(p => !p.eliminated)
    if (remaining.length > FINAL_TABLE_THRESHOLD || this.status !== 'running') return
    this.status = 'final_table'

    const active = [...this.tables.values()].filter(t => t.playerCount > 0)
    if (active.length <= 1) {
      this.broadcastAll({ type: 'tournament_final_table', tableId: active[0]?.id ?? '' })
      return
    }

    const finalRoom = new Room(
      generateId(), `${this.name} — Mesa Final`, this.name, this.config,
      { tournamentId: this.id, onPlayersEliminated: (eliminations) => this.onEliminated(eliminations) },
    )
    this.tables.set(finalRoom.id, finalRoom)

    for (const tp of remaining) {
      const old = tp.tableId ? this.tables.get(tp.tableId) : null
      const send = old?.getSendFn(tp.id); if (!send) continue
      const chips = old?.getPlayerMigrationChips(tp.id) ?? tp.chips
      old?.moveTournamentPlayer(tp.id)
      finalRoom.addTournamentPlayer(tp.id, tp.name, send, chips)
      tp.tableId = finalRoom.id; tp.tableName = finalRoom.name
      send({ type: 'tournament_table_assigned', roomId: finalRoom.id, roomName: finalRoom.name, config: finalRoom.config })
      send({ type: 'tournament_final_table', tableId: finalRoom.id })
    }

    for (const t of active) { t.destroy(); this.tables.delete(t.id) }
    finalRoom.startGame()
    this.onTablesChanged(this.tables)
    this.broadcastRanking()
  }

  private checkFinished(): void {
    const remaining = [...this.activePlayers.values()].filter(p => !p.eliminated)
    if (remaining.length !== 1) return
    remaining[0]!.rank = 1
    this.status = 'finished'
    this.broadcastAll({ type: 'tournament_finished', winnerId: remaining[0]!.id, winnerName: remaining[0]!.name })
    this.onFinished(this.id)
  }

  // ── Ranking ───────────────────────────────────────────────────────────────

  getRanking(): TournamentPlayer[] {
    for (const [tableId, room] of this.tables) {
      for (const tp of this.activePlayers.values()) {
        if (tp.tableId === tableId && !tp.eliminated) tp.chips = room.getPlayerChips(tp.id)
      }
    }
    return [...this.activePlayers.values()].sort((a, b) => {
      if (!a.eliminated && !b.eliminated) return b.chips - a.chips
      if (a.eliminated && b.eliminated)   return (a.rank ?? 999) - (b.rank ?? 999)
      return a.eliminated ? 1 : -1
    })
  }

  broadcastRanking(): void {
    const ranking = this.getRanking()
    for (const reg of this.registrations.values()) {
      reg.send({ type: 'tournament_ranking', players: ranking, status: this.status })
    }
  }

  private broadcastAll(msg: ServerMessage): void {
    for (const reg of this.registrations.values()) reg.send(msg)
  }

  getTableId(pid: string): string | null { return this.activePlayers.get(pid)?.tableId ?? null }

  get tableMap() { return this.tables }

  destroy(): void {
    if (this.startTimer)   clearTimeout(this.startTimer)
    if (this.blindTimer)   clearTimeout(this.blindTimer)
    if (this.rankingTimer) clearInterval(this.rankingTimer)
    for (const room of this.tables.values()) room.destroy()
  }
}

function generateId(): string { return Math.random().toString(36).slice(2, 10) }
