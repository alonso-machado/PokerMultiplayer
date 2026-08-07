/**
 * Tests for the Go Fish engine (server/src/gofish/). See .claude/GoFish.md
 * for the rules — especially the resolved gaps — these scenarios cover.
 */

import { describe, test, expect } from 'bun:test'
import type { Card, Rank, Suit } from '../../shared/types'
import { GoFishGame } from '../src/gofish/gameEngine'
import { parseClientMessage } from '../src/validation'

function card(suit: Suit, rank: Rank): Card { return { suit, rank } }

// ─── Wire protocol ──────────────────────────────────────────────────────────
// Regression coverage for the manual whitelist in validation.ts — every
// gofish_* client message must round-trip through parseClientMessage, or the
// server silently drops it (this broke room creation once already, for Canastra).

describe('parseClientMessage — gofish_*', () => {
  function parse(msg: unknown) { return parseClientMessage(JSON.stringify(msg)) }

  test('gofish_create_room round-trips with a valid config', () => {
    const out = parse({ type: 'gofish_create_room', roomName: 'Mesa', config: { maxPlayers: 4 } })
    expect(out).toEqual({ type: 'gofish_create_room', roomName: 'Mesa', config: { maxPlayers: 4 } })
  })

  test('gofish_create_room rejects an out-of-range maxPlayers', () => {
    expect(parse({ type: 'gofish_create_room', roomName: 'Mesa', config: { maxPlayers: 1 } })).toBeNull()
    expect(parse({ type: 'gofish_create_room', roomName: 'Mesa', config: { maxPlayers: 7 } })).toBeNull()
  })

  test('gofish_join_room / leave_room / list_rooms / start_game round-trip', () => {
    expect(parse({ type: 'gofish_join_room', roomId: 'abc123' })).toEqual({ type: 'gofish_join_room', roomId: 'abc123' })
    expect(parse({ type: 'gofish_leave_room' })).toEqual({ type: 'gofish_leave_room' })
    expect(parse({ type: 'gofish_list_rooms' })).toEqual({ type: 'gofish_list_rooms' })
    expect(parse({ type: 'gofish_start_game' })).toEqual({ type: 'gofish_start_game' })
  })

  test('gofish_ask round-trips a target + rank, rejects an invalid rank', () => {
    expect(parse({ type: 'gofish_ask', targetPlayerId: 'p2', rank: 'K' }))
      .toEqual({ type: 'gofish_ask', targetPlayerId: 'p2', rank: 'K' })
    expect(parse({ type: 'gofish_ask', targetPlayerId: 'p2', rank: '99' })).toBeNull()
  })

  test('gofish_rematch_vote round-trips', () => {
    expect(parse({ type: 'gofish_rematch_vote', accept: true })).toEqual({ type: 'gofish_rematch_vote', accept: true })
    expect(parse({ type: 'gofish_rematch_vote', accept: 'yes' })).toBeNull()
  })
})

// ─── GoFishGame ─────────────────────────────────────────────────────────────

function makeGame(ids: string[], maxPlayers = 6): GoFishGame {
  const g = new GoFishGame({ maxPlayers })
  for (const id of ids) g.addPlayer(id, id.toUpperCase())
  return g
}

function setHand(g: GoFishGame, id: string, hand: Card[]): void {
  g.players.find((p) => p.id === id)!.hand = hand
}

describe('startHand deal counts (gap #2)', () => {
  test('2-3 players get 7 cards each', () => {
    for (const n of [2, 3]) {
      const g = makeGame(Array.from({ length: n }, (_, i) => `p${i}`))
      g.startHand()
      for (const p of g.players) expect(p.hand.length).toBe(7)
    }
  })

  test('4-6 players get 5 cards each (6 extends the source\'s 4-5 bracket)', () => {
    for (const n of [4, 5, 6]) {
      const g = makeGame(Array.from({ length: n }, (_, i) => `p${i}`))
      g.startHand()
      for (const p of g.players) expect(p.hand.length).toBe(5)
    }
  })

  test('start seat rotates by actual seated count, not the room\'s maxPlayers cap', () => {
    const g = makeGame(['a', 'b'], 6)   // room configured for up to 6, only 2 joined
    g.startHand()
    expect(g.currentPlayerId()).toBe('a')
    g.startHand() // simulate a rematch re-deal
    expect(g.currentPlayerId()).toBe('b')
  })
})

describe('ask — catching from an opponent', () => {
  test('transfers all matching cards and completes a book at 4', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    // The extra spades-2 keeps a's hand non-empty after the book is
    // collected, isolating this from the empty-hand-refill behavior (gap #4).
    setHand(g, 'a', [card('spades', 'K'), card('hearts', 'K'), card('diamonds', 'K'), card('spades', '2')])
    setHand(g, 'b', [card('clubs', 'K'), card('hearts', '2')])

    const result = g.ask('a', 'b', 'K')
    expect(result).toEqual({
      askerId: 'a', targetId: 'b', rank: 'K', cardsTransferred: 1, wentFish: false, drawnMatch: false,
      booksCompleted: [{ playerId: 'a', rank: 'K' }],
    })
    expect(g.players.find((p) => p.id === 'a')!.books).toEqual(['K'])
    expect(g.players.find((p) => p.id === 'a')!.hand).toEqual([card('spades', '2')])
    expect(g.players.find((p) => p.id === 'b')!.hand).toEqual([card('hearts', '2')])
  })

  test('a catch keeps the same player\'s turn', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    setHand(g, 'a', [card('spades', 'K')])
    setHand(g, 'b', [card('clubs', 'K')])
    g.ask('a', 'b', 'K')
    expect(g.currentPlayerId()).toBe('a')
  })

  test('rejects asking for a rank you do not hold', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    setHand(g, 'a', [card('spades', '5')])
    setHand(g, 'b', [card('clubs', 'K')])
    expect(g.ask('a', 'b', 'K')).toBeNull()
  })

  test('rejects a request out of turn', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    const notCurrent = g.currentPlayerId() === 'a' ? 'b' : 'a'
    expect(g.ask(notCurrent, g.currentPlayerId()!, 'K')).toBeNull()
  })
})

