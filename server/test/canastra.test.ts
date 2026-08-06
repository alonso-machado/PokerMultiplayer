/**
 * Tests for the Canastra/Buraco engine (server/src/canastra/). See
 * .claude/Canastra.md for the rules these scenarios are derived from.
 */

import { describe, test, expect } from 'bun:test'
import type { CanastraCard, CanastraMode, Rank, Suit } from '../../shared/types'
import { createDeck, shuffle, cardValue, validateMeld } from '../src/canastra/deck'
import { CanastraGame } from '../src/canastra/gameEngine'
import { parseClientMessage } from '../src/validation'

// ─── Wire protocol ──────────────────────────────────────────────────────────
// Regression coverage for the manual whitelist in validation.ts — every
// canastra_* client message must round-trip through parseClientMessage, or
// the server silently drops it (this broke room creation once already).

describe('parseClientMessage — canastra_*', () => {
  function parse(msg: unknown) { return parseClientMessage(JSON.stringify(msg)) }

  test('canastra_create_room round-trips with a valid config', () => {
    const out = parse({ type: 'canastra_create_room', roomName: 'Mesa', config: { mode: '2x2' } })
    expect(out).toEqual({ type: 'canastra_create_room', roomName: 'Mesa', config: { mode: '2x2' } })
  })

  test('canastra_create_room rejects an invalid mode', () => {
    expect(parse({ type: 'canastra_create_room', roomName: 'Mesa', config: { mode: '3x3' } })).toBeNull()
  })

  test('canastra_join_room / leave_room / list_rooms / draw_stock round-trip', () => {
    expect(parse({ type: 'canastra_join_room', roomId: 'abc123' })).toEqual({ type: 'canastra_join_room', roomId: 'abc123' })
    expect(parse({ type: 'canastra_leave_room' })).toEqual({ type: 'canastra_leave_room' })
    expect(parse({ type: 'canastra_list_rooms' })).toEqual({ type: 'canastra_list_rooms' })
    expect(parse({ type: 'canastra_draw_stock' })).toEqual({ type: 'canastra_draw_stock' })
  })

  test('canastra_lay_meld round-trips a card id array', () => {
    const out = parse({ type: 'canastra_lay_meld', cardIds: ['a', 'b', 'c'] })
    expect(out).toEqual({ type: 'canastra_lay_meld', cardIds: ['a', 'b', 'c'] })
  })

  test('canastra_add_to_meld requires both meldId and cardIds', () => {
    expect(parse({ type: 'canastra_add_to_meld', meldId: 'm1', cardIds: ['a'] }))
      .toEqual({ type: 'canastra_add_to_meld', meldId: 'm1', cardIds: ['a'] })
    expect(parse({ type: 'canastra_add_to_meld', cardIds: ['a'] })).toBeNull()
  })

  test('canastra_discard round-trips a card id', () => {
    expect(parse({ type: 'canastra_discard', cardId: 'x1' })).toEqual({ type: 'canastra_discard', cardId: 'x1' })
  })

  test('canastra_take_discard round-trips both meld-plan kinds', () => {
    expect(parse({ type: 'canastra_take_discard', meldPlan: { kind: 'new', cardIds: ['a', 'b', 'c'] } }))
      .toEqual({ type: 'canastra_take_discard', meldPlan: { kind: 'new', cardIds: ['a', 'b', 'c'] } })
    expect(parse({ type: 'canastra_take_discard', meldPlan: { kind: 'append', meldId: 'm1', cardId: 'c1' } }))
      .toEqual({ type: 'canastra_take_discard', meldPlan: { kind: 'append', meldId: 'm1', cardId: 'c1' } })
    expect(parse({ type: 'canastra_take_discard', meldPlan: { kind: 'bogus' } })).toBeNull()
  })

  test('canastra_rematch_vote round-trips', () => {
    expect(parse({ type: 'canastra_rematch_vote', accept: true })).toEqual({ type: 'canastra_rematch_vote', accept: true })
    expect(parse({ type: 'canastra_rematch_vote', accept: 'yes' })).toBeNull()
  })
})

