/**
 * Tests for the Push Your Luck Draw engine (server/src/pushyourluckdraw/).
 * See .claude/PushYourLuckDraw.md for the rules these scenarios cover.
 */

import { describe, test, expect } from 'bun:test'
import type { PushYourLuckDrawCard, PushYourLuckDrawDeckMode, Rank } from '../../shared/types'
import { PushYourLuckDrawGame } from '../src/pushyourluckdraw/gameEngine'
import { buildDeck, isAceOfSpades, rankPoints } from '../src/pushyourluckdraw/deck'
import { parseClientMessage } from '../src/validation'

function numberCard(rank: Rank, id = `${rank}-${Math.random()}`): PushYourLuckDrawCard {
  return { id, suit: 'hearts', rank, isJoker: false }
}
function aceOfSpades(): PushYourLuckDrawCard {
  return { id: 'ace-of-spades', suit: 'spades', rank: 'A', isJoker: false }
}
function joker(id = `joker-${Math.random()}`): PushYourLuckDrawCard {
  return { id, suit: null, rank: null, isJoker: true }
}

function makeGame(
  ids: string[],
  overrides: Partial<{ maxPlayers: number; targetScore: number; deckMode: PushYourLuckDrawDeckMode }> = {},
): PushYourLuckDrawGame {
  const g = new PushYourLuckDrawGame({
    maxPlayers: overrides.maxPlayers ?? 8,
    targetScore: overrides.targetScore ?? 150,
    deckMode: overrides.deckMode ?? 'fresh',
  })
  for (const id of ids) g.addPlayer(id, id.toUpperCase())
  return g
}

/** `draw()` pops from the end of the monte array — reverse so `cards[0]` is drawn first. */
function setMonte(g: PushYourLuckDrawGame, cards: PushYourLuckDrawCard[]): void {
  ;(g as any).monte = [...cards].reverse()
}

// ─── Wire protocol ──────────────────────────────────────────────────────────

describe('parseClientMessage — pushyourluckdraw_*', () => {
  function parse(msg: unknown) { return parseClientMessage(JSON.stringify(msg)) }

  test('pushyourluckdraw_create_room round-trips with a valid config', () => {
    const config = { maxPlayers: 4, targetScore: 150, deckMode: 'fresh' }
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config }))
      .toEqual({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config })
  })

  test('rejects an out-of-range maxPlayers/targetScore, or an invalid deckMode', () => {
    const base = { maxPlayers: 4, targetScore: 150, deckMode: 'fresh' }
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, maxPlayers: 1 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, maxPlayers: 9 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, targetScore: 10 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, deckMode: 'bogus' } })).toBeNull()
  })

  test('join_room / leave_room / list_rooms / start_game / draw / stop round-trip', () => {
    expect(parse({ type: 'pushyourluckdraw_join_room', roomId: 'abc123' })).toEqual({ type: 'pushyourluckdraw_join_room', roomId: 'abc123' })
    expect(parse({ type: 'pushyourluckdraw_leave_room' })).toEqual({ type: 'pushyourluckdraw_leave_room' })
    expect(parse({ type: 'pushyourluckdraw_list_rooms' })).toEqual({ type: 'pushyourluckdraw_list_rooms' })
    expect(parse({ type: 'pushyourluckdraw_start_game' })).toEqual({ type: 'pushyourluckdraw_start_game' })
    expect(parse({ type: 'pushyourluckdraw_draw' })).toEqual({ type: 'pushyourluckdraw_draw' })
    expect(parse({ type: 'pushyourluckdraw_stop' })).toEqual({ type: 'pushyourluckdraw_stop' })
  })

  test('pushyourluckdraw_rematch_vote round-trips', () => {
    expect(parse({ type: 'pushyourluckdraw_rematch_vote', accept: true })).toEqual({ type: 'pushyourluckdraw_rematch_vote', accept: true })
    expect(parse({ type: 'pushyourluckdraw_rematch_vote', accept: 'yes' })).toBeNull()
  })
})

// ─── Deck ───────────────────────────────────────────────────────────────────

