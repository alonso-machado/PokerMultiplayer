/**
 * Tests for the Blackjack/21 engine (server/src/blackjack/). See
 * .claude/Blackjack.md for the rules these scenarios are derived from.
 */

import { describe, test, expect } from 'bun:test'
import type { Card, Rank, Suit } from '../../shared/types'
import { createDeck, shuffle, handValue, isBust, isBlackjack } from '../src/blackjack/deck'
import { BlackjackGame } from '../src/blackjack/gameEngine'
import { parseClientMessage } from '../src/validation'

function card(suit: Suit, rank: Rank): Card { return { suit, rank } }

// ─── Wire protocol ──────────────────────────────────────────────────────────
// Regression coverage for the manual whitelist in validation.ts — every
// blackjack_* client message must round-trip through parseClientMessage, or
// the server silently drops it (this broke room creation once already, see
// the canastra_* block above for the original incident).

describe('parseClientMessage — blackjack_*', () => {
  function parse(msg: unknown) { return parseClientMessage(JSON.stringify(msg)) }

  test('blackjack_join takes no fields — matchmaking, not room creation', () => {
    expect(parse({ type: 'blackjack_join' })).toEqual({ type: 'blackjack_join' })
    // Extra junk fields are simply ignored, not rejected.
    expect(parse({ type: 'blackjack_join', roomId: 'x' })).toEqual({ type: 'blackjack_join' })
  })

  test('blackjack_leave_room / hit / stand / double / split round-trip', () => {
    expect(parse({ type: 'blackjack_leave_room' })).toEqual({ type: 'blackjack_leave_room' })
    expect(parse({ type: 'blackjack_hit' })).toEqual({ type: 'blackjack_hit' })
    expect(parse({ type: 'blackjack_stand' })).toEqual({ type: 'blackjack_stand' })
    expect(parse({ type: 'blackjack_double' })).toEqual({ type: 'blackjack_double' })
    expect(parse({ type: 'blackjack_split' })).toEqual({ type: 'blackjack_split' })
  })

  test('blackjack_place_bet requires a positive integer amount', () => {
    expect(parse({ type: 'blackjack_place_bet', amount: 25 })).toEqual({ type: 'blackjack_place_bet', amount: 25 })
    expect(parse({ type: 'blackjack_place_bet', amount: 0 })).toBeNull()
    expect(parse({ type: 'blackjack_place_bet', amount: -5 })).toBeNull()
    expect(parse({ type: 'blackjack_place_bet', amount: 1.5 })).toBeNull()
    expect(parse({ type: 'blackjack_place_bet' })).toBeNull()
  })

  test('blackjack_insurance_bet allows 0 (decline) but not negative', () => {
    expect(parse({ type: 'blackjack_insurance_bet', amount: 0 })).toEqual({ type: 'blackjack_insurance_bet', amount: 0 })
    expect(parse({ type: 'blackjack_insurance_bet', amount: 10 })).toEqual({ type: 'blackjack_insurance_bet', amount: 10 })
    expect(parse({ type: 'blackjack_insurance_bet', amount: -1 })).toBeNull()
  })
})

// ─── Deck / hand value ──────────────────────────────────────────────────────

describe('createDeck', () => {
  test('has 52 unique cards, no jokers', () => {
    const deck = createDeck()
    expect(deck.length).toBe(52)
    expect(new Set(deck.map((c) => `${c.suit}-${c.rank}`)).size).toBe(52)
  })

  test('shuffle preserves the multiset', () => {
    const deck = createDeck()
    const shuffled = shuffle(deck)
    const key = (c: Card) => `${c.suit}-${c.rank}`
    expect(shuffled.length).toBe(deck.length)
    expect(shuffled.map(key).sort()).toEqual(deck.map(key).sort())
  })
})