function card(id: string, suit: Suit, rank: Rank): CanastraCard { return { id, suit, rank, isJoker: false } }
function joker(id: string): CanastraCard { return { id, suit: null, rank: null, isJoker: true } }

// ─── Deck ───────────────────────────────────────────────────────────────────

describe('createDeck', () => {
  test('has 108 cards: 2×52 + 4 jokers, all unique ids', () => {
    const deck = createDeck()
    expect(deck.length).toBe(108)
    expect(deck.filter((c) => c.isJoker).length).toBe(4)
    expect(new Set(deck.map((c) => c.id)).size).toBe(108)
  })

  test('shuffle preserves the multiset (same length, same ids)', () => {
    const deck = createDeck()
    const shuffled = shuffle(deck)
    expect(shuffled.length).toBe(deck.length)
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)))
  })
})

describe('cardValue', () => {
  test('matches the point table', () => {
    expect(cardValue(joker('j'))).toBe(50)
    expect(cardValue(card('c', 'hearts', 'A'))).toBe(15)
    expect(cardValue(card('c', 'hearts', '2'))).toBe(10)
    for (const r of ['3', '4', '5', '6', '7'] as Rank[]) expect(cardValue(card('c', 'hearts', r))).toBe(5)
    for (const r of ['8', '9', '10', 'J', 'Q', 'K'] as Rank[]) expect(cardValue(card('c', 'hearts', r))).toBe(10)
  })
})

// ─── Meld validation ────────────────────────────────────────────────────────

describe('validateMeld — groups (trinca)', () => {
  test('3 same-rank cards, mixed suits — valid group, no wildcard', () => {
    const v = validateMeld([card('a', 'hearts', '5'), card('b', 'diamonds', '5'), card('c', 'clubs', '5')])
    expect(v).toEqual({ kind: 'group', wildcardCount: 0, isCanastra: false, isClean: true })
  })

  test('2 naturals + 1 wildcard (2) — valid group with 1 wildcard', () => {
    const v = validateMeld([card('a', 'hearts', '5'), card('b', 'diamonds', '5'), card('c', 'clubs', '2')])
    expect(v).toEqual({ kind: 'group', wildcardCount: 1, isCanastra: false, isClean: false })
  })

  test('2 wildcards + 1 natural — invalid (max 1 wildcard per meld)', () => {
    const v = validateMeld([card('a', 'hearts', '5'), card('b', 'diamonds', '2'), joker('c')])
    expect(v).toBeNull()
  })

  test('fewer than 3 cards — invalid', () => {
    expect(validateMeld([card('a', 'hearts', '5'), card('b', 'diamonds', '5')])).toBeNull()
  })

  test('7+ same-rank cards — group canastra', () => {
    const cards = [
      card('a', 'hearts', 'K'), card('b', 'diamonds', 'K'), card('c', 'clubs', 'K'),
      card('d', 'spades', 'K'), card('e', 'hearts', 'K'), card('f', 'diamonds', 'K'), card('g', 'clubs', 'K'),
    ]
    const v = validateMeld(cards)
    expect(v).toEqual({ kind: 'group', wildcardCount: 0, isCanastra: true, isClean: true })
  })
})

