/**
 * Tests for the Push Your Luck Draw engine (server/src/pushyourluckdraw/).
 * See .claude/PushYourLuckDraw.md for the rules these scenarios cover.
 */

import { describe, test, expect } from 'bun:test'
import type { PushYourLuckDrawCard, PushYourLuckDrawJokerMode, Rank } from '../../shared/types'
import { PushYourLuckDrawGame } from '../src/pushyourluckdraw/gameEngine'
import { buildDeck, isAceOfSpades, rankPoints, JOKERS_PER_PLAYER, FIXED_JOKER_COUNT, jokerCountFor } from '../src/pushyourluckdraw/deck'
import { parseClientMessage } from '../src/validation'

function numberCard(rank: Rank, id = `${rank}-${Math.random()}`): PushYourLuckDrawCard {
  return { id, suit: 'hearts', rank, isJoker: false, isHalf: false }
}
function aceOfSpades(): PushYourLuckDrawCard {
  return { id: 'ace-of-spades', suit: 'spades', rank: 'A', isJoker: false, isHalf: false }
}
function joker(id = `joker-${Math.random()}`): PushYourLuckDrawCard {
  return { id, suit: null, rank: null, isJoker: true, isHalf: false }
}
function halfCard(id = `half-${Math.random()}`): PushYourLuckDrawCard {
  return { id, suit: null, rank: null, isJoker: false, isHalf: true }
}

function makeGame(
  ids: string[],
  overrides: Partial<{ maxPlayers: number; targetScore: number; jokerMode: PushYourLuckDrawJokerMode }> = {},
): PushYourLuckDrawGame {
  const g = new PushYourLuckDrawGame({
    maxPlayers: overrides.maxPlayers ?? 8,
    targetScore: overrides.targetScore ?? 150,
    jokerMode: overrides.jokerMode ?? 'per_player',
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
    const config = { maxPlayers: 4, targetScore: 150, jokerMode: 'per_player' }
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config }))
      .toEqual({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config })
    const fixedConfig = { maxPlayers: 4, targetScore: 150, jokerMode: 'fixed' }
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: fixedConfig }))
      .toEqual({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: fixedConfig })
  })

  test('rejects an out-of-range maxPlayers/targetScore, or an invalid jokerMode', () => {
    const base = { maxPlayers: 4, targetScore: 150, jokerMode: 'per_player' }
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, maxPlayers: 1 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, maxPlayers: 9 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, targetScore: 10 } })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_create_room', roomName: 'Mesa', config: { ...base, jokerMode: 'bogus' } })).toBeNull()
  })

  test('join_room / leave_room / list_rooms / start_game / draw / stop round-trip', () => {
    expect(parse({ type: 'pushyourluckdraw_join_room', roomId: 'abc123' })).toEqual({ type: 'pushyourluckdraw_join_room', roomId: 'abc123' })
    expect(parse({ type: 'pushyourluckdraw_leave_room' })).toEqual({ type: 'pushyourluckdraw_leave_room' })
    expect(parse({ type: 'pushyourluckdraw_list_rooms' })).toEqual({ type: 'pushyourluckdraw_list_rooms' })
    expect(parse({ type: 'pushyourluckdraw_start_game' })).toEqual({ type: 'pushyourluckdraw_start_game' })
    expect(parse({ type: 'pushyourluckdraw_draw' })).toEqual({ type: 'pushyourluckdraw_draw' })
    expect(parse({ type: 'pushyourluckdraw_stop' })).toEqual({ type: 'pushyourluckdraw_stop' })
  })

  test('pushyourluckdraw_throw_joker round-trips, rejects a missing/oversized targetId', () => {
    expect(parse({ type: 'pushyourluckdraw_throw_joker', targetId: 'p2' })).toEqual({ type: 'pushyourluckdraw_throw_joker', targetId: 'p2' })
    expect(parse({ type: 'pushyourluckdraw_throw_joker', targetId: '' })).toBeNull()
    expect(parse({ type: 'pushyourluckdraw_throw_joker' })).toBeNull()
  })

  test('pushyourluckdraw_rematch_vote round-trips', () => {
    expect(parse({ type: 'pushyourluckdraw_rematch_vote', accept: true })).toEqual({ type: 'pushyourluckdraw_rematch_vote', accept: true })
    expect(parse({ type: 'pushyourluckdraw_rematch_vote', accept: 'yes' })).toBeNull()
  })
})

