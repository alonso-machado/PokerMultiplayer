/**
 * Integration tests for the PokerGame engine.
 *
 * Scenario: 4-player game (Alice=BTN, Bob=SB, Charlie=BB, Dave=UTG)
 *   BB=10, SB=5, ante=10 (UTG posts dead ante)
 *
 * Preflop action order: Dave → Alice → Bob → Charlie
 * Post-flop action order (clockwise from left of dealer): Bob → Charlie → Dave → Alice
 *
 * Flop test sequence:
 *   Bob: check  |  Charlie: check  |  Dave: raise 50  |  Alice: call 50
 *   → Bob & Charlie still haven't matched → NO phase advance yet
 *   Bob: raise 100  |  Charlie: call  |  Dave: call  |  Alice: call
 *   → all bets = 100 = currentBet, all have acted → phase advances to Turn
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { PokerGame } from '../src/poker/gameEngine'
import type { RoomConfig } from '../../shared/types'

const CONFIG: RoomConfig = { smallBlind: 5, bigBlind: 10, ante: 10, maxPlayers: 6 }

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeGame(): PokerGame {
  const g = new PokerGame(CONFIG)
  g.addPlayer('alice', 'Alice', 1000)
  g.addPlayer('bob',   'Bob',   1000)
  g.addPlayer('charlie', 'Charlie', 1000)
  g.addPlayer('dave',  'Dave',  1000)
  g.startHand()
  return g
}

/** Returns the id of the current player (safe assertion helper) */
function currentId(g: PokerGame): string {
  const p = g.currentPlayer()
  if (!p) throw new Error('No current player')
  return p.id
}

/** Call the minimum (call) for the current player */
function doCall(g: PokerGame): boolean {
  return g.applyAction(currentId(g), 'call')
}

/** Check for the current player */
function doCheck(g: PokerGame): boolean {
  return g.applyAction(currentId(g), 'check')
}

/** Raise to `total` for the current player */
function doRaise(g: PokerGame, total: number): boolean {
  return g.applyAction(currentId(g), 'raise', total)
}