describe('validateMeld — sequences (jogo)', () => {
  test('3 consecutive same-suit cards — valid sequence', () => {
    const v = validateMeld([card('a', 'hearts', '3'), card('b', 'hearts', '4'), card('c', 'hearts', '5')])
    expect(v).toEqual({ kind: 'sequence', wildcardCount: 0, isCanastra: false, isClean: true })
  })

  test('a natural 2 in its low-end slot does not count as a wildcard', () => {
    const v = validateMeld([card('a', 'hearts', '2'), card('b', 'hearts', '3'), card('c', 'hearts', '4')])
    expect(v).toEqual({ kind: 'sequence', wildcardCount: 0, isCanastra: false, isClean: true })
  })

  test('Ace-low sequence (A-2-3) is valid', () => {
    const v = validateMeld([card('a', 'hearts', 'A'), card('b', 'hearts', '2'), card('c', 'hearts', '3')])
    expect(v?.kind).toBe('sequence')
  })

  test('Ace-high sequence (Q-K-A) is valid', () => {
    const v = validateMeld([card('a', 'hearts', 'Q'), card('b', 'hearts', 'K'), card('c', 'hearts', 'A')])
    expect(v?.kind).toBe('sequence')
  })

  test('K-A-2 does not wrap around — invalid', () => {
    const v = validateMeld([card('a', 'hearts', 'K'), card('b', 'hearts', 'A'), card('c', 'hearts', '2')])
    expect(v).toBeNull()
  })

  test('a joker fills a gap — counts as the 1 allowed wildcard', () => {
    const v = validateMeld([card('a', 'hearts', '3'), card('b', 'hearts', '4'), joker('j'), card('c', 'hearts', '6')])
    expect(v).toEqual({ kind: 'sequence', wildcardCount: 1, isCanastra: false, isClean: false })
  })

  test('two gap-filling wildcards — invalid (cap is 1)', () => {
    const v = validateMeld([card('a', 'hearts', '3'), joker('j1'), joker('j2'), card('b', 'hearts', '6')])
    expect(v).toBeNull()
  })

  test('duplicate rank within a candidate sequence — invalid', () => {
    const v = validateMeld([card('a', 'hearts', '5'), card('b', 'hearts', '5'), card('c', 'hearts', '6')])
    expect(v).toBeNull()
  })

  test('mixed suits among naturals — invalid', () => {
    const v = validateMeld([card('a', 'hearts', '3'), card('b', 'diamonds', '4'), card('c', 'hearts', '5')])
    expect(v).toBeNull()
  })

  test('7-card clean run — canastra limpa', () => {
    const cards = ['4', '5', '6', '7', '8', '9', '10'].map((r, i) => card(`c${i}`, 'hearts', r as Rank))
    const v = validateMeld(cards)
    expect(v).toEqual({ kind: 'sequence', wildcardCount: 0, isCanastra: true, isClean: true })
  })

  test('7-card run with 1 wildcard — canastra suja', () => {
    const cards = [
      card('c0', 'hearts', '4'), card('c1', 'hearts', '5'), card('c2', 'hearts', '6'), joker('j'),
      card('c3', 'hearts', '8'), card('c4', 'hearts', '9'), card('c5', 'hearts', '10'),
    ]
    const v = validateMeld(cards)
    expect(v).toEqual({ kind: 'sequence', wildcardCount: 1, isCanastra: true, isClean: false })
  })
})

// ─── CanastraGame ───────────────────────────────────────────────────────────

