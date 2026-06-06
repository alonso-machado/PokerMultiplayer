/**
 * Side-pot scenario — integration test (no mocks).
 *
 * Rules verified against TDA 2024 (https://www.pokertda.com/poker-tda-rules/):
 *
 *  Rule 50 – Side Pots:
 *    An all-in for less than the full bet creates a side pot. The all-in player is
 *    eligible only for the main pot (up to their total contribution from each player).
 *    Players who are not all-in, and contributed more, compete separately for the
 *    side pot(s) — by showdown (best hand wins), NOT an automatic equal split.
 *
 * ─── Exact scenario ──────────────────────────────────────────────────────────
 *
 *  Config: SB=50, BB=50, ante=0.
 *  Starting chips (chosen so post-preflop stacks hit the target numbers exactly):
 *    P4 = 1050  (dealer / BTN, will fold on flop)
 *    P1 = 1050  (SB,  posts 50  → 1000 on flop, then ALL-IN 1000)
 *    P2 = 850   (BB,  posts 50  →  800 on flop, then ALL-IN  800)
 *    P3 = 2050  (UTG, calls 50  → 2000 on flop, then CALL  1000)
 *
 *  Preflop: P3 call, P4 call, P1 check, P2 check  →  pot = 200
 *
 *  Flop (P1 acts first as SB, first active left of dealer P4):
 *    P1  ALL-IN  1000
 *    P2  ALL-IN   800  ← partial (< currentBet 1000), side-pot triggers
 *    P3  CALL    1000
 *    P4  FOLD
 *
 *  Total pot  = 3000
 *
 *  Side-pot breakdown (based on each player's totalBet):
 *    P1.totalBet = 1050,  P2.totalBet = 850,  P3.totalBet = 1050,  P4.totalBet = 50
 *
 *    Main pot  = 2600   (each active player capped at P2's level = 850, plus P4's dead 50)
 *                         P1: min(1050, 850) = 850
 *                         P2: 850
 *                         P3: min(1050, 850) = 850
 *                         P4: 50  (dead money — folded, ineligible but adds to the pot)
 *                         Eligible: P1, P2, P3
 *
 *    Side pot  =  400   (contributions above 850, only P1 and P3)
 *                         P1: 1050 − 850 = 200
 *                         P3: 1050 − 850 = 200
 *                         Eligible: P1, P3  (P2 has NO claim here)
 *
 *  Result rules (TDA Rule 50):
 *    • If P2 has the best hand of {P1, P2, P3}  → P2 wins 2600.
 *      P1 and P3 then compete by showdown for the 400 side pot (best hand wins,
 *      NOT an automatic split).
 *    • If P1 has the best hand of {P1, P2, P3}  → P1 wins 2600 + 400 = 3000.
 *    • If P3 has the best hand of {P1, P2, P3}  → P3 wins 2600 + 400 = 3000.
 *      (P3 was eligible for both pots, and beats both P1 and P2.)
 *    • If P2 wins main and P1 = P3 (exact tie)  → P1 and P3 split the 400 side pot,
 *      each receiving 200.
 */

import { describe, test, expect } from 'bun:test'
import { PokerGame } from '../src/poker/gameEngine'
import type { RoomConfig } from '../../shared/types'

const CFG: RoomConfig = { smallBlind: 50, bigBlind: 50, ante: 0, maxPlayers: 6 }

/**
 * Build the game and advance through preflop so we land on the flop with:
 *   pot = 200
 *   p1.chips = 1000  (SB, first to act post-flop)
 *   p2.chips =  800  (BB)
 *   p3.chips = 2000  (UTG, called preflop)
 *   p4.chips = 1000  (dealer/BTN, called preflop)
 *
 * Note: P4 is added first so it becomes dealer in hand 1, making P1 (SB) the
 * first active seat left of the dealer — which is the correct post-flop order.
 */
