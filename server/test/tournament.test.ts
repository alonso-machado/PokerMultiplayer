/**
 * Tournament integration tests — table assignment ordering and full
 * multi-table all-in playthroughs.
 *
 * Regression covered by the first test: `tournament_table_assigned` must
 * reach the client BEFORE `hand_dealt`/`your_turn` for the first hand.
 * The front switches to the table view on `tournament_table_assigned`,
 * resetting cards/turn/table state — if the first hand's messages arrived
 * first, that reset wiped them out and players saw an empty table with no
 * pot, no cards, and no actions available.
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { Tournament } from '../src/tournament'
import type { ServerMessage, RoomConfig } from '../../shared/types'
import { startingChipsFor } from '../../shared/types'

const CFG: RoomConfig = { smallBlind: 5, bigBlind: 10, ante: 0, maxPlayers: 6 }
const STARTING_CHIPS = startingChipsFor(CFG)

function makeRecorder() {
  const messages: ServerMessage[] = []
  return { send: (m: ServerMessage) => { messages.push(m) }, messages }
}

function makePlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`, name: `Player${i + 1}`, ...makeRecorder(),
  }))
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Drive every table to showdown by pushing all-in for whoever is to act,
 *  repeating hands until the tournament finishes (or maxIters is hit). */
async function playAllInUntilFinished(tournament: Tournament, maxIters = 1000) {
  for (let i = 0; i < maxIters; i++) {
    if (tournament.status === 'finished') return
    let acted = false
    for (const room of [...tournament.tableMap.values()]) {
      const current = room.game.currentPlayer()
      if (current) { room.handleAction(current.id, 'all-in'); acted = true }
    }
    if (!acted) await sleep(15)
  }
  throw new Error('tournament did not finish within maxIters')
}

let tournament: Tournament | null = null
afterEach(() => { tournament?.destroy(); tournament = null })

describe('Tournament — start sequencing', () => {
  test('tournament_table_assigned arrives before the first hand_dealt, with cards and a non-zero pot', () => {
    const players = makePlayers(10)
    tournament = new Tournament('t-seq', { name: 'Seq', scheduledStart: new Date(), config: CFG }, () => {}, () => {})
    for (const p of players) tournament.register(p.id, p.name, p.send, `tok-${p.id}`)

    tournament.start()

    for (const p of players) {
      const types = p.messages.map(m => m.type)
      const assignedIdx = types.indexOf('tournament_table_assigned')
      const dealtIdx    = types.indexOf('hand_dealt')

      expect(assignedIdx).toBeGreaterThanOrEqual(0)
      expect(dealtIdx).toBeGreaterThanOrEqual(0)
      expect(assignedIdx).toBeLessThan(dealtIdx)

      const handDealt = p.messages.find(m => m.type === 'hand_dealt') as Extract<ServerMessage, { type: 'hand_dealt' }>
      expect(handDealt.yourCards).toHaveLength(2)
      expect(handDealt.tableState.pot).toBeGreaterThan(0)
    }
  })
})