function makeGame(mode: CanastraMode): CanastraGame {
  const g = new CanastraGame({ mode })
  const seats: [string, string][] = mode === '1x1' ? [['a', 'A'], ['b', 'B']] : [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']]
  for (const [id, name] of seats) g.addPlayer(id, name)
  return g
}

function setHand(g: CanastraGame, id: string, hand: CanastraCard[]): void {
  const p = g.players.find((pl) => pl.id === id)!
  p.hand = hand
}

describe('teams', () => {
  test('1x1: each player is their own team', () => {
    const g = makeGame('1x1')
    expect(g.players.map((p) => p.teamIndex)).toEqual([0, 1])
  })

  test('2x2: opposite seats are partners (0&2 vs 1&3)', () => {
    const g = makeGame('2x2')
    expect(g.players.map((p) => p.teamIndex)).toEqual([0, 1, 0, 1])
  })
})

describe('startHand', () => {
  test('1x1: deals 11 cards each, 11-card morto per team, 64 left in stock', () => {
    const g = makeGame('1x1')
    g.startHand()
    for (const p of g.players) expect(p.hand.length).toBe(11)
    expect(g.tableState.teams[0].mortoCount).toBe(11)
    expect(g.tableState.teams[1].mortoCount).toBe(11)
    expect(g.tableState.stockCount).toBe(64)
  })

  test('2x2: deals 11 cards each, 42 left in stock', () => {
    const g = makeGame('2x2')
    g.startHand()
    for (const p of g.players) expect(p.hand.length).toBe(11)
    expect(g.tableState.stockCount).toBe(42)
  })

  test('the seat after the dealer plays first', () => {
    const g = makeGame('1x1')
    g.startHand()
    expect(g.currentPlayerId()).toBe('b') // dealer starts at seat 0 on the first hand
  })
})

describe('turn flow', () => {
  test('only the current player may draw; drawing moves the game to the "act" stage', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    const other = cur === 'a' ? 'b' : 'a'
    expect(g.drawStock(other)).toBe(false)
    expect(g.drawStock(cur)).toBe(true)
    expect(g.tableState.turnStage).toBe('act')
  })

  test('cannot lay a meld before drawing', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    setHand(g, cur, [card('x1', 'hearts', '5'), card('x2', 'diamonds', '5'), card('x3', 'clubs', '5')])
    expect(g.layMeld(cur, ['x1', 'x2', 'x3'])).toBe(false)
  })

  test('discarding advances the turn to the next seat', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    g.drawStock(cur)
    const c = g.hand(cur)[0]!
    expect(g.discard(cur, c.id)).toBe(true)
    expect(g.currentPlayerId()).not.toBe(cur)
  })

  test('once the stock is empty, the current player can act without drawing', () => {
    const g = makeGame('1x1')
    g.startHand()
    while (g.tableState.stockCount > 0) {
      const pid = g.currentPlayerId()!
      g.drawStock(pid)
      g.discard(pid, g.hand(pid)[0]!.id)
    }
    expect(g.tableState.stockCount).toBe(0)
    const pid = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === pid)!
    p.hand = [...p.hand, card('x1', 'hearts', '9'), card('x2', 'diamonds', '9'), card('x3', 'clubs', '9')]
    expect(g.tableState.turnStage).toBe('draw')
    expect(g.layMeld(pid, ['x1', 'x2', 'x3'])).toBe(true)
  })
})

describe('laying and adding to melds', () => {
  test('layMeld removes the cards from hand and creates a meld for the team', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    g.drawStock(cur)
    setHand(g, cur, [...g.hand(cur), card('x1', 'hearts', '5'), card('x2', 'diamonds', '5'), card('x3', 'clubs', '5')])
    const before = g.hand(cur).length
    expect(g.layMeld(cur, ['x1', 'x2', 'x3'])).toBe(true)
    expect(g.hand(cur).length).toBe(before - 3)
    const teamIdx = g.players.find((p) => p.id === cur)!.teamIndex
    expect(g.tableState.teams[teamIdx].melds).toHaveLength(1)
  })

  test('addToMeld extends an existing meld and re-evaluates canastra status', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    g.drawStock(cur)
    setHand(g, cur, ['4', '5', '6'].map((r, i) => card(`s${i}`, 'hearts', r as Rank)))
    g.layMeld(cur, ['s0', 's1', 's2'])
    const meld = g.tableState.teams[g.players.find((p) => p.id === cur)!.teamIndex].melds[0]!
    setHand(g, cur, ['7', '8', '9', '10'].map((r, i) => card(`t${i}`, 'hearts', r as Rank)))
    expect(g.addToMeld(cur, meld.id, ['t0', 't1', 't2', 't3'])).toBe(true)
    expect(meld.cards).toHaveLength(7)
    expect(meld.isCanastra).toBe(true)
  })
})

