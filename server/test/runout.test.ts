/**
 * Run-it-out tests — verifies that when all players are all-in, ALL 5 community
 * cards are dealt before resolveShowdown is called.
 *
 * Bug caught: advanceTurn was calling advancePhase() only once, so a hand that
 * had a pair formed by a community card dealt on turn/river could be evaluated
 * as "high card" because those cards were never dealt into _communityCards.
 */

import { describe, test, expect } from 'bun:test'
import { PokerGame } from '../src/poker/gameEngine'
import type { RoomConfig } from '../../shared/types'

const CFG: RoomConfig = { smallBlind: 5, bigBlind: 10, ante: 0, maxPlayers: 6 }

describe('Run-it-out — all community cards dealt when everyone is all-in', () => {

  test('preflop all-in: 5 community cards present at showdown', () => {
    const g = new PokerGame(CFG)
    g.addPlayer('alice', 'Alice', 100)
    g.addPlayer('bob',   'Bob',   100)
    g.startHand()

    // Both go all-in preflop
    const first = g.currentPlayer()!.id
    expect(g.applyAction(first,   'all-in')).toBe(true)
    const second = first === 'alice' ? 'bob' : 'alice'
    expect(g.applyAction(second, 'all-in')).toBe(true)  // or call, doesn't matter

    // Game should have run out all community cards automatically
    expect(g.tableState.phase).toBe('showdown')
    expect(g.tableState.communityCards).toHaveLength(5)
    expect(g.isHandOver()).toBe(true)
  })

  test('flop all-in: remaining 2 community cards (turn+river) are dealt', () => {
    const g = new PokerGame(CFG)
    g.addPlayer('alice', 'Alice', 200)
    g.addPlayer('bob',   'Bob',   200)
    g.startHand()

    // Preflop: call around so we reach flop
    const utg = g.currentPlayer()!.id
    expect(g.applyAction(utg, 'call')).toBe(true)
    const bb = g.currentPlayer()!.id
    expect(g.applyAction(bb, 'check')).toBe(true)

    expect(g.tableState.phase).toBe('flop')
    expect(g.tableState.communityCards).toHaveLength(3)

    // Flop: both go all-in
    const first = g.currentPlayer()!.id
    expect(g.applyAction(first, 'all-in')).toBe(true)
    const second = g.currentPlayer()!.id
    expect(g.applyAction(second, 'all-in')).toBe(true)

    expect(g.tableState.phase).toBe('showdown')
    expect(g.tableState.communityCards).toHaveLength(5)
    expect(g.isHandOver()).toBe(true)
  })

  test('turn all-in: river card is dealt before showdown', () => {
    const g = new PokerGame(CFG)
    g.addPlayer('alice', 'Alice', 300)
    g.addPlayer('bob',   'Bob',   300)
    g.startHand()

    // Reach turn with checks
    const utg = g.currentPlayer()!.id
    g.applyAction(utg, 'call')
    const bb = g.currentPlayer()!.id
    g.applyAction(bb, 'check')
    expect(g.tableState.phase).toBe('flop')

    g.applyAction(g.currentPlayer()!.id, 'check')
    g.applyAction(g.currentPlayer()!.id, 'check')
    expect(g.tableState.phase).toBe('turn')
    expect(g.tableState.communityCards).toHaveLength(4)

    // Turn: both go all-in
    g.applyAction(g.currentPlayer()!.id, 'all-in')
    g.applyAction(g.currentPlayer()!.id, 'all-in')

    expect(g.tableState.phase).toBe('showdown')
    expect(g.tableState.communityCards).toHaveLength(5)
  })

  test('showdown resolves correctly with chips conserved', () => {
    const g = new PokerGame(CFG)
    g.addPlayer('alice', 'Alice', 100)
    g.addPlayer('bob',   'Bob',   100)
    g.startHand()

    const totalChipsBefore = g.players.reduce((s, p) => s + p.chips, 0) + g.tableState.pot

    const first = g.currentPlayer()!.id
    g.applyAction(first, 'all-in')
    g.applyAction(g.currentPlayer()!.id, 'all-in')

    // Resolve and verify chips are conserved
    const result = g.resolveShowdown()
    const totalChipsAfter = g.players.reduce((s, p) => s + p.chips, 0)
    expect(totalChipsAfter).toBe(totalChipsBefore)
    expect(result.showdown.length).toBe(2)
    // Both players must have hole cards and bestCards
    for (const entry of result.showdown) {
      expect(entry.cards).toHaveLength(2)
      expect(entry.bestCards).toHaveLength(5)
    }
  })
})