describe('Tournament — 10-player multi-table all-in playthrough', () => {
  test('plays down to a final table and a single winner with a complete, consistent ranking', async () => {
    const players = makePlayers(10)
    tournament = new Tournament('t-allin', { name: 'AllIn', scheduledStart: new Date(), config: CFG }, () => {}, () => {})
    for (const p of players) tournament.register(p.id, p.name, p.send, `tok-${p.id}`)

    tournament.start()

    // Two ~5-player tables to start
    expect(tournament.tableMap.size).toBe(2)
    for (const room of tournament.tableMap.values()) {
      expect(room.playerCount).toBeGreaterThanOrEqual(2)
    }

    await playAllInUntilFinished(tournament)

    expect(tournament.status).toBe('finished')

    // A final-table transition must have happened with multiple source tables
    expect(players.some(p => p.messages.some(m => m.type === 'tournament_final_table'))).toBe(true)

    // tournament_finished broadcast to everyone
    for (const p of players) {
      expect(p.messages.some(m => m.type === 'tournament_finished')).toBe(true)
    }

    const ranking = tournament.getRanking()
    expect(ranking).toHaveLength(10)

    // Every rank from 1..10 assigned exactly once
    const ranks = ranking.map(r => r.rank).sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    // Exactly one winner, holding all the chips; everyone else eliminated with 0 chips
    const winner = ranking.find(r => r.rank === 1)!
    expect(winner.eliminated).toBe(false)
    expect(winner.chips).toBe(STARTING_CHIPS * 10)

    const others = ranking.filter(r => r.rank !== 1)
    expect(others).toHaveLength(9)
    for (const r of others) {
      expect(r.eliminated).toBe(true)
      expect(r.chips).toBe(0)
    }

    // tournament_finished names the actual winner
    const finishedMsg = players[0]!.messages.find(m => m.type === 'tournament_finished') as Extract<ServerMessage, { type: 'tournament_finished' }>
    expect(finishedMsg.winnerId).toBe(winner.id)
  }, 20000)
})

describe('Tournament — same-hand elimination tie-break', () => {
  test('players busted in the same hand are ranked by totalBet, higher totalBet ranked better', () => {
    const players = makePlayers(4)
    tournament = new Tournament('t-tiebreak', { name: 'TieBreak', scheduledStart: new Date(), config: CFG }, () => {}, () => {})
    for (const p of players) tournament.register(p.id, p.name, p.send, `tok-${p.id}`)

    tournament.start()

    // Simulate a single hand busting 3 of the 4 players at once, with
    // distinct totalBet amounts. Lower totalBet -> worse rank (assigned
    // first); higher totalBet -> better rank among the bustouts.
    ;(tournament as any).onEliminated([
      { playerId: 'p1', totalBet: 50 },
      { playerId: 'p2', totalBet: 150 },
      { playerId: 'p3', totalBet: 100 },
    ])

    const ranking = tournament.getRanking()
    const byId = new Map(ranking.map(r => [r.id, r]))

    expect(byId.get('p1')!.rank).toBe(4) // lowest totalBet -> worst rank
    expect(byId.get('p3')!.rank).toBe(3)
    expect(byId.get('p2')!.rank).toBe(2) // highest totalBet -> best rank among bustouts
    expect(byId.get('p4')!.rank).toBe(1) // sole survivor -> winner

    // All four busted players (and the survivor) share the same eliminatedAt
    // batch timestamp for p1/p2/p3
    const elimTimes = ['p1', 'p2', 'p3'].map(id => byId.get(id)!.eliminatedAt)
    expect(new Set(elimTimes).size).toBe(1)

    expect(tournament.status).toBe('finished')
  })
})

describe('Tournament — re-registration for a new tournament', () => {
  test('a token from a finished tournament does not carry over; the player must register again', () => {
    const player = makePlayers(1)[0]!

    // Tournament A: register and finish it.
    const tournamentA = new Tournament('t-a', { name: 'A', scheduledStart: new Date(), config: CFG }, () => {}, () => {})
    const tokenA = 'token-a'
    tournamentA.register(player.id, player.name, player.send, tokenA)
    expect(tournamentA.isRegistered(player.id)).toBe(true)
    expect(tournamentA.findByToken(tokenA)?.playerId).toBe(player.id)
    tournamentA.destroy()

    // Tournament B: a brand new instance — the old token must not resolve here,
    // and the player is not registered until they register again.
    tournament = new Tournament('t-b', { name: 'B', scheduledStart: new Date(), config: CFG }, () => {}, () => {})
    expect(tournament.findByToken(tokenA)).toBeUndefined()
    expect(tournament.isRegistered(player.id)).toBe(false)

    // Registering again (with a fresh token) for tournament B works.
    const tokenB = 'token-b'
    expect(tournament.register(player.id, player.name, player.send, tokenB)).toBe(true)
    expect(tournament.isRegistered(player.id)).toBe(true)
    expect(tournament.findByToken(tokenB)?.playerId).toBe(player.id)
  })
})