describe('taking the discard pile', () => {
  function discardKnownCard(g: CanastraGame, pid: string, c: CanastraCard): void {
    setHand(g, pid, [...g.hand(pid), c])
    g.drawStock(pid)
    g.discard(pid, c.id)
  }

  test('legal when the top card completes a brand-new meld from hand', () => {
    const g = makeGame('1x1')
    g.startHand()
    const first = g.currentPlayerId()!
    const second = first === 'a' ? 'b' : 'a'
    discardKnownCard(g, first, card('d1', 'diamonds', '5'))

    expect(g.currentPlayerId()).toBe(second)
    setHand(g, second, [...g.hand(second), card('h1', 'hearts', '5'), card('h2', 'clubs', '5')])
    const ok = g.takeDiscard(second, { kind: 'new', cardIds: ['h1', 'h2', 'd1'] })
    expect(ok).toBe(true)
    expect(g.tableState.turnStage).toBe('act')
    const teamIdx = g.players.find((p) => p.id === second)!.teamIndex
    expect(g.tableState.teams[teamIdx].melds).toHaveLength(1)
  })

  test('legal when the top card is appended to one of the team\'s existing melds', () => {
    const g = makeGame('1x1')
    g.startHand()
    const first = g.currentPlayerId()!
    const second = first === 'a' ? 'b' : 'a'

    // `first` lays a meld, then discards something irrelevant to end their turn.
    g.drawStock(first)
    setHand(g, first, [...g.hand(first), card('s0', 'hearts', '4'), card('s1', 'hearts', '5'), card('s2', 'hearts', '6')])
    g.layMeld(first, ['s0', 's1', 's2'])
    const meld = g.tableState.teams[g.players.find((p) => p.id === first)!.teamIndex].melds[0]!
    const junk = card('junk', 'clubs', '9')
    setHand(g, first, [...g.hand(first), junk])
    g.discard(first, junk.id)

    // `second` draws, then discards the card that happens to extend first's meld —
    // it's now on top for `first`'s next turn, regardless of who discarded it.
    const extra = card('extra', 'hearts', '7')
    g.drawStock(second)
    setHand(g, second, [...g.hand(second), extra])
    g.discard(second, extra.id)
    expect(g.currentPlayerId()).toBe(first)

    const ok = g.takeDiscard(first, { kind: 'append', meldId: meld.id, cardId: extra.id })
    expect(ok).toBe(true)
    expect(meld.cards).toHaveLength(4)
  })

  test('illegal when the discard pile is empty', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    expect(g.canTakeDiscard(cur)).toBe(false)
    expect(g.takeDiscard(cur, { kind: 'new', cardIds: ['whatever'] })).toBe(false)
  })
})

describe('batida (going out)', () => {
  test('direct batida (via meld) hands over the morto immediately if not taken yet, and play continues', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    g.drawStock(cur)
    setHand(g, cur, ['4', '5', '6'].map((r, i) => card(`s${i}`, 'hearts', r as Rank)))
    expect(g.layMeld(cur, ['s0', 's1', 's2'])).toBe(true)
    expect(g.hand(cur).length).toBe(11) // emptied, then got the 11-card morto
    const teamIdx = g.players.find((p) => p.id === cur)!.teamIndex
    expect(g.tableState.teams[teamIdx].mortoTaken).toBe(true)
    expect(g.tableState.phase).toBe('playing') // round didn't end
  })

  test('direct batida ends the round once the morto was already taken', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    const teamIdx = g.players.find((p) => p.id === cur)!.teamIndex
    // Force the morto as already taken via a first (harmless) direct batida.
    g.drawStock(cur)
    setHand(g, cur, ['4', '5', '6'].map((r, i) => card(`s${i}`, 'hearts', r as Rank)))
    g.layMeld(cur, ['s0', 's1', 's2'])
    expect(g.tableState.teams[teamIdx].mortoTaken).toBe(true)

    // Now empty the hand again with the morto already taken.
    setHand(g, cur, ['7', '8', '9'].map((r, i) => card(`t${i}`, 'hearts', r as Rank)))
    expect(g.layMeld(cur, ['t0', 't1', 't2'])).toBe(true)
    expect(g.tableState.phase).toBe('round_end')
    expect(g.lastRoundResult).not.toBeNull()
  })

  test('indirect batida (via discard) delays the morto to the team\'s next turn instead of ending the round', () => {
    const g = makeGame('2x2') // a & c are team 0, b & d are team 1
    g.startHand()
    const cur = g.currentPlayerId()! // seat 1 -> 'b', team 1
    // Empty b's hand down to exactly 1 card, then discard it.
    g.drawStock(cur)
    const last = card('last', 'hearts', '9')
    setHand(g, cur, [last])
    expect(g.discard(cur, last.id)).toBe(true)
    expect(g.tableState.phase).toBe('playing') // round doesn't end — team hadn't taken its morto

    // Play through until it's team 1's turn again (d, b's partner).
    while (g.currentPlayerId() !== 'd') {
      const pid = g.currentPlayerId()!
      g.drawStock(pid)
      g.discard(pid, g.hand(pid)[0]!.id)
    }
    expect(g.hand('d').length).toBe(11 + 11) // own hand + the delayed morto
    expect(g.tableState.teams[1].mortoTaken).toBe(true)
  })
})