describe('handValue', () => {
  test('hard totals sum pip/face values', () => {
    expect(handValue([card('spades', '10'), card('hearts', '7')])).toEqual({ total: 17, soft: false })
  })

  test('a single Ace counts as 11 when it fits (soft)', () => {
    expect(handValue([card('spades', 'A'), card('hearts', '6')])).toEqual({ total: 17, soft: true })
  })

  test('an Ace falls back to 1 to avoid busting', () => {
    expect(handValue([card('spades', 'A'), card('hearts', '9'), card('clubs', '5')])).toEqual({ total: 15, soft: false })
  })

  test('two Aces: one stays soft (11), the other reduces to 1', () => {
    expect(handValue([card('spades', 'A'), card('hearts', 'A'), card('clubs', '9')])).toEqual({ total: 21, soft: true })
  })

  test('isBust / isBlackjack', () => {
    expect(isBust([card('spades', '10'), card('hearts', '9'), card('clubs', '5')])).toBe(true)
    expect(isBlackjack([card('spades', 'A'), card('hearts', 'K')])).toBe(true)
    // 21 from 3 cards is not a natural blackjack.
    expect(isBlackjack([card('spades', '7'), card('hearts', '7'), card('clubs', '7')])).toBe(false)
  })
})

// ─── BlackjackGame ──────────────────────────────────────────────────────────

function makeGame(ids: string[]): BlackjackGame {
  const g = new BlackjackGame()
  for (const id of ids) g.addPlayer(id, id.toUpperCase())
  return g
}

/** Deals a round with fully controlled cards, bypassing the shuffled deck —
 *  same pattern truco.test.ts uses for hole cards (setHandsBySeat), extended
 *  here to also control the dealer's hand and every subsequent draw, since
 *  dealRound() always reshuffles a fresh deck internally. Replicates
 *  dealRound()'s branching (ace → insurance, 10-value → peek, else → player
 *  turns) so the real resolvePeek()/advanceTurn() machinery still runs. */
function dealFixedRound(
  g: BlackjackGame, bets: Record<string, number>, playerCards: Record<string, Card[]>,
  dealerCards: [Card, Card], nextDraws: Card[] = [],
): void {
  g.openBetting()
  for (const [id, amt] of Object.entries(bets)) expect(g.placeBet(id, amt)).toBe(true)
  const gg = g as any
  gg.pendingBets.clear()
  gg.deck = [...nextDraws].reverse() // draw() pops from the end
  gg.dealerCards = [...dealerCards]
  gg.dealerHoleHidden = true
  for (const p of g.players) {
    const cards = playerCards[p.id]
    if (!cards) { p.hands = []; continue }
    const bj = isBlackjack(cards)
    p.hands = [{ cards: [...cards], bet: bets[p.id]!, isDoubled: false, isSplitAces: false, isBusted: false, isBlackjack: bj, isStood: bj, outcome: null, payout: 0 }]
  }
  const up = dealerCards[0]
  const upIsAce = up.rank === 'A'
  const upIsTen = up.rank === '10' || up.rank === 'J' || up.rank === 'Q' || up.rank === 'K'
  if (upIsAce) { gg.phase = 'insurance'; gg.insuranceDecided.clear(); return }
  if (upIsTen) { g.resolvePeek(); return }
  gg.phase = 'player_turns'
  gg.currentSeat = null
  gg.currentHandIndex = null
  gg.advanceTurn()
}

describe('BlackjackGame — betting', () => {
  test('placeBet enforces 1 ≤ amount ≤ chips, and only during the betting phase', () => {
    const g = makeGame(['a'])
    g.openBetting()
    expect(g.placeBet('a', 0)).toBe(false)
    expect(g.placeBet('a', 101)).toBe(false) // starting chips = 100
    expect(g.placeBet('a', 40)).toBe(true)
    expect(g.players[0]!.chips).toBe(60)
    expect(g.placeBet('a', 10)).toBe(false) // one bet per round — no re-betting once placed
  })

  test('allPlayersBet / hasBettors', () => {
    const g = makeGame(['a', 'b'])
    g.openBetting()
    expect(g.hasBettors()).toBe(false)
    expect(g.allPlayersBet()).toBe(false)
    g.placeBet('a', 10)
    expect(g.allPlayersBet()).toBe(false)
    g.placeBet('b', 10)
    expect(g.allPlayersBet()).toBe(true)
  })

  test('seats are reused: a freed seat goes to the next joiner', () => {
    const g = makeGame(['a', 'b'])
    expect(g.players.map((p) => p.seatIndex)).toEqual([0, 1])
    g.removePlayer('a')
    g.addPlayer('c', 'C')
    expect(g.players.find((p) => p.id === 'c')!.seatIndex).toBe(0)
  })
})