describe('ask — going fish', () => {
  test('no stock match: draws and passes the turn', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    setHand(g, 'a', [card('spades', 'K')])
    setHand(g, 'b', [card('clubs', '9')])   // no K for b — must go fish
    ;(g as any).stock = [card('hearts', '3')]   // top of stock ≠ K
    const result = g.ask('a', 'b', 'K')
    expect(result).toMatchObject({ wentFish: true, drawnMatch: false, cardsTransferred: 0 })
    expect(g.currentPlayerId()).toBe('b')   // turn passed
    expect(g.players.find((p) => p.id === 'a')!.hand).toContainEqual(card('hearts', '3'))
  })

  test('stock draw matches the asked rank: counts as a catch, turn continues (gap #1)', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    // An extra unrelated card keeps a's hand non-empty after the book is
    // collected, isolating this from the empty-hand-refill behavior (gap #4).
    setHand(g, 'a', [card('spades', 'K'), card('hearts', 'K'), card('diamonds', 'K'), card('hearts', '2')])
    setHand(g, 'b', [card('clubs', '9')])
    ;(g as any).stock = [card('clubs', 'K')]   // the exact rank asked for
    const result = g.ask('a', 'b', 'K')
    expect(result).toMatchObject({ wentFish: true, drawnMatch: true, cardsTransferred: 1 })
    expect(result!.booksCompleted).toEqual([{ playerId: 'a', rank: 'K' }])
    expect(g.currentPlayerId()).toBe('a')   // turn continues
  })

  test('empty stock: nothing drawn, turn simply passes', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    setHand(g, 'a', [card('spades', 'K')])
    setHand(g, 'b', [card('clubs', '9')])
    ;(g as any).stock = []
    const before = g.players.find((p) => p.id === 'a')!.hand.length
    const result = g.ask('a', 'b', 'K')
    expect(result).toMatchObject({ wentFish: true, drawnMatch: false })
    expect(g.players.find((p) => p.id === 'a')!.hand.length).toBe(before)
    expect(g.currentPlayerId()).toBe('b')
  })
})

describe('empty-hand turn refill (gap #4) and elimination (gap #5)', () => {
  test('current player with an empty hand auto-draws before acting', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    const cur = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === cur)!
    p.hand = []
    ;(g as any).stock = [card('spades', '9')]
    ;(g as any).prepareTurn()
    expect(p.hand).toEqual([card('spades', '9')])
    expect(p.status).not.toBe('out')
  })

  test('empty hand + empty stock marks the seat "out" and turn rotation skips it', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startHand()
    const a = g.players.find((p) => p.id === 'a')!
    a.hand = []
    ;(g as any).stock = []
    ;(g as any).prepareTurn()
    expect(a.status).toBe('out')
    expect(g.currentPlayerId()).not.toBe('a')
    expect(g.tableState.phase).toBe('playing')   // b and c can still play
  })

  test('round ends early once fewer than 2 players can still take a turn', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    const a = g.players.find((p) => p.id === 'a')!
    a.hand = []
    ;(g as any).stock = []
    ;(g as any).prepareTurn()
    expect(a.status).toBe('out')
    expect(g.tableState.phase).toBe('round_end')
  })
})

describe('round end at 13 books and winner selection', () => {
  test('reaching the 13th book across all players ends the round', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    const allRanks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
    const a = g.players.find((p) => p.id === 'a')!
    a.books = allRanks.slice(0, 12)   // 12 already-completed books
    setHand(g, 'a', [card('spades', 'A'), card('hearts', 'A'), card('diamonds', 'A')])
    setHand(g, 'b', [card('clubs', 'A')])

    const result = g.ask('a', 'b', 'A')
    expect(result!.booksCompleted).toEqual([{ playerId: 'a', rank: 'A' }])
    expect(g.tableState.phase).toBe('round_end')
    expect(g.lastRoundResult).toEqual({ winnerIds: ['a'] })
  })
})

describe('recordMatchWin', () => {
  test('increments the sole winner, but nobody on a tie', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    g.recordMatchWin(['a', 'b'])
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(0)
    expect(g.players.find((p) => p.id === 'b')!.matchWins).toBe(0)
    g.recordMatchWin(['a'])
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(1)
    expect(g.matchWinsById()).toEqual({ a: 1, b: 0 })
  })
})

describe('arbitraryAsk (turn-timeout auto-play)', () => {
  test('picks a rank the player actually holds and a different, still-in target', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startHand()
    setHand(g, 'a', [card('spades', '7')])
    g.players.find((p) => p.id === 'c')!.status = 'out'
    const guess = g.arbitraryAsk('a')
    expect(guess).toEqual({ targetPlayerId: 'b', rank: '7' })
  })

  test('returns null once the hand is empty', () => {
    const g = makeGame(['a', 'b'])
    g.startHand()
    setHand(g, 'a', [])
    expect(g.arbitraryAsk('a')).toBeNull()
  })
})