// ─── Deck ───────────────────────────────────────────────────────────────────

describe('buildDeck', () => {
  test('per_player mode: copies(rank) = value(rank) for 2..K, 1 Ace of Spades, JOKERS_PER_PLAYER × playerCount Jokers', () => {
    const deck = buildDeck(4, 'per_player')
    expect(deck.length).toBe(91 + JOKERS_PER_PLAYER * 4)   // 91 = sum(2..13) + 1 Ace

    const jokers = deck.filter((c) => c.isJoker)
    expect(jokers.length).toBe(JOKERS_PER_PLAYER * 4)

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

  test('Joker count scales with player count in per_player mode', () => {
    expect(buildDeck(2, 'per_player').filter((c) => c.isJoker).length).toBe(JOKERS_PER_PLAYER * 2)
    expect(buildDeck(8, 'per_player').filter((c) => c.isJoker).length).toBe(JOKERS_PER_PLAYER * 8)
  })

  test('fixed mode: always FIXED_JOKER_COUNT Jokers, regardless of player count', () => {
    expect(buildDeck(2, 'fixed').filter((c) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)
    expect(buildDeck(8, 'fixed').filter((c) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)
  })

  test('jokerCountFor matches buildDeck for both modes', () => {
    expect(jokerCountFor('per_player', 5)).toBe(JOKERS_PER_PLAYER * 5)
    expect(jokerCountFor('fixed', 5)).toBe(FIXED_JOKER_COUNT)
  })

  test('every card has a unique id', () => {
    const deck = buildDeck(5, 'per_player')
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

  test('roundScore stays 0 while active — the live "current hand value" preview is a front-end-only computation', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    setMonte(g, [numberCard('K')])
    g.draw(first)
    expect(p.roundScore).toBe(0)
    expect(p.status).toBe('active')
  })
})

describe('draw — duplicate rank (bust rule)', () => {
  test('busts without a held joker: hand cleared, status busted, round score 0, previousHand exposed for the UI', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    const held = numberCard('7', '7-a')
    p.roundHand = [held]
    setMonte(g, [numberCard('7', '7-b')])
    const outcome = g.draw(first)
    expect(outcome).toMatchObject({ kind: 'busted', previousHand: [held] })
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

// ─── Joker throw / '@' halving ──────────────────────────────────────────────

describe('throwJoker', () => {
  test('rejects with fewer than 2 saves held — the first Joker must always stay in reserve', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'
    const p = g.players.find((pl) => pl.id === first)!
    p.savesHeld = 1
    expect(g.throwJoker(first, other)).toBe(false)
    expect(p.savesHeld).toBe(1)
  })

  test('with 2+ saves held, spends exactly 1 and drops an @ card into the target\'s round hand', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'
    const p = g.players.find((pl) => pl.id === first)!
    p.savesHeld = 2
    expect(g.throwJoker(first, other)).toBe(true)
    expect(p.savesHeld).toBe(1)
    const target = g.players.find((pl) => pl.id === other)!
    expect(target.roundHand.some((c) => c.isHalf)).toBe(true)
  })

  test('consumes the thrower\'s turn (like draw/stop) but they stay active', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'
    g.players.find((pl) => pl.id === first)!.savesHeld = 2
    g.throwJoker(first, other)
    expect(g.currentPlayerId()).toBe(other)
    expect(g.players.find((pl) => pl.id === first)!.status).toBe('active')
  })

  test('cannot target yourself', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    g.players.find((pl) => pl.id === first)!.savesHeld = 2
    expect(g.throwJoker(first, first)).toBe(false)
  })

  test('cannot target a player who already stood or busted this round', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const target = g.players.map((p) => p.id).filter((id) => id !== first)[0]!
    g.players.find((pl) => pl.id === target)!.status = 'stood'   // already resolved this round
    g.players.find((pl) => pl.id === first)!.savesHeld = 2
    expect(g.throwJoker(first, target)).toBe(false)
  })

  test('a player already carrying an @ cannot receive a second one — throws don\'t stack', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'
    const p = g.players.find((pl) => pl.id === first)!
    const target = g.players.find((pl) => pl.id === other)!
    target.roundHand = [halfCard('existing')]
    p.savesHeld = 2
    expect(g.throwJoker(first, other)).toBe(false)
    expect(target.roundHand).toHaveLength(1)
  })

  test('rejects out of turn', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = first === 'a' ? 'b' : 'a'
    g.players.find((pl) => pl.id === other)!.savesHeld = 2
    expect(g.throwJoker(other, first)).toBe(false)
  })
})

describe('@ halving applied at score time', () => {
  test('halves the plain sum (floored) when the target stops', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('K'), numberCard('4'), halfCard()]   // 13+4=17 -> floor(17/2)=8
    g.stop(first)
    expect(p.roundScore).toBe(8)
  })

  test('Ace doubles first, then @ halves — a hand with both nets back to the plain sum', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [aceOfSpades(), numberCard('K'), numberCard('9'), halfCard()]   // (13+9)*2=44 -> /2=22
    g.stop(first)
    expect(p.roundScore).toBe(22)
  })

  test('busting with an @ in hand still scores 0 — the halving never gets applied', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const p = g.players.find((pl) => pl.id === first)!
    p.roundHand = [numberCard('7', '7-a'), halfCard()]
    setMonte(g, [numberCard('7', '7-b')])
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
  test('regression: isRoundComplete() is true even on the round that also ends the match', () => {
    // The Room only calls finishRound() (and, from there, finishMatch()) when
    // isRoundComplete() is true. checkRoundEnd() jumps the phase straight to
    // 'match_complete' on a match-winning round — isRoundComplete() checking
    // only 'round_complete' would silently skip finishRound()/finishMatch()
    // on exactly that round: no round_end, no match_end, no rematch vote ever
    // broadcast. The match would just stop with no winner shown (this exact
    // bug shipped once — see .claude/PushYourLuckDraw.md).
    const g = makeGame(['a', 'b'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    a.totalScore = 140
    a.roundHand = [numberCard('K')]   // -> 153, crosses the target

    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)

    expect(g.isMatchOver()).toBe(true)
    expect(g.isRoundComplete()).toBe(true)
    expect(g.lastMatchResult).not.toBeNull()
  })

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

describe('joining mid-match (family-friendly drop-in — see .claude/PushYourLuckDraw.md)', () => {
  test('a player added mid-round stays "waiting", never blocks round completion, and gets dealt in next round', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    g.addPlayer('c', 'C')   // joins while a/b's round is already in progress
    expect(g.players.find((p) => p.id === 'c')!.status).toBe('waiting')

    // a and b resolve the round on their own — c is never asked to act.
    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)
    expect(g.tableState.phase).toBe('round_complete')
    const c = g.players.find((p) => p.id === 'c')!
    expect(c.status).toBe('waiting')
    expect(c.totalScore).toBe(0)

    g.startRound()   // next round — c is now a full participant
    expect(c.status).toBe('active')
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

// ─── Deck lifecycle: dealt once per match, reshuffled from discard only when it runs dry ──

describe('deck lifecycle', () => {
  test('startMatch deals playerCount-sized Jokers into a fresh monte', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    expect((g as any).monte.length).toBe(91 + JOKERS_PER_PLAYER * 3)
  })

  test('the monte carries over between rounds instead of being rebuilt', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    expect((g as any).monte.length).toBe(91 + JOKERS_PER_PLAYER * 2)

    setMonte(g, [numberCard('4')])   // leave just 1 card in the monte
    const first = g.currentPlayerId()!
    g.draw(first)                    // consumes the only card — monte now empty
    expect((g as any).monte.length).toBe(0)

    g.stop(g.currentPlayerId()!)     // the other player stands — turn returns to `first`
    expect(g.tableState.phase).toBe('playing')
    g.stop(first)                    // now both are resolved — round ends
    expect(g.tableState.phase).toBe('round_complete')

    g.startRound()
    // The deck is never topped back up between rounds within a match.
    expect((g as any).monte.length).toBeLessThan(91 + JOKERS_PER_PLAYER * 2)
  })

  test('cards discarded this round (bust, saved duplicate) accumulate and recycle into the monte once it runs dry', () => {
    const g = makeGame(['a', 'b'])
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
    const g = makeGame(['a', 'b'])
    g.startMatch()
    ;(g as any).monte = []
    ;(g as any).descarte = []
    const cur = g.currentPlayerId()!
    const outcome = g.draw(cur)
    expect(outcome).toEqual({ kind: 'forced_stop' })
    expect(g.players.find((p) => p.id === cur)!.status).toBe('stood')
  })

  test('a round-end discard from the previous round is available to recycle in the round after that', () => {
    const g = makeGame(['a', 'b'])
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

  test('startMatch always resets the deck to the current seated player count, even after a rematch', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    g.addPlayer('c', 'C')   // seated count changes before the rematch
    g.startMatch()          // simulates an accepted rematch vote
    expect((g as any).monte.length).toBe(91 + JOKERS_PER_PLAYER * 3)
  })
})

// ─── Live Joker rescaling on mid-match join/leave ──────────────────────────

describe('Joker count rescales live as players join/leave mid-match', () => {
  test('joining before the match starts is just bookkeeping — no early top-up', () => {
    const g = makeGame(['a'])
    g.addPlayer('b', 'B')   // still pre-match — startMatch() hasn't run yet
    expect((g as any).monte.length).toBe(0)
    expect((g as any).descarte.length).toBe(0)
  })

  test('joining mid-match tops up the live monte by JOKERS_PER_PLAYER', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const before = (g as any).monte.length
    const jokersBefore = (g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length

    g.addPlayer('c', 'C')

    expect((g as any).monte.length).toBe(before + JOKERS_PER_PLAYER)
    const jokersAfter = (g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length
    expect(jokersAfter).toBe(jokersBefore + JOKERS_PER_PLAYER)
  })

  test('leaving mid-match removes JOKERS_PER_PLAYER from the monte first', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const before = (g as any).monte.length
    const jokersBefore = (g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length
    expect(jokersBefore).toBeGreaterThanOrEqual(JOKERS_PER_PLAYER)   // sanity: enough in the monte to cover the removal

    g.removePlayer('c')

    expect((g as any).monte.length).toBe(before - JOKERS_PER_PLAYER)
  })

  test('leaving spills into the discard pile once the monte runs short on Jokers', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    // Force every Joker out of the monte and into the discard, as if they'd all been drawn/discarded already.
    const monteJokers = (g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker)
    ;(g as any).monte = (g as any).monte.filter((c: PushYourLuckDrawCard) => !c.isJoker)
    ;(g as any).descarte = [...(g as any).descarte, ...monteJokers]
    const descarteJokersBefore = (g as any).descarte.filter((c: PushYourLuckDrawCard) => c.isJoker).length
    expect(descarteJokersBefore).toBeGreaterThanOrEqual(JOKERS_PER_PLAYER)

    g.removePlayer('c')

    const monteJokersAfter = (g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length
    const descarteJokersAfter = (g as any).descarte.filter((c: PushYourLuckDrawCard) => c.isJoker).length
    expect(monteJokersAfter).toBe(0)   // nothing to remove from an empty monte
    expect(descarteJokersBefore - descarteJokersAfter).toBe(JOKERS_PER_PLAYER)
  })

  test('leaving never touches a remaining player\'s banked savesHeld or dealt round hand', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    a.savesHeld = 2
    a.roundHand = [numberCard('5')]

    g.removePlayer('c')

    expect(a.savesHeld).toBe(2)
    expect(a.roundHand).toHaveLength(1)
    expect(a.roundHand[0]!.rank).toBe('5')
  })
})

describe('Joker count is untouched by join/leave in fixed mode', () => {
  test('startMatch deals exactly FIXED_JOKER_COUNT regardless of player count', () => {
    const g2 = makeGame(['a', 'b'], { jokerMode: 'fixed' })
    g2.startMatch()
    expect((g2 as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)

    const g5 = makeGame(['a', 'b', 'c', 'd', 'e'], { jokerMode: 'fixed' })
    g5.startMatch()
    expect((g5 as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)
  })

  test('joining mid-match does not change the deck size at all', () => {
    const g = makeGame(['a', 'b'], { jokerMode: 'fixed' })
    g.startMatch()
    const before = (g as any).monte.length

    g.addPlayer('c', 'C')

    expect((g as any).monte.length).toBe(before)
    expect((g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)
  })

  test('leaving mid-match does not change the deck size at all', () => {
    const g = makeGame(['a', 'b', 'c'], { jokerMode: 'fixed' })
    g.startMatch()
    const before = (g as any).monte.length

    g.removePlayer('c')

    expect((g as any).monte.length).toBe(before)
    expect((g as any).monte.filter((c: PushYourLuckDrawCard) => c.isJoker).length).toBe(FIXED_JOKER_COUNT)
  })
})

// ─── disconnectPlayer / restoreScore (score-preserving departure) ──────────

describe('disconnectPlayer', () => {
  test('returns null and does nothing for an unknown id', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    expect(g.disconnectPlayer('ghost')).toBeNull()
    expect(g.players).toHaveLength(2)
  })

  test('removes the player (same seat/Joker bookkeeping as removePlayer) and returns their score snapshot', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    a.totalScore = 42
    a.matchWins = 2
    const before = (g as any).monte.length

    const snapshot = g.disconnectPlayer('a')

    expect(snapshot).toEqual({ totalScore: 42, matchWins: 2 })
    expect(g.players.map((p) => p.id)).toEqual(['b', 'c'])
    // per_player mode (default in makeGame): removal also trims JOKERS_PER_PLAYER from the deck.
    expect((g as any).monte.length).toBe(before - JOKERS_PER_PLAYER)
  })

  test('advances the turn if it was the disconnecting player\'s turn right now', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const first = g.currentPlayerId()!
    g.disconnectPlayer(first)
    expect(g.currentPlayerId()).not.toBe(first)
    expect(g.currentPlayerId()).not.toBeNull()
  })

  test('does not touch the turn if it wasn\'t the disconnecting player\'s turn', () => {
    const g = makeGame(['a', 'b', 'c'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const other = g.players.map((p) => p.id).filter((id) => id !== first)[0]!
    g.disconnectPlayer(other)
    expect(g.currentPlayerId()).toBe(first)
  })

  test('completes the round if the disconnecting player was the last one still active', () => {
    const g = makeGame(['a', 'b'])
    g.startMatch()
    const first = g.currentPlayerId()!
    const second = first === 'a' ? 'b' : 'a'
    g.stop(first)   // first resolved and the turn passed on — second is now the only one still active
    expect(g.currentPlayerId()).toBe(second)
    expect(g.tableState.phase).toBe('playing')

    g.disconnectPlayer(second)

    expect(['round_complete', 'match_complete']).toContain(g.tableState.phase)
  })

  test('during match_complete (rematch-vote window), just removes them — no turn/round side effects', () => {
    const g = makeGame(['a', 'b'], { targetScore: 150 })
    g.startMatch()
    const a = g.players.find((p) => p.id === 'a')!
    const b = g.players.find((p) => p.id === 'b')!
    a.totalScore = 200   // already over target
    b.totalScore = 50
    g.stop(g.currentPlayerId()!)
    g.stop(g.currentPlayerId()!)
    expect(g.isMatchOver()).toBe(true)

    const snapshot = g.disconnectPlayer('b')

    expect(snapshot).toEqual({ totalScore: 50, matchWins: 0 })
    expect(g.players.map((p) => p.id)).toEqual(['a'])
    expect(g.tableState.phase).toBe('match_complete')   // untouched — no re-run of round/match-end logic
  })
})

describe('restoreScore', () => {
  test('overlays a snapshot onto a freshly-seated player (addPlayer always starts them at 0)', () => {
    const g = makeGame(['a'])
    g.startMatch()
    g.addPlayer('b', 'B')
    const b = g.players.find((p) => p.id === 'b')!
    expect(b.totalScore).toBe(0)

    g.restoreScore('b', { totalScore: 77, matchWins: 3 })

    expect(b.totalScore).toBe(77)
    expect(b.matchWins).toBe(3)
  })

  test('does nothing for an id that isn\'t currently seated', () => {
    const g = makeGame(['a'])
    g.startMatch()
    expect(() => g.restoreScore('ghost', { totalScore: 10, matchWins: 0 })).not.toThrow()
  })
})