describe('buildDeck', () => {
  test('95 cards: copies(rank) = value(rank) for 2..K, 1 Ace of Spades, 4 Jokers', () => {
    const deck = buildDeck()
    expect(deck.length).toBe(95)

    const jokers = deck.filter((c) => c.isJoker)
    expect(jokers.length).toBe(4)

    const aces = deck.filter((c) => !c.isJoker && c.rank === 'A')
    expect(aces.length).toBe(1)
    expect(aces[0]).toMatchObject({ suit: 'spades', rank: 'A' })

    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as Rank[]) {
      const copies = deck.filter((c) => !c.isJoker && c.rank === rank)
      expect(copies.length).toBe(rankPoints(rank))
    }
    // The headline fact from the rule doc: the 7 has 7 copies, the K has 13.
    expect(deck.filter((c) => c.rank === '7').length).toBe(7)
    expect(deck.filter((c) => c.rank === 'K').length).toBe(13)
  })

  test('every card has a unique id', () => {
    const deck = buildDeck()
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length)
  })
})

describe('rankPoints / isAceOfSpades', () => {
  test('face cards map to 11/12/13, numbers at face value', () => {
    expect(rankPoints('2')).toBe(2)
    expect(rankPoints('10')).toBe(10)
    expect(rankPoints('J')).toBe(11)
    expect(rankPoints('Q')).toBe(12)
    expect(rankPoints('K')).toBe(13)
  })

  test('isAceOfSpades is true only for the spades ace, never jokers or other cards', () => {
    expect(isAceOfSpades(aceOfSpades())).toBe(true)
    expect(isAceOfSpades(numberCard('K'))).toBe(false)
    expect(isAceOfSpades(joker())).toBe(false)
  })
})

// ─── Turn actions ───────────────────────────────────────────────────────────

describe('draw — plain card', () => {
  test('adds the card to the hand and advances the turn', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    setMonte(g, [numberCard('5')])
    const outcome = g.draw(first)
    expect(outcome).toMatchObject({ kind: 'drew', card: { rank: '5' } })
    expect(g.players.find((p) => p.id === first)!.roundHand).toHaveLength(1)
    expect(g.currentPlayerId()).not.toBe(first)
  })

  test('rejects a draw out of turn', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const notCurrent = g.currentPlayerId() === 'a' ? 'b' : 'a'
    expect(g.draw(notCurrent)).toBeNull()
  })
})

describe('draw — duplicate rank (bust rule)', () => {
  test('busts without a held joker: hand cleared, status busted, round score 0', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('7', '7-a')]
    setMonte(g, [numberCard('7', '7-b')])
    const outcome = g.draw(first)
    expect(outcome).toMatchObject({ kind: 'busted' })
    expect(p.roundHand).toEqual([])
    expect(p.status).toBe('busted')
    expect(p.roundScore).toBe(0)
  })

  test('a held Joker saves the bust: joker consumed, duplicate discarded, hand untouched, still active', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('9', '9-a')]
    p.savesHeld = 1
    setMonte(g, [numberCard('9', '9-b')])
    const outcome = g.draw(first)
    expect(outcome).toMatchObject({ kind: 'saved' })
    expect(p.roundHand).toEqual([numberCard('9', '9-a')])
    expect(p.savesHeld).toBe(0)
    expect(p.status).toBe('active')
  })
})

describe('draw — Joker', () => {
  test('banks a save without entering the hand, and still advances the turn', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    setMonte(g, [joker()])
    const outcome = g.draw(first)
    expect(outcome).toMatchObject({ kind: 'joker' })
    const p = g.players.find((pl) => pl.id === first)!
    expect(p.roundHand).toEqual([])
    expect(p.savesHeld).toBe(1)
    expect(g.currentPlayerId()).not.toBe(first)
  })

  test('a second Joker just banks another save — never treated as a duplicate of the first', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'

    setMonte(g, [joker('j1')])
    g.draw(first)
    expect(g.players.find((p) => p.id === first)!.savesHeld).toBe(1)

    g.stop(other)   // other stood — turn returns to `first` (still active)
    expect(g.currentPlayerId()).toBe(first)

    setMonte(g, [joker('j2')])
    g.draw(first)
    const p = g.players.find((pl) => pl.id === first)!
    expect(p.savesHeld).toBe(2)
    expect(p.roundHand).toEqual([])
    expect(p.status).toBe('active')
  })
})