describe('BlackjackGame — round resolution', () => {
  test('dealer busts: standing player wins 1:1', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '10'), card('clubs', '7')] }, [card('spades', '6'), card('diamonds', '10')], [card('clubs', '10')])
    expect(g.stand('a')).toBe(true)
    expect(g.tableState.phase).toBe('round_end')
    const h = g.players[0]!.hands[0]!
    expect(h.outcome).toBe('win')
    expect(h.payout).toBe(20)
    expect(g.players[0]!.chips).toBe(100 - 10 + 20)
  })

  test('higher total without a dealer bust also wins 1:1', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '10'), card('clubs', '9')] }, [card('spades', '10'), card('diamonds', '7')])
    g.stand('a')
    const h = g.players[0]!.hands[0]!
    expect(h.outcome).toBe('win')
    expect(h.payout).toBe(20)
  })

  test('equal totals push — bet returned, no profit', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '10'), card('clubs', '8')] }, [card('spades', '10'), card('diamonds', '8')])
    g.stand('a')
    const h = g.players[0]!.hands[0]!
    expect(h.outcome).toBe('push')
    expect(h.payout).toBe(10)
    expect(g.players[0]!.chips).toBe(100)
  })

  test('busting on a hit loses immediately, no refund', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '10'), card('clubs', '6')] }, [card('spades', '9'), card('diamonds', '9')], [card('clubs', '10')])
    expect(g.hit('a')).toBe(true)
    const h = g.players[0]!.hands[0]!
    expect(h.isBusted).toBe(true)
    expect(g.tableState.phase).toBe('round_end') // dealer (18, already ≥17) needed no further action
    expect(h.outcome).toBe('lose')
    expect(h.payout).toBe(0)
    expect(g.players[0]!.chips).toBe(90)
  })

  test('natural blackjack pays 3:2 even against a non-natural dealer 21', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', 'A'), card('clubs', 'K')] }, [card('spades', '7'), card('diamonds', '8')], [card('clubs', '5')])
    // p1 already auto-stood (blackjack) and the deal itself resolves the round (single player, nothing else to act on).
    expect(g.tableState.phase).toBe('round_end')
    const h = g.players[0]!.hands[0]!
    expect(h.outcome).toBe('blackjack')
    expect(h.payout).toBe(10 + 15) // bet + floor(10*3/2)
    expect(g.players[0]!.chips).toBe(100 - 10 + 25)
  })
})