describe('scoring and match wins', () => {
  test('recordMatchWin increments matchWins only for the winning team', () => {
    const g = makeGame('1x1')
    g.startHand()
    g.recordMatchWin(0)
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(1)
    expect(g.players.find((p) => p.id === 'b')!.matchWins).toBe(0)
    g.recordMatchWin(null)
    expect(g.players.find((p) => p.id === 'a')!.matchWins).toBe(1) // unchanged on a tie
  })

  test('round end scores meld points, hand penalty and morto penalty correctly (no canastra -> no batida bonus)', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    const other = cur === 'a' ? 'b' : 'a'
    const curTeam = g.players.find((p) => p.id === cur)!.teamIndex
    const otherTeam = g.players.find((p) => p.id === other)!.teamIndex

    // Opponent never acts — leave them with 1 known card (Ace, worth 15) and
    // no morto pickup, for a predictable penalty.
    setHand(g, other, [card('p1', 'diamonds', 'A')])

    // First (harmless) direct batida just to take the morto — see the test above.
    g.drawStock(cur)
    setHand(g, cur, [card('c0', 'hearts', '5'), card('c1', 'diamonds', '5'), card('c2', 'clubs', '5')]) // group, 15 pts
    g.layMeld(cur, ['c0', 'c1', 'c2'])
    expect(g.tableState.teams[curTeam].mortoTaken).toBe(true)

    // Now replace the (random) morto hand with a controlled final meld that
    // empties the hand for real, ending the round.
    setHand(g, cur, [card('d0', 'hearts', 'A'), card('d1', 'diamonds', 'A'), card('d2', 'clubs', 'A')]) // group, 45 pts
    expect(g.layMeld(cur, ['d0', 'd1', 'd2'])).toBe(true)

    expect(g.tableState.phase).toBe('round_end')
    const result = g.lastRoundResult!
    expect(result.breakdown[curTeam]).toEqual({ meldPoints: 60, handPenalty: 0, mortoPenalty: 0, battingBonus: 0, total: 60 })
    expect(result.breakdown[otherTeam]).toEqual({ meldPoints: 0, handPenalty: -15, mortoPenalty: -100, battingBonus: 0, total: -115 })
    expect(result.winnerTeam).toBe(curTeam)
  })

  test('the +100 batida bonus only applies when the winning team closed with a canastra', () => {
    const g = makeGame('1x1')
    g.startHand()
    const cur = g.currentPlayerId()!
    const other = cur === 'a' ? 'b' : 'a'
    const curTeam = g.players.find((p) => p.id === cur)!.teamIndex

    setHand(g, other, [])

    g.drawStock(cur)
    setHand(g, cur, [card('c0', 'hearts', '5'), card('c1', 'diamonds', '5'), card('c2', 'clubs', '5')])
    g.layMeld(cur, ['c0', 'c1', 'c2']) // morto rescue

    const canastraCards = ['4', '5', '6', '7', '8', '9', '10'].map((r, i) => card(`k${i}`, 'hearts', r as Rank))
    setHand(g, cur, canastraCards)
    expect(g.layMeld(cur, canastraCards.map((c) => c.id))).toBe(true)

    expect(g.tableState.phase).toBe('round_end')
    expect(g.lastRoundResult!.breakdown[curTeam].battingBonus).toBe(100)
  })
})