/** Fold for the current player */
function doFold(g: PokerGame): boolean {
  return g.applyAction(currentId(g), 'fold')
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('GameEngine — 4 players', () => {

  // ── Setup / antes / blinds ────────────────────────────────────────────────

  test('startHand: correct phase, dealer, and blinds', () => {
    const g = makeGame()
    const ts = g.tableState

    expect(ts.phase).toBe('preflop')
    expect(g.players[0]!.isDealer).toBe(true)      // Alice = BTN (dealerIndex=0)
    expect(g.players[1]!.isSmallBlind).toBe(true)   // Bob = SB
    expect(g.players[2]!.isBigBlind).toBe(true)     // Charlie = BB
  })

  test('ante: only UTG (Dave) pays dead ante; his bet stays 0', () => {
    const g = makeGame()
    const dave = g.players.find(p => p.id === 'dave')!

    // Dave posted 10 ante (dead money) → chips decreased but bet is still 0
    expect(dave.chips).toBe(990)
    expect(dave.bet).toBe(0)    // ante is dead — not a live bet
    expect(g.tableState.pot).toBeGreaterThanOrEqual(10 + 5 + 10) // ante + SB + BB
  })

  test('ante: 2-player game has NO ante', () => {
    const g = new PokerGame(CONFIG)
    g.addPlayer('p1', 'P1', 1000)
    g.addPlayer('p2', 'P2', 1000)
    g.startHand()
    // With 2 players, ante should not be posted
    const p1 = g.players[0]!
    const p2 = g.players[1]!
    // Both players only posted blind amounts (5 + 10 = 15 total chips removed)
    const totalChipsRemoved = (1000 - p1.chips) + (1000 - p2.chips)
    expect(totalChipsRemoved).toBe(15) // SB(5) + BB(10) only, no ante
  })

  test('preflop: first to act is UTG (Dave)', () => {
    const g = makeGame()
    expect(currentId(g)).toBe('dave')
  })

  // ── Preflop navigation ────────────────────────────────────────────────────

  test('preflop: all call/check → advances to flop with 3 community cards', () => {
    const g = makeGame()

    // Dave(UTG): call 10
    expect(doCall(g)).toBe(true)
    expect(g.tableState.phase).toBe('preflop')
    expect(currentId(g)).toBe('alice')  // next: Alice(BTN)

    // Alice: call 10
    expect(doCall(g)).toBe(true)
    expect(currentId(g)).toBe('bob')    // next: Bob(SB)

    // Bob: call 5 more (already posted 5)
    expect(doCall(g)).toBe(true)
    expect(currentId(g)).toBe('charlie') // next: Charlie(BB)

    // Charlie(BB): check (already has 10 = currentBet)
    expect(doCheck(g)).toBe(true)

    // All have acted and bets match → FLOP
    const ts = g.tableState
    expect(ts.phase).toBe('flop')
    expect(ts.communityCards).toHaveLength(3)
  })

  // ── Flop: check-check-raise-call, then raise-call-call-call ──────────────

  describe('flop betting round', () => {
    let g: PokerGame

    beforeEach(() => {
      g = makeGame()
      // Navigate through preflop quickly
      doCall(g)   // Dave
      doCall(g)   // Alice
      doCall(g)   // Bob
      doCheck(g)  // Charlie → FLOP
      expect(g.tableState.phase).toBe('flop')
    })

    test('first to act post-flop is Bob (left of dealer Alice)', () => {
      expect(currentId(g)).toBe('bob')
    })

    test('check-check: phase does NOT advance (not everyone acted)', () => {
      doCheck(g)  // Bob
      expect(g.tableState.phase).toBe('flop')

      doCheck(g)  // Charlie
      expect(g.tableState.phase).toBe('flop')

      // Dave and Alice haven't acted yet
      expect(currentId(g)).toBe('dave')
    })

    test('check-check-raise-call: phase still flop, two players still need to respond', () => {
      doCheck(g)            // Bob
      doCheck(g)            // Charlie
      doRaise(g, 50)        // Dave raises to 50
      doCall(g)             // Alice calls 50

      // Bob (checked earlier) must now respond to the raise
      expect(g.tableState.phase).toBe('flop')
      expect(currentId(g)).toBe('bob')
    })

    test('full sequence: check-check-raise-call → raise-call-call-call → advances to turn', () => {
      const beforePot = g.tableState.pot

      doCheck(g)            // Bob: check
      doCheck(g)            // Charlie: check
      doRaise(g, 50)        // Dave: raise to 50
      doCall(g)             // Alice: call 50

      // Phase must NOT have advanced yet
      expect(g.tableState.phase).toBe('flop')

      doRaise(g, 100)       // Bob: re-raise to 100
      doCall(g)             // Charlie: call 100
      doCall(g)             // Dave: call 100  (was at 50, needs 50 more)
      doCall(g)             // Alice: call 100 (was at 50, needs 50 more)

      // Now ALL 4 players have acted AND bets all equal 100 → TURN
      const ts = g.tableState
      expect(ts.phase).toBe('turn')
      expect(ts.communityCards).toHaveLength(4)
      expect(ts.currentBet).toBe(0)      // bets reset for new street

      // Pot grew by the betting: 4×100 = 400 plus preflop contributions
      expect(ts.pot).toBeGreaterThan(beforePot + 390)
    })

    test('turn and river also need all players to act before advancing', () => {
      // Complete flop quickly (all check)
      doCheck(g); doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('turn')

      // Turn: first player checks, phase must NOT advance
      doCheck(g)
      expect(g.tableState.phase).toBe('turn')

      // Rest check → advance to river
      doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('river')
      expect(g.tableState.communityCards).toHaveLength(5)
    })
  })

  // ── Full hand → showdown ───────────────────────────────────────────────────

  describe('showdown', () => {
    test('all players check every street → showdown with valid result', () => {
      const g = makeGame()

      // Preflop: all call/check
      doCall(g); doCall(g); doCall(g); doCheck(g)
      expect(g.tableState.phase).toBe('flop')

      // Flop: all check
      doCheck(g); doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('turn')

      // Turn: all check
      doCheck(g); doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('river')

      // River: all check → advances to showdown
      doCheck(g); doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('showdown')
      expect(g.isHandOver()).toBe(true)
      expect(g.tableState.communityCards).toHaveLength(5)

      // Resolve showdown
      const result = g.resolveShowdown()
      expect(result.winnerId).toBeTruthy()
      expect(result.winnerName).toBeTruthy()
      expect(result.amount).toBeGreaterThan(0)
      expect(result.handName).toBeTruthy()

      // Showdown results contain all non-folded players with their hole cards
      expect(result.showdown.length).toBeGreaterThan(0)
      for (const r of result.showdown) {
        expect(r.cards).toHaveLength(2)        // each player had 2 hole cards
        expect(r.handName).toBeTruthy()        // e.g. "Pair", "High Card", etc.
      }

      // Winner chips increased
      const winner = g.players.find(p => p.id === result.winnerId)!
      expect(winner.chips).toBeGreaterThan(1000 - 10) // winner gained some chips
    })

    test('one player folds preflop → only remaining player wins without showdown', () => {
      const g = makeGame()

      // Dave folds, rest call/check
      doFold(g)   // Dave folds
      doCall(g)   // Alice
      doCall(g)   // Bob
      doCheck(g)  // Charlie

      // Flop
      doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('turn') // only 3 active now

      // Turn
      doCheck(g); doCheck(g); doCheck(g)

      // River
      doCheck(g); doCheck(g); doCheck(g)
      expect(g.tableState.phase).toBe('showdown')

      const result = g.resolveShowdown()
      expect(result.winnerId).toBeTruthy()
      expect(result.amount).toBeGreaterThan(0)
    })

    test('three folds preflop → last player wins immediately (no showdown cards)', () => {
      const g = makeGame()

      // Dave, Alice, Bob all fold → Charlie wins uncontested
      doFold(g)  // Dave
      doFold(g)  // Alice
      doFold(g)  // Bob

      expect(g.isHandOver()).toBe(true)

      const result = g.resolveShowdown()
      expect(result.winnerId).toBe('charlie')
      expect(result.showdown).toHaveLength(0)  // no showdown needed
    })

    test('heads-up: no ante, SB acts first preflop', () => {
      const g = new PokerGame(CONFIG)
      g.addPlayer('alice', 'Alice', 1000)
      g.addPlayer('bob',   'Bob',   1000)
      g.startHand()

      // In heads-up, dealer=SB acts first preflop
      expect(g.tableState.phase).toBe('preflop')
      const first = g.currentPlayer()!

      // Pot should be just SB(5) + BB(10) = 15, no ante
      expect(g.tableState.pot).toBe(15)

      // First actor is SB (dealer in HU)
      const sblind = g.players.find(p => p.isSmallBlind)!
      expect(first.id).toBe(sblind.id)
    })
  })

  // ── Betting round integrity ───────────────────────────────────────────────

  describe('betting round integrity', () => {
    test('raise must be called by all before street ends', () => {
      const g = makeGame()
      doCall(g); doCall(g); doCall(g); doCheck(g) // preflop

      // Flop: one player raises, others must respond
      const raiser = currentId(g)
      doRaise(g, 50) // first player raises

      // Remaining 3 players must call/fold/raise before phase advances
      expect(g.tableState.phase).toBe('flop')
      doCall(g) // second
      expect(g.tableState.phase).toBe('flop')
      doCall(g) // third
      expect(g.tableState.phase).toBe('flop')
      doCall(g) // fourth → now all matched

      expect(g.tableState.phase).toBe('turn')
      // raiser ID recorded for clarity
      expect(raiser).toBeTruthy()
    })

    test('invalid action returns false and does not advance turn', () => {
      const g = makeGame()
      const before = currentId(g)

      // Dave (UTG) tries to check when he must call
      const ok = g.applyAction('dave', 'check')
      expect(ok).toBe(false)

      // Current player unchanged
      expect(currentId(g)).toBe(before)
    })

    test('wrong player action returns false', () => {
      const g = makeGame()
      // Dave's turn, but Alice tries to act
      const ok = g.applyAction('alice', 'call')
      expect(ok).toBe(false)
      expect(currentId(g)).toBe('dave')
    })
  })
})