describe('BlackjackGame — dealer blackjack / insurance', () => {
  test('dealer blackjack resolves immediately: player blackjack pushes, others lose, no player turns', () => {
    const g = makeGame(['a', 'b'])
    dealFixedRound(
      g, { a: 10, b: 10 },
      { a: [card('hearts', 'A'), card('clubs', '9')], b: [card('hearts', 'A'), card('clubs', 'K')] },
      [card('spades', 'A'), card('diamonds', 'K')],
    )
    expect(g.tableState.phase).toBe('insurance')
    g.resolvePeek()
    expect(g.tableState.phase).toBe('round_end')
    expect(g.players[0]!.hands[0]!.outcome).toBe('lose')   // a: 20, not blackjack
    expect(g.players[0]!.hands[0]!.payout).toBe(0)
    expect(g.players[1]!.hands[0]!.outcome).toBe('push')   // b: also blackjack
    expect(g.players[1]!.hands[0]!.payout).toBe(10)
  })

  test('insurance pays 2:1 (+ stake back) when the dealer does have blackjack', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 20 }, { a: [card('hearts', '9'), card('clubs', '8')] }, [card('spades', 'A'), card('diamonds', 'K')])
    expect(g.tableState.phase).toBe('insurance')
    expect(g.placeInsurance('a', 10)).toBe(true)   // max = floor(20/2) = 10
    expect(g.placeInsurance('a', 11)).toBe(false)  // over the cap — call before resolving, still capped
    expect(g.players[0]!.chips).toBe(100 - 20 - 10)
    g.resolvePeek()
    expect(g.players[0]!.hands[0]!.outcome).toBe('lose')
    // Lost the main bet, but insurance paid 3x the 10-chip stake (30) back.
    expect(g.players[0]!.chips).toBe(100 - 20 - 10 + 30)
  })

  test('insurance is forfeited when the dealer does not have blackjack, and play continues', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 20 }, { a: [card('hearts', '9'), card('clubs', '8')] }, [card('spades', 'A'), card('diamonds', '6')])
    g.placeInsurance('a', 10)
    g.resolvePeek()
    expect(g.tableState.phase).toBe('player_turns')
    expect(g.players[0]!.chips).toBe(100 - 20 - 10) // insurance stake gone, not refunded
  })

  test('a 10-value up-card peeks for blackjack with no insurance offered', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '9'), card('clubs', '8')] }, [card('spades', 'K'), card('diamonds', 'A')])
    // dealFixedRound already calls resolvePeek() internally for a 10-value up-card.
    expect(g.tableState.phase).toBe('round_end')
    expect(g.players[0]!.hands[0]!.outcome).toBe('lose')
  })
})

describe('BlackjackGame — double down', () => {
  test('doubles the bet, takes exactly one card, and ends the hand', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '9'), card('clubs', '2')] }, [card('spades', '6'), card('diamonds', '10')], [card('clubs', '10'), card('hearts', '4')])
    expect(g.double('a')).toBe(true)
    const h = g.players[0]!.hands[0]!
    expect(h.cards.length).toBe(3)
    expect(h.bet).toBe(20)
    expect(h.isDoubled).toBe(true)
    expect(h.isStood).toBe(true)
    expect(g.hit('a')).toBe(false) // can't act again on a doubled hand
    // dealer 16 hits (draws the '4' → 20), player 21 beats it
    expect(g.tableState.phase).toBe('round_end')
    expect(h.outcome).toBe('win')
    expect(h.payout).toBe(40)
  })

  test('double is unavailable without enough chips to match the bet', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 100 }, { a: [card('hearts', '9'), card('clubs', '2')] }, [card('spades', '6'), card('diamonds', '10')])
    expect(g.turnInfo('a').validActions).not.toContain('double')
    expect(g.double('a')).toBe(false)
  })
})

