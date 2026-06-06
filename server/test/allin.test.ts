/**
 * All-in betting rules — integration tests (no mocks).
 *
 * Rules verified against TDA 2024 (https://www.pokertda.com/poker-tda-rules/):
 *
 *  1. A raise must be at least the size of the largest previous raise in the same street.
 *  2. An all-in for LESS than the minimum raise is a legal bet but does NOT reopen
 *     action for players who have already acted — they may only call or fold.
 *  3. An all-in that IS a full raise (≥ minRaise) DOES reopen action for everyone.
 *  4. A player who faces a bet/all-in with toCall > 0 may NOT check.
 *  5. The sole remaining active player must settle their bet before the phase advances,
 *     even if all other players are all-in.
 *
 * Setup: 3 players (Alice=dealer/UTG, Bob=SB, Charlie=BB), no ante, BB=10.
 * Preflop order : Alice → Bob → Charlie
 * Flop order    : Bob → Charlie → Alice   (first active left of dealer)
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { PokerGame } from '../src/poker/gameEngine'
import type { RoomConfig } from '../../shared/types'

// No ante to keep chip math simple
const CFG: RoomConfig = { smallBlind: 5, bigBlind: 10, ante: 0, maxPlayers: 6 }

// ─── helpers ─────────────────────────────────────────────────────────────────

function currentId(g: PokerGame): string {
  const p = g.currentPlayer()
  if (!p) throw new Error('No current player — hand may be over')
  return p.id
}

/**
 * Build a 3-player game and advance through preflop (everyone calls/checks)
 * so the next action is on the Flop.
 * Optional chip overrides per player.
 */
function makeAtFlop(chips: { alice?: number; bob?: number; charlie?: number } = {}): PokerGame {
  const g = new PokerGame(CFG)
  g.addPlayer('alice',   'Alice',   chips.alice   ?? 1000)
  g.addPlayer('bob',     'Bob',     chips.bob     ?? 1000)
  g.addPlayer('charlie', 'Charlie', chips.charlie ?? 1000)
  g.startHand()

  // Preflop: Alice(UTG) calls 10, Bob(SB) calls 5 more, Charlie(BB) checks
  expect(g.applyAction('alice',   'call')).toBe(true)
  expect(g.applyAction('bob',     'call')).toBe(true)
  expect(g.applyAction('charlie', 'check')).toBe(true)

  expect(g.tableState.phase).toBe('flop')
  return g
}

// ─── test suites ─────────────────────────────────────────────────────────────

describe('All-in rules — raise validation', () => {

  test('raise below currentBet+minRaise is rejected', () => {
    const g = makeAtFlop()

    // Bob bets 100 on flop — minRaise becomes 100, currentBet becomes 100
    expect(g.applyAction('bob', 'raise', 100)).toBe(true)
    expect(g.tableState.currentBet).toBe(100)
    expect(g.tableState.minRaise).toBe(100)

    // Charlie tries raises that are too small (must reach at least 200)
    expect(g.applyAction('charlie', 'raise', 99)).toBe(false)   // below currentBet
    expect(g.applyAction('charlie', 'raise', 100)).toBe(false)  // equals currentBet, not a raise
    expect(g.applyAction('charlie', 'raise', 150)).toBe(false)  // less than minRaise increment
    expect(g.applyAction('charlie', 'raise', 199)).toBe(false)  // one short of min

    // Exactly minimum raise (100 + 100 = 200) is accepted
    expect(g.applyAction('charlie', 'raise', 200)).toBe(true)
    expect(g.tableState.currentBet).toBe(200)
  })

  test('raise must be at least the size of the previous raise', () => {
    const g = makeAtFlop()

    // Bob raises to 50 (raise of 50 over 0 — initial minRaise is bigBlind=10, so 50 is valid)
    expect(g.applyAction('bob', 'raise', 50)).toBe(true)
    expect(g.tableState.minRaise).toBe(50)

    // Charlie re-raises to 80 — that's only 30 more, which is less than the 50 minRaise
    expect(g.applyAction('charlie', 'raise', 80)).toBe(false)

    // Charlie must raise by at least 50 more: 50 + 50 = 100
    expect(g.applyAction('charlie', 'raise', 100)).toBe(true)
    expect(g.tableState.currentBet).toBe(100)
    expect(g.tableState.minRaise).toBe(50) // minRaise = 100 - 50 = 50
  })
})