describe('Ace of Spades multiplier', () => {
  test('doubles the round score only when held while stopping', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [aceOfSpades(), numberCard('K'), numberCard('9')]
    g.stop(first)
    expect(p.roundScore).toBe((13 + 9) * 2)
  })

  test('busting with the ace in hand scores 0 — multiplier included', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [aceOfSpades(), numberCard('8', '8-a')]
    setMonte(g, [numberCard('8', '8-b')])
    g.draw(first)
    expect(p.roundScore).toBe(0)
    expect(p.status).toBe('busted')
  })
})

// ─── Round completion timing ────────────────────────────────────────────────

describe('round completion', () => {
  test('only ends once every seated player has stood or busted', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    g.stop(g.currentPlayerId()!)
    expect(g.tableState.phase).toBe('playing')
    g.stop(g.currentPlayerId()!)
    expect(g.tableState.phase).toBe('playing')
    g.stop(g.currentPlayerId()!)
    expect(['round_complete', 'match_complete']).toContain(g.tableState.phase)
  })

  test('totalScore is untouched until the round actually ends for everyone', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('K')]
    g.stop(first)
    expect(p.totalScore).toBe(0)   // the other player hasn't acted yet — round isn't over
  })
})

// ─── Match end: only at a round boundary, target crossed mid-round never cuts it short ──