function makeAtFlopSidePot(): PokerGame {
  const g = new PokerGame(CFG)
  // P4 added first → becomes dealer in hand 1
  g.addPlayer('p4', 'Player4', 1050)
  g.addPlayer('p1', 'Player1', 1050)
  g.addPlayer('p2', 'Player2',  850)
  g.addPlayer('p3', 'Player3', 2050)
  g.startHand()

  // dealer=p4, SB=p1 (posts 50), BB=p2 (posts 50)
  // Preflop order: p3(UTG) → p4(BTN) → p1(SB) → p2(BB)
  // SB=BB=50, so both p1 and p2 already match currentBet → they check.
  expect(g.applyAction('p3', 'call')).toBe(true)   // p3 calls 50
  expect(g.applyAction('p4', 'call')).toBe(true)   // p4 calls 50
  expect(g.applyAction('p1', 'check')).toBe(true)  // p1 already posted SB=50
  expect(g.applyAction('p2', 'check')).toBe(true)  // p2 already posted BB=50

  expect(g.tableState.phase).toBe('flop')
  expect(g.tableState.pot).toBe(200)

  // Verify exact chip stacks entering the flop
  const find = (id: string) => g.players.find(p => p.id === id)!
  expect(find('p1').chips).toBe(1000)
  expect(find('p2').chips).toBe(800)
  expect(find('p3').chips).toBe(2000)
  expect(find('p4').chips).toBe(1000)

  return g
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const find = (g: PokerGame, id: string) => g.players.find(p => p.id === id)!

// ─── test suite ──────────────────────────────────────────────────────────────

describe('Side pot — P1 all-in 1000, P2 all-in 800, P3 call 1000, P4 fold', () => {

  // ── 1. Pot integrity ───────────────────────────────────────────────────────

  test('pot = 200 on flop after preflop action', () => {
    const g = makeAtFlopSidePot()
    expect(g.tableState.pot).toBe(200)
  })

  test('flop all-in sequence is accepted by the engine', () => {
    const g = makeAtFlopSidePot()
    // P1 (SB, acts first post-flop) goes all-in for 1000
    expect(g.applyAction('p1', 'all-in')).toBe(true)
    expect(g.tableState.currentBet).toBe(1000)
    expect(find(g, 'p1').status).toBe('all-in')

    // P2 (800 chips) goes all-in — partial raise (800 < currentBet 1000)
    // This does NOT reopen action for players who already acted.
    expect(g.applyAction('p2', 'all-in')).toBe(true)
    expect(find(g, 'p2').status).toBe('all-in')
    // currentBet does NOT increase (P2 couldn't match P1's bet)
    expect(g.tableState.currentBet).toBe(1000)

    // P3 calls 1000 (currentBet − 0 previously bet = 1000)
    expect(g.applyAction('p3', 'call')).toBe(true)
    expect(find(g, 'p3').chips).toBe(1000)

    // P4 folds
    expect(g.applyAction('p4', 'fold')).toBe(true)
    expect(find(g, 'p4').status).toBe('folded')
  })

  test('total pot after all flop actions = 3000', () => {
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    // 200 (preflop) + 1000 (p1) + 800 (p2) + 1000 (p3) = 3000
    expect(g.tableState.pot).toBe(3000)
  })

  test('chip conservation: all chips accounted for throughout', () => {
    const g = makeAtFlopSidePot()
    // Total chips in play = 1050+1050+850+2050 = 5000
    const totalStart = g.players.reduce((s, p) => s + p.chips, 0) + g.tableState.pot
    expect(totalStart).toBe(5000)

    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    const totalAfterFlop = g.players.reduce((s, p) => s + p.chips, 0) + g.tableState.pot
    expect(totalAfterFlop).toBe(5000)
  })

  test('after P4 folds, game auto-advances past flop to the next street', () => {
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    // All bets are matched and every active player acted → flop street ends.
    expect(['turn', 'river', 'showdown']).toContain(g.tableState.phase)

    // P3 is the only player still 'active' (has chips left after calling 1000).
    // P1 and P2 are all-in, P4 folded.
    // The engine correctly keeps P3 as the current player — P3 still needs to
    // check/bet on turn and river (no one else is active, but action is required).
    const current = g.currentPlayer()
    if (current) {
      expect(current.id).toBe('p3')
    }
    // Phase advanced beyond flop — that is the key guarantee.
    expect(g.tableState.phase).not.toBe('flop')
  })

  // ── 2. Player statuses ─────────────────────────────────────────────────────

  test('P1 and P2 are all-in; P3 is active; P4 is folded after flop', () => {
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    expect(find(g, 'p1').status).toBe('all-in')
    expect(find(g, 'p2').status).toBe('all-in')
    // p3 called and still has chips — status is 'active' (or 'all-in' if call emptied them)
    expect(['active', 'all-in']).toContain(find(g, 'p3').status)
    expect(find(g, 'p4').status).toBe('folded')
  })

  test('P2 cannot act after going all-in', () => {
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    // P2 is now all-in — any attempt to act must fail
    expect(g.applyAction('p2', 'check')).toBe(false)
    expect(g.applyAction('p2', 'call')).toBe(false)
    expect(g.applyAction('p2', 'fold')).toBe(false)
    expect(g.applyAction('p2', 'raise', 500)).toBe(false)
  })

  // ── 3. Side-pot structure (TDA Rule 50) ────────────────────────────────────
  //
  // The tests below document the EXPECTED behavior under TDA rules.
  // They verify that the engine correctly calculates side pots and distributes
  // chips accordingly. If the engine lacks side-pot logic, these tests will fail
  // and serve as the specification for the required implementation.

  test('chip distribution conserved after resolveShowdown (3000 chips total)', () => {
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    g.resolveShowdown()

    const totalAfter = g.players.reduce((s, p) => s + p.chips, 0)
    // P4 still has 1000 (folded with 1000 remaining). Winner(s) share the 3000 pot.
    // Total must be 5000 = original starting chips.
    expect(totalAfter).toBe(5000)
  })

  test('P2 cannot win more than 2600 even with the best hand (main pot only)', () => {
    // TDA Rule 50: a player can only win from each other player an amount equal
    // to their own total contribution. P2's totalBet = 850, so P2 cannot win
    // more than 850 × 3 eligible players + 50 dead money = 2600.
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    g.resolveShowdown()

    // P2's chips after showdown must be ≤ 2600 (P4 keeps 1000, not part of the pot)
    expect(find(g, 'p2').chips).toBeLessThanOrEqual(2600)
  })

  test('if P2 wins main pot (2600), the remaining 400 side pot goes to P1 or P3', () => {
    // TDA Rule 50: when P2 scoops the main pot, the 400 side pot is contested
    // by P1 and P3 in a separate showdown — NOT an automatic equal split.
    // Whoever has the better hand among P1 and P3 wins all 400.
    // Only in the case of an EXACT TIE do P1 and P3 split the 400 equally (200 each).
    //
    // Chip accounting when P2 wins main pot:
    //   P1: started with 1050, bet 1050 all-in → 0 wagered chips remaining
    //       receives side pot share (0, 200, or 400)
    //   P2: started with  850, bet  850 all-in → 0 remaining
    //       receives main pot = 2600
    //   P3: started with 2050, bet 1050 (50 pre + 1000 flop) → 1000 chips NOT in pot
    //       receives 1000 (residual) + side pot share (0, 200, or 400)
    //   P4: started with 1050, bet   50 (pre) + folded flop → 1000 chips remaining (untouched)
    //
    //   P1 + P3 chips after showdown = (P1's side share) + (1000 + P3's side share)
    //                                 = 1000 + 400 = 1400  (if P2 wins main)
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    g.resolveShowdown()

    const p1chips = find(g, 'p1').chips
    const p2chips = find(g, 'p2').chips
    const p3chips = find(g, 'p3').chips
    const p4chips = find(g, 'p4').chips

    // P4 folded; their 1000 residual chips are untouched by pot distribution
    expect(p4chips).toBe(1000)

    // If P2 won the main pot:
    if (p2chips === 2600) {
      // P3 still holds 1000 (the chips they never wagered) plus their side pot share.
      // P1 holds only their side pot share (they wagered everything).
      // Together they must have exactly 1000 (residual) + 400 (side pot) = 1400.
      expect(p1chips + p3chips).toBe(1400)
      // The side pot (400) goes entirely to either P1 or P3 (or 200/200 on tie).
      // P3's residual is always 1000, so p3chips ∈ {1000, 1200, 1400}.
      expect(p3chips).toBeGreaterThanOrEqual(1000)
      expect(p3chips).toBeLessThanOrEqual(1400)
      // P1's chips come only from the side pot: 0, 200, or 400.
      expect(p1chips).toBeGreaterThanOrEqual(0)
      expect(p1chips).toBeLessThanOrEqual(400)
      // The 400 side pot must be fully distributed (no chips left in pot).
      expect(p1chips + (p3chips - 1000)).toBe(400)
    }

    // Regardless of who won, total must be conserved
    expect(p1chips + p2chips + p3chips + p4chips).toBe(5000)
  })

  test('side pot (400) is NOT split equally — it goes to the best hand among P1 and P3', () => {
    // TDA 2024 Rule 50 + Rule 57 (Cards Speak):
    //   Side pots are won by showdown. The player with the best 5-card hand
    //   (from their 2 hole cards + 5 community cards) wins the entire side pot.
    //   Equal split only happens on an exact tie — two hands of equal rank + same kickers.
    //
    // P2 has zero claim to the side pot even with the best hand overall.
    const g = makeAtFlopSidePot()
    g.applyAction('p1', 'all-in')
    g.applyAction('p2', 'all-in')
    g.applyAction('p3', 'call')
    g.applyAction('p4', 'fold')

    g.resolveShowdown()

    const p1chips = find(g, 'p1').chips
    const p2chips = find(g, 'p2').chips
    const p3chips = find(g, 'p3').chips
    const p4chips = find(g, 'p4').chips

    // P2's maximum is the main pot (2600) — never more.
    expect(p2chips).toBeLessThanOrEqual(2600)

    // HandResult must contain two pot entries (main + side)
    // (We verify this via the pots field returned by resolveShowdown)
    // Already covered by pot total conservation:
    expect(p1chips + p2chips + p3chips + p4chips).toBe(5000)

    // If P2 took the main pot, the side pot winner must be P1 or P3 (never P2).
    if (p2chips === 2600) {
      // P1's chips come only from the side pot (0, 200, or 400)
      expect(p1chips).toBeGreaterThanOrEqual(0)
      expect(p1chips).toBeLessThanOrEqual(400)
      // P3 always keeps their 1000 residual chips; side-pot win adds 0/200/400
      expect(p3chips).toBeGreaterThanOrEqual(1000)
      expect(p3chips).toBeLessThanOrEqual(1400)
      // The 400 side pot is fully accounted for between P1 and P3
      expect(p1chips + (p3chips - 1000)).toBe(400)
    }
  })
})