describe('All-in rules — partial all-in (< minRaise) does NOT reopen action', () => {
  let g: PokerGame

  beforeEach(() => {
    // Give Charlie only 150 chips so his all-in (140 after paying BB) is a partial raise
    // Bob bets 100, minRaise=100. Charlie all-in for 140 → raises by 40 < 100 → partial.
    g = makeAtFlop({ charlie: 150 })
    // At flop: Alice=990, Bob=990, Charlie=140

    // Bob bets 100 → currentBet=100, minRaise=100, actedThisStreet={bob}
    expect(g.applyAction('bob', 'raise', 100)).toBe(true)
    expect(g.tableState.currentBet).toBe(100)

    // Charlie calls... no, Charlie goes all-in for 140 (partial raise of 40)
    expect(currentId(g)).toBe('charlie')
    expect(g.applyAction('charlie', 'all-in')).toBe(true)

    // Charlie is now all-in; bet=140 raised currentBet from 100→140 (partial raise by 40 < minRaise 100)
    expect(g.tableState.currentBet).toBe(140)
    expect(g.tableState.phase).toBe('flop') // hand not over yet
  })

  test('player who already called (Bob) cannot re-raise after partial all-in', () => {
    // Alice (hasn't acted yet) must act first — skip to Bob's turn
    expect(currentId(g)).toBe('alice')
    expect(g.applyAction('alice', 'call')).toBe(true) // Alice calls 140

    // Now Bob's turn — he's in noReraiseIds
    expect(currentId(g)).toBe('bob')
    const { actions } = g.validActions(g.players.find(p => p.id === 'bob')!)
    expect(actions).not.toContain('raise')
  })

  test('raise action for Bob is rejected by the server after partial all-in', () => {
    // Alice calls to pass to Bob
    g.applyAction('alice', 'call')

    expect(currentId(g)).toBe('bob')
    // Bob tries to raise to 300 — server must reject it
    const ok = g.applyAction('bob', 'raise', 300)
    expect(ok).toBe(false)
    // currentBet unchanged
    expect(g.tableState.currentBet).toBe(140)
  })

  test('player who has NOT yet acted (Alice) CAN raise after partial all-in', () => {
    expect(currentId(g)).toBe('alice')
    const { actions } = g.validActions(g.players.find(p => p.id === 'alice')!)
    expect(actions).toContain('raise')

    // Alice raises to 300 — she was never in noReraiseIds
    expect(g.applyAction('alice', 'raise', 300)).toBe(true)
    expect(g.tableState.currentBet).toBe(300)
  })

  test('Bob can still call the partial raise amount', () => {
    g.applyAction('alice', 'call')

    expect(currentId(g)).toBe('bob')
    const { actions, callAmount } = g.validActions(g.players.find(p => p.id === 'bob')!)
    expect(actions).toContain('call')
    expect(callAmount).toBe(40) // Bob put in 100, currentBet=140, owes 40 more
    expect(g.applyAction('bob', 'call')).toBe(true)
  })
})

describe('All-in rules — full all-in (≥ minRaise) reopens action', () => {

  test('full all-in reopens action: player who already called CAN re-raise', () => {
    // Give Alice 350 chips so her all-in (340 on flop) is a full raise (340-100=240 >= minRaise 100)
    // and toCall for Bob (890 chips) is small enough that he has chips left to raise
    const g = makeAtFlop({ alice: 350 })
    // At flop: Alice=340, Bob=990, Charlie=990

    // Bob bets 100 → minRaise=100, actedThisStreet={bob}
    expect(g.applyAction('bob', 'raise', 100)).toBe(true)

    // Charlie calls 100 → actedThisStreet={bob, charlie}
    expect(g.applyAction('charlie', 'call')).toBe(true)

    // Alice goes all-in for 340 chips (raises by 240 >= minRaise 100) — FULL raise
    expect(currentId(g)).toBe('alice')
    expect(g.applyAction('alice', 'all-in')).toBe(true)
    expect(g.tableState.currentBet).toBe(340)

    // Bob's turn — noReraiseIds was cleared by Alice's full raise
    expect(currentId(g)).toBe('bob')
    const { actions: bobActions } = g.validActions(g.players.find(p => p.id === 'bob')!)
    expect(bobActions).toContain('raise')

    // Bob re-raises to 340+240=580 (minimum re-raise)
    expect(g.applyAction('bob', 'raise', 580)).toBe(true)
    expect(g.tableState.currentBet).toBe(580)
  })

  test('full all-in: minRaise updates to the raise amount', () => {
    const g = makeAtFlop()

    // Bob bets 100, minRaise=100
    expect(g.applyAction('bob', 'raise', 100)).toBe(true)
    expect(g.tableState.minRaise).toBe(100)

    // Charlie goes all-in for 990 chips (raise of 890 >= 100) — full raise
    expect(g.applyAction('charlie', 'all-in')).toBe(true)
    // minRaise should update to the raise amount: 990-100=890
    expect(g.tableState.minRaise).toBe(890)
  })
})