describe('match end gating', () => {
  test('reaching 145 with a target of 150 does NOT end the match — another round must be dealt', () => {
    const g = makeGame(['a', 'b'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    const b = g.players.find((p) => p.id === 'b')!
    a.totalScore = 100
    a.roundHand = [numberCard('K'), numberCard('Q'), numberCard('J'), numberCard('9')]   // 13+12+11+9 = 45
    b.roundHand = [numberCard('2')]

    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)

    expect(a.totalScore).toBe(145)
    expect(g.tableState.phase).toBe('round_complete')
    expect(g.isMatchOver()).toBe(false)
    expect(g.lastMatchResult).toBeNull()
  })

  test('crossing the target ends the match at that round boundary, and the highest total wins', () => {
    const g = makeGame(['a', 'b'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    const b = g.players.find((p) => p.id === 'b')!
    a.totalScore = 100
    a.roundHand = [numberCard('K'), numberCard('Q'), numberCard('J'), numberCard('9')]   // -> 145, stays under
    b.totalScore = 140
    b.roundHand = [numberCard('K')]   // -> 153, crosses 150

    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)

    expect(g.isMatchOver()).toBe(true)
    expect(a.totalScore).toBe(145)
    expect(b.totalScore).toBe(153)
    expect(g.lastMatchResult).toEqual({ winnerIds: ['b'] })
  })

  test('when multiple players cross the target in the same round, the highest total wins — not just whoever crossed it', () => {
    const g = makeGame(['a', 'b', 'c'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    const b = g.players.find((p) => p.id === 'b')!
    const c = g.players.find((p) => p.id === 'c')!
    a.totalScore = 100; a.roundHand = [numberCard('K'), numberCard('Q'), numberCard('J'), numberCard('9')]                                  // -> 145 (stays under)
    b.totalScore = 90;  b.roundHand = [numberCard('K'), numberCard('Q'), numberCard('J'), numberCard('10'), numberCard('9'), numberCard('8')] // -> 153 (crosses)
    c.totalScore = 95;  c.roundHand = [numberCard('K'), numberCard('Q'), numberCard('J'), numberCard('10'), numberCard('9'), numberCard('8'), numberCard('7')] // -> 165 (crosses, highest)

    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)

    expect(a.totalScore).toBe(145)
    expect(b.totalScore).toBe(153)
    expect(c.totalScore).toBe(165)
    expect(g.isMatchOver()).toBe(true)
    expect(g.lastMatchResult).toEqual({ winnerIds: ['c'] })
  })

  test('an exact tie at or above the target splits the win between the tied players', () => {
    const g = makeGame(['a', 'b'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    const b = g.players.find((p) => p.id === 'b')!
    a.totalScore = 140; a.roundHand = [numberCard('K')]   // -> 153
    b.totalScore = 140; b.roundHand = [numberCard('K', 'K-b')]   // -> 153

    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)

    expect(g.isMatchOver()).toBe(true)
    expect(g.lastMatchResult!.winnerIds.sort()).toEqual(['a', 'b'])
  })
})

describe('recordMatchWin', () => {
  test('increments the sole winner, but nobody on a tie', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    g.recordMatchWin(['a', 'b'])
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(0)
    expect(g.players.find((p) => p.id === 'b')!.matchWins).toBe(0)
    g.recordMatchWin(['a'])
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(1)
    expect(g.matchWinsById()).toEqual({ a: 1, b: 0 })
  })
})

// ─── Deck modes ─────────────────────────────────────────────────────────────

describe('deckMode: fresh', () => {
  test('monte (and discard) are rebuilt/reset at the start of every round, regardless of what was left', () => {
    const g = makeGame(['a', 'b'], { deckMode: 'fresh' })
    g.startMatch()
    expect((g as any).monte.length).toBe(95)

    ;(g as any).monte = [numberCard('4')]
    ;(g as any).descarte = [numberCard('9')]
    g.startRound()   // simulates the Room dealing the next round

    expect((g as any).monte.length).toBe(95)
    expect((g as any).descarte.length).toBe(0)
  })
})

describe('deckMode: persistent', () => {
  test('monte carries over between rounds instead of being rebuilt', () => {
    const g = makeGame(['a', 'b'], { deckMode: 'persistent' })
    g.startMatch()
    expect((g as any).monte.length).toBe(95)

    setMonte(g, [numberCard('4')])   // leave just 1 card in the monte
    const first = g.currentPlayerId()!
    g.draw(first)                    // consumes the only card — monte now empty
    expect((g as any).monte.length).toBe(0)

    g.stop(g.currentPlayerId()!)     // the other player stands — turn returns to `first`
    expect(g.tableState.phase).toBe('playing')
    g.stop(first)                    // now both are resolved — round ends
    expect(g.tableState.phase).toBe('round_complete')

    g.startRound()
    // Persistent mode must NOT top the monte back up to 95 between rounds.
    expect((g as any).monte.length).toBeLessThan(95)
  })

  test('cards discarded this round (bust, saved duplicate) accumulate and recycle into the monte once it runs dry', () => {
    const g = makeGame(['a', 'b'], { deckMode: 'persistent' })
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('6', '6-a')]
    setMonte(g, [numberCard('6', '6-b')])
    g.draw(first)   // busts — both 6s go to the discard pile
    expect((g as any).descarte.length).toBeGreaterThanOrEqual(2)

    ;(g as any).monte = []   // drain the monte entirely
    const cur = g.currentPlayerId()!
    const outcome = g.draw(cur)
    expect(outcome).not.toBeNull()
    expect(outcome!.kind).not.toBe('forced_stop')
  })

  test('forced_stop when both monte and discard are exhausted mid-decision — never a forced bust', () => {
    const g = makeGame(['a', 'b'], { deckMode: 'persistent' })
    g.startMatch()
    ;(g as any).monte = []
    ;(g as any).descarte = []
    const cur = g.currentPlayerId()!
    const outcome = g.draw(cur)
    expect(outcome).toEqual({ kind: 'forced_stop' })
    expect(g.players.find((p) => p.id === cur)!.status).toBe('stood')
  })

  test('a round-end discard from the previous round is available to recycle in the round after that', () => {
    const g = makeGame(['a', 'b'], { deckMode: 'persistent' })
    g.startMatch()
    // Round 1: both stand immediately with whatever they were dealt via draws.
    setMonte(g, [numberCard('3')])
    g.draw(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)
    expect(g.tableState.phase).toBe('round_complete')

    g.startRound()   // round 2 — the '3' from round 1 should now be sitting in the discard pile
    expect((g as any).descarte.some((c: PushYourLuckDrawCard) => c.rank === '3')).toBe(true)
  })
})