describe('BlackjackGame — split', () => {
  test('splitting a pair creates two independently-resolved hands', () => {
    const g = makeGame(['a'])
    dealFixedRound(
      g, { a: 10 }, { a: [card('hearts', '8'), card('clubs', '8')] },
      [card('spades', '6'), card('diamonds', '10')],
      [card('clubs', '3'), card('hearts', '9'), card('diamonds', '10')], // hand0 2nd card, hand1 2nd card, dealer hit
    )
    expect(g.turnInfo('a').validActions).toContain('split')
    expect(g.split('a')).toBe(true)
    expect(g.players[0]!.chips).toBe(100 - 10 - 10) // second bet taken immediately
    expect(g.players[0]!.hands.length).toBe(2)
    expect(g.players[0]!.hands[0]!.cards.map((c) => c.rank)).toEqual(['8', '3'])   // 11
    expect(g.players[0]!.hands[1]!.cards.map((c) => c.rank)).toEqual(['8', '9'])   // 17
    expect(g.split('a')).toBe(false) // no resplitting

    expect(g.stand('a')).toBe(true) // hand0 (11) stands
    expect(g.tableState.currentHandIndex).toBe(1)
    expect(g.stand('a')).toBe(true) // hand1 (17) stands → dealer plays (16 hits the '10' → 26 bust)

    expect(g.tableState.phase).toBe('round_end')
    expect(g.players[0]!.hands[0]!.outcome).toBe('win') // 11 beats a busted dealer
    expect(g.players[0]!.hands[1]!.outcome).toBe('win') // 17 beats a busted dealer
  })

  test('splitting Aces deals one card per hand and auto-stands both — never a natural blackjack', () => {
    const g = makeGame(['a'])
    dealFixedRound(
      g, { a: 10 }, { a: [card('hearts', 'A'), card('clubs', 'A')] },
      [card('spades', '6'), card('diamonds', '9')],
      [card('clubs', 'K'), card('hearts', '9'), card('diamonds', '2')], // hand0, hand1, dealer hit (15→17)
    )
    expect(g.split('a')).toBe(true)
    // Split-aces auto-resolves the whole turn order — single player, both hands already stood.
    expect(g.tableState.phase).toBe('round_end')
    const [h0, h1] = g.players[0]!.hands
    expect(h0!.isSplitAces).toBe(true)
    expect(h0!.isStood).toBe(true)
    expect(h0!.isBlackjack).toBe(false) // A+K after a split is a strong 21, not a natural
    expect(h0!.outcome).toBe('win')     // 21 beats dealer's 17
    expect(h0!.payout).toBe(20)          // 1:1, not the 3:2 blackjack rate
    expect(h1!.outcome).toBe('win')      // A+9 = 20 also beats 17
  })

  test('split requires a same-rank pair and enough chips for the second bet', () => {
    const g = makeGame(['a'])
    dealFixedRound(g, { a: 10 }, { a: [card('hearts', '8'), card('clubs', '9')] }, [card('spades', '6'), card('diamonds', '9')])
    expect(g.split('a')).toBe(false) // not a pair

    const g2 = makeGame(['a'])
    dealFixedRound(g2, { a: 100 }, { a: [card('hearts', '8'), card('clubs', '8')] }, [card('spades', '6'), card('diamonds', '9')])
    expect(g2.split('a')).toBe(false) // no chips left to match the bet
  })
})

describe('BlackjackGame — leaving mid-round', () => {
  test('leaving during betting refunds the not-yet-dealt bet', () => {
    const g = makeGame(['a'])
    g.openBetting()
    g.placeBet('a', 40)
    expect(g.players[0]!.chips).toBe(60)
    g.handleLeaveDuringRound('a')
    expect(g.players[0]!.chips).toBe(100)
    expect(g.hasBettors()).toBe(false)
  })

  test('leaving mid-round forfeits the live hand and hands play to the next seat', () => {
    const g = makeGame(['a', 'b'])
    dealFixedRound(
      g, { a: 10, b: 10 },
      { a: [card('hearts', '9'), card('clubs', '2')], b: [card('hearts', '9'), card('clubs', '8')] },
      [card('spades', '6'), card('diamonds', '10')],
    )
    expect(g.currentPlayerId()).toBe('a')
    g.handleLeaveDuringRound('a')
    expect(g.players[0]!.hands[0]!.outcome).toBe('lose')
    expect(g.players[0]!.hands[0]!.payout).toBe(0)
    expect(g.currentPlayerId()).toBe('b') // turn moved on
    g.removePlayer('a')
    expect(g.players.map((p) => p.id)).toEqual(['b'])
  })
})

describe('BlackjackGame — bustedPlayerIds', () => {
  test('flags only players left at exactly 0 chips after the round', () => {
    const g = makeGame(['a', 'b'])
    dealFixedRound(
      g, { a: 100, b: 10 },
      { a: [card('hearts', '10'), card('clubs', '6')], b: [card('hearts', '10'), card('clubs', '9')] },
      [card('spades', '9'), card('diamonds', '9')], [card('clubs', 'K')],
    )
    g.hit('a') // 16 + 10 = 26, busts, loses the full 100
    expect(g.players[0]!.chips).toBe(0)
    g.stand('b') // 19 vs dealer 18 → wins
    expect(g.bustedPlayerIds()).toEqual(['a'])
  })
})