describe('All-in rules — check not available when facing a bet', () => {

  test('check is not in validActions when toCall > 0 after all-in', () => {
    const g = makeAtFlop()

    // Bob goes all-in immediately on flop
    expect(g.applyAction('bob', 'all-in')).toBe(true)
    expect(g.tableState.currentBet).toBeGreaterThan(0)

    // Charlie is next — must call or fold, cannot check
    expect(currentId(g)).toBe('charlie')
    const { actions } = g.validActions(g.players.find(p => p.id === 'charlie')!)
    expect(actions).not.toContain('check')
    expect(actions).toContain('call')
    expect(actions).toContain('fold')
  })

  test('check action returns false when player has a bet to call', () => {
    const g = makeAtFlop()

    g.applyAction('bob', 'all-in')

    // Charlie tries to check — server rejects it
    expect(g.applyAction('charlie', 'check')).toBe(false)
    // Turn did not advance
    expect(currentId(g)).toBe('charlie')
  })
})

describe('All-in rules — sole active player must act before phase advances', () => {

  test('phase stays on flop until last active player responds to all-in', () => {
    const g = makeAtFlop()

    // Bob goes all-in
    expect(g.applyAction('bob', 'all-in')).toBe(true)

    // Charlie folds — now only Alice is active
    expect(g.applyAction('charlie', 'fold')).toBe(true)

    // Phase must NOT have advanced — Alice still needs to call or fold
    expect(g.tableState.phase).toBe('flop')
    expect(currentId(g)).toBe('alice')
    const { actions } = g.validActions(g.players.find(p => p.id === 'alice')!)
    expect(actions).not.toContain('check') // toCall > 0
    expect(actions).toContain('call')
    expect(actions).toContain('fold')
  })

  test('phase advances to turn after last active player calls the all-in', () => {
    const g = makeAtFlop()

    g.applyAction('bob',     'all-in')
    g.applyAction('charlie', 'fold')

    // Alice calls — now canAct=[] (Bob all-in, Charlie folded, Alice just called→all-in or matched)
    expect(g.applyAction('alice', 'call')).toBe(true)

    // Phase should have advanced (or gone to showdown if Alice's call put her all-in)
    expect(['turn', 'river', 'showdown']).toContain(g.tableState.phase)
  })

  test('phase advances to turn after last active player folds to all-in', () => {
    const g = makeAtFlop()

    g.applyAction('bob',     'all-in')
    g.applyAction('charlie', 'fold')

    // Alice folds — only Bob remains, wins immediately
    expect(g.applyAction('alice', 'fold')).toBe(true)
    expect(g.isHandOver()).toBe(true)
  })

  test('three-way: two all-ins then last active must still act', () => {
    const g = makeAtFlop()

    // Bob and Charlie both go all-in
    expect(g.applyAction('bob',     'all-in')).toBe(true)
    expect(g.applyAction('charlie', 'all-in')).toBe(true)

    // Alice (active) must still settle — phase should not have advanced
    expect(g.tableState.phase).toBe('flop')
    expect(currentId(g)).toBe('alice')

    // Alice calls → canAct=0 → auto-advance
    g.applyAction('alice', 'call')
    expect(['turn', 'river', 'showdown']).toContain(g.tableState.phase)
  })
})

describe('All-in rules — pot integrity', () => {

  test('all-in chips land in pot immediately', () => {
    const g = makeAtFlop()
    const potBefore = g.tableState.pot

    const bob = g.players.find(p => p.id === 'bob')!
    const chipsBefore = bob.chips

    g.applyAction('bob', 'all-in')

    expect(g.tableState.pot).toBe(potBefore + chipsBefore)
    expect(g.players.find(p => p.id === 'bob')!.chips).toBe(0)
  })

  test('all-in player status becomes all-in', () => {
    const g = makeAtFlop()
    g.applyAction('bob', 'all-in')
    expect(g.players.find(p => p.id === 'bob')!.status).toBe('all-in')
  })

  test('all-in player cannot act again', () => {
    const g = makeAtFlop()
    g.applyAction('bob', 'all-in')

    // Bob is now all-in — any action attempt by Bob must fail
    expect(g.applyAction('bob', 'check')).toBe(false)
    expect(g.applyAction('bob', 'call')).toBe(false)
    expect(g.applyAction('bob', 'fold')).toBe(false)
    expect(g.applyAction('bob', 'raise', 500)).toBe(false)
  })

  test('when all players are all-in phase auto-advances without waiting for action', () => {
    const g = makeAtFlop()

    g.applyAction('bob',     'all-in')
    g.applyAction('charlie', 'all-in')
    g.applyAction('alice',   'all-in') // everyone all-in → canAct=0

    // Should have auto-advanced past flop
    expect(['turn', 'river', 'showdown']).toContain(g.tableState.phase)
    // No current player (no one can act)
    expect(g.currentPlayer()).toBeUndefined()
  })
})
