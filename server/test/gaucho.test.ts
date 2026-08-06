/**
 * Tests for the Truco Gaúcho / Espanhol engine (server/src/gaucho/). See
 * .claude/TrucoGaucho.md for the rules these scenarios are derived from —
 * it links back to .claude/Truco.md for whatever this variant reuses as-is
 * (vaza structure, empate cascade, mão de 11/ferro), so those are only
 * spot-checked here, not re-derived.
 */

import { describe, test, expect } from 'bun:test'
import type { Card, GauchoMode } from '../../shared/types'
import { cardStrength, envidoValue, hasFlor, florValue, FIXED_MANILHAS } from '../src/gaucho/deck'
import { GauchoGame } from '../src/gaucho/gameEngine'

// ─── deck: ranking & manilhas ───────────────────────────────────────────────

describe('base ranking (Spanish-deck order — differs from Truco Paulista)', () => {
  test('Q beats J (opposite of Paulista, where J beats Q)', () => {
    expect(cardStrength({ suit: 'clubs', rank: 'Q' })).toBeGreaterThan(cardStrength({ suit: 'clubs', rank: 'J' }))
  })

  test('full weak→strong order: 4,5,6,7,J,Q,K,A,2,3', () => {
    const order: Card['rank'][] = ['4', '5', '6', '7', 'J', 'Q', 'K', 'A', '2', '3']
    for (let i = 1; i < order.length; i++) {
      const prev = cardStrength({ suit: 'hearts', rank: order[i - 1]! })
      const cur = cardStrength({ suit: 'hearts', rank: order[i]! })
      expect(cur).toBeGreaterThan(prev)
    }
  })
})

describe('fixed manilhas: A♠ > A♣ > 7♠ > 7♦', () => {
  test('strength order', () => {
    const espadilha = cardStrength({ suit: 'spades', rank: 'A' })
    const basto = cardStrength({ suit: 'clubs', rank: 'A' })
    const seteEspadas = cardStrength({ suit: 'spades', rank: '7' })
    const seteOuros = cardStrength({ suit: 'diamonds', rank: '7' })
    expect(espadilha).toBeGreaterThan(basto)
    expect(basto).toBeGreaterThan(seteEspadas)
    expect(seteEspadas).toBeGreaterThan(seteOuros)
  })

  test('any manilha outranks any non-manilha, including the strongest base rank (3)', () => {
    const seteOuros = cardStrength({ suit: 'diamonds', rank: '7' }) // weakest manilha
    const tresOuros = cardStrength({ suit: 'diamonds', rank: '3' }) // strongest non-manilha
    expect(seteOuros).toBeGreaterThan(tresOuros)
  })

  test('only these 4 specific cards are manilha — same rank, other suit, is not', () => {
    expect(FIXED_MANILHAS).toContainEqual({ suit: 'spades', rank: '7' })
    expect(cardStrength({ suit: 'hearts', rank: '7' })).toBeLessThan(cardStrength({ suit: 'diamonds', rank: '7' }))
  })
})

describe('envido value', () => {
  test('same-suit pair: sum + 20', () => {
    expect(envidoValue([{ suit: 'hearts', rank: '5' }, { suit: 'hearts', rank: '6' }, { suit: 'diamonds', rank: '2' }])).toBe(31)
  })

  test('no pair: highest single card, face cards worth 0', () => {
    expect(envidoValue([{ suit: 'clubs', rank: 'A' }, { suit: 'hearts', rank: 'K' }, { suit: 'diamonds', rank: '7' }])).toBe(7)
  })

  test('best pair chosen when all 3 cards share a suit', () => {
    // 5+6=11, 5+2=7, 6+2=8 → best is 5+6=11, +20 = 31
    expect(envidoValue([{ suit: 'spades', rank: '5' }, { suit: 'spades', rank: '6' }, { suit: 'spades', rank: '2' }])).toBe(31)
  })

  test('hasFlor / florValue', () => {
    const hand: Card[] = [{ suit: 'clubs', rank: '4' }, { suit: 'clubs', rank: '5' }, { suit: 'clubs', rank: '6' }]
    expect(hasFlor(hand)).toBe(true)
    expect(florValue(hand)).toBe(4 + 5 + 6 + 20)
    expect(hasFlor([{ suit: 'clubs', rank: '4' }, { suit: 'hearts', rank: '5' }, { suit: 'clubs', rank: '6' }])).toBe(false)
  })
})

// ─── GauchoGame test helpers ────────────────────────────────────────────────

function makeGame(mode: GauchoMode): GauchoGame {
  const g = new GauchoGame({ mode })
  const seats = mode === '1x1' ? [['a', 'A'], ['b', 'B']] : [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']]
  for (const [id, name] of seats) g.addPlayer(id!, name!)
  return g
}

/** Overwrites each player's dealt hand directly (bypasses the shuffled deck
 *  for deterministic tests) and recomputes the envido/flor window exactly
 *  like `startHand()` does, since it can't reflect the original random deal
 *  anymore. */
function setHandsBySeat(g: GauchoGame, hands: Card[][]): void {
  for (const p of g.players) {
    const hand = [...hands[p.seatIndex]!]
    p.holeCards = [...hand]
    p.dealtCards = hand
    p.hasFlor = hasFlor(hand)
  }
  const anyFlor = g.players.some((p) => p.hasFlor)
  ;(g as unknown as { _florStatus: string })._florStatus = anyFlor ? 'available' : 'closed'
  ;(g as unknown as { _envidoStatus: string })._envidoStatus = anyFlor ? 'closed' : 'available'
}

function setScores(g: GauchoGame, scores: [number, number]): void {
  ;(g as unknown as { _scores: [number, number] })._scores = scores
}

function autoPlay(g: GauchoGame): boolean {
  const pid = g.currentPlayerId()
  if (!pid) return false
  const player = g.players.find((p) => p.id === pid)!
  const card = player.holeCards[0]
  if (!card) return false
  return g.playCard(pid, card)
}

function playAllVazas(g: GauchoGame, maxPlays = 12): void {
  for (let i = 0; i < maxPlays; i++) {
    if (g.tableState.phase !== 'playing') break
    if (!autoPlay(g)) throw new Error('autoPlay failed')
  }
}

/** Deals a hand where `winningTeam` holds the two strongest non-manilha ranks
 *  and the other team holds only the weakest — guarantees a clean 2-0 win.
 *  None of these ranks/suits are Gaúcho manilhas or form a flor. */
function winSimpleHand(g: GauchoGame, winningTeam: 0 | 1): void {
  g.startHand()
  if (g.tableState.phase === 'mao_de_onze_decision') {
    for (const t of [0, 1] as const) {
      const rep = g.players.find((p) => p.teamIndex === t)
      if (rep) g.maoDeOnzeDecision(rep.id, true) // no-op if `t` isn't pending
    }
  }
  if (g.tableState.phase !== 'playing') return
  const strong: Card[] = [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }]
  const weak: Card[] = [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }]
  for (const p of g.players) { p.holeCards = [...(p.teamIndex === winningTeam ? strong : weak)] }
  playAllVazas(g)
}

// ─── Vaza structure (spot-check — full tie table lives in truco.test.ts) ───

describe('vaza resolution (reused mechanics from Truco.md)', () => {
  test('2 vazas decide the hand, using Gaúcho manilha strength', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    setHandsBySeat(g, [
      /* a seat0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      /* b seat1 */ [{ suit: 'spades', rank: 'A' }, { suit: 'clubs', rank: 'A' }, { suit: 'diamonds', rank: '3' }], // 2 manilhas
    ])
    playAllVazas(g)
    expect(g.tableState.phase).toBe('hand_end')
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'vazas' })
  })
})

// ─── Truco escalation (1 → 2 → 3 → 4) ───────────────────────────────────────

describe('truco call escalation', () => {
  test('escalates 1 → 2 → 3 → 4 and refuses to go past 4 (vale quatro)', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    // b's first card beats a's first card outright, so b keeps the leaderSeat
    // (and the eligible-to-call turn) once vaza 1 resolves mid-escalation.
    setHandsBySeat(g, [
      /* a seat0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      /* b seat1 */ [{ suit: 'diamonds', rank: '3' }, { suit: 'hearts', rank: '5' }, { suit: 'clubs', rank: '6' }],
    ])
    expect(g.callTruco('b')).toBe(true)
    expect(g.respondTruco('a', true)).toBe(true)
    expect(g.tableState.stake).toBe(2)

    expect(g.playCard('b', g.players.find((p) => p.id === 'b')!.holeCards[0]!)).toBe(true)
    expect(g.callTruco('a')).toBe(true)
    expect(g.respondTruco('b', true)).toBe(true)
    expect(g.tableState.stake).toBe(3)

    expect(g.playCard('a', g.players.find((p) => p.id === 'a')!.holeCards[0]!)).toBe(true)
    expect(g.callTruco('b')).toBe(true)
    expect(g.respondTruco('a', true)).toBe(true)
    expect(g.tableState.stake).toBe(4)

    expect(g.callTruco('b')).toBe(false) // already at the cap
  })

  test('decline ("corro") awards the last accepted stake', () => {
    const g = makeGame('1x1')
    g.startHand()
    g.callTruco('b') // pending 2
    g.respondTruco('a', false)
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'corri' })
    expect(g.tableState.scores).toEqual([0, 1])
  })
})

// ─── Envido ─────────────────────────────────────────────────────────────────

describe('Envido', () => {
  test('opens only during vaza 1, for the current-turn player', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    // Force a flor-free deal — startHand() draws real random cards, which
    // could otherwise occasionally close the envido window before this
    // assertion (see "flor corta o envido").
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }],
    ])
    expect(g.callEnvido('a')).toBe(false) // not a's turn
    expect(g.callEnvido('b')).toBe(true)
  })

  test('accept compares team values (2x2) and scores immediately — higher wins', () => {
    const g = makeGame('2x2')
    g.startHand() // leader = seat1 (b, team1)
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'hearts', rank: '6' }, { suit: 'hearts', rank: '5' }, { suit: 'diamonds', rank: '2' }], // 31
      /* b seat1 team1 */ [{ suit: 'diamonds', rank: '7' }, { suit: 'diamonds', rank: '6' }, { suit: 'clubs', rank: 'K' }], // 33
      /* c seat2 team0 */ [{ suit: 'clubs', rank: '2' }, { suit: 'diamonds', rank: 'K' }, { suit: 'spades', rank: 'Q' }],   // 2
      /* d seat3 team1 */ [{ suit: 'spades', rank: 'K' }, { suit: 'hearts', rank: 'J' }, { suit: 'clubs', rank: 'Q' }],     // 0
    ])
    expect(g.callEnvido('b')).toBe(true)
    expect(g.respondEnvido('a', true)).toBe(true)
    expect(g.lastEnvidoResult).toEqual({ winnerTeam: 1, points: 2, reason: 'compared', values: { a: 31, b: 33, c: 2, d: 0 } })
    expect(g.tableState.scores).toEqual([0, 2])
    expect(g.tableState.envido.status).toBe('closed')
  })

  test('tie in comparison goes to the team holding "a mão" (leaderSeat)', () => {
    const g = makeGame('2x2')
    g.startHand() // leader = seat1 (b, team1)
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'hearts', rank: '2' }, { suit: 'hearts', rank: '3' }, { suit: 'clubs', rank: 'K' }], // 25
      /* b seat1 team1 */ [{ suit: 'diamonds', rank: '2' }, { suit: 'diamonds', rank: '3' }, { suit: 'hearts', rank: 'K' }], // 25
      /* c seat2 team0 */ [{ suit: 'clubs', rank: '2' }, { suit: 'diamonds', rank: 'Q' }, { suit: 'spades', rank: 'K' }],
      /* d seat3 team1 */ [{ suit: 'spades', rank: 'Q' }, { suit: 'hearts', rank: 'J' }, { suit: 'clubs', rank: 'Q' }],
    ])
    expect(g.callEnvido('b')).toBe(true)
    expect(g.respondEnvido('a', true)).toBe(true)
    expect(g.lastEnvidoResult!.winnerTeam).toBe(1) // leaderSeat 1 → team1
  })

  test('raising past envido without ever accepting, then declining, floors at 1', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }],
    ])
    expect(g.callEnvido('b')).toBe(true)          // pending 'envido'
    expect(g.callEnvido('a')).toBe(true)          // a raises straight to real_envido
    expect(g.tableState.envido.pendingCall).toBe('real_envido')
    expect(g.respondEnvido('b', false)).toBe(true) // b declines the real_envido
    expect(g.lastEnvidoResult).toEqual({ winnerTeam: 0, points: 1, reason: 'corri', values: {} })
  })

  test('falta_envido value = points needed for the leading team to reach 12', () => {
    const g = makeGame('1x1')
    setScores(g, [8, 5])
    g.startHand()
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }],
    ])
    expect(g.callEnvido('b')).toBe(true)
    expect(g.callEnvido('a')).toBe(true) // real_envido
    expect(g.callEnvido('b')).toBe(true) // falta_envido
    expect(g.tableState.envido.pendingCall).toBe('falta_envido')
    expect(g.respondEnvido('a', true)).toBe(true)
    expect(g.lastEnvidoResult!.points).toBe(4) // 12 - max(8,5)
  })

  test('closes for the hand once vaza 1 resolves without being called', () => {
    const g = makeGame('1x1')
    g.startHand()
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }],
    ])
    autoPlay(g); autoPlay(g) // vaza 1 played out by both
    expect(g.tableState.envido.status).toBe('closed')
    expect(g.callEnvido('b')).toBe(false)
  })

  test('truco corta o envido — calling truco force-closes an unopened envido', () => {
    const g = makeGame('1x1')
    g.startHand()
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '3' }, { suit: 'diamonds', rank: '2' }, { suit: 'spades', rank: '5' }],
    ])
    expect(g.tableState.envido.status).toBe('available')
    expect(g.callTruco('b')).toBe(true)
    expect(g.tableState.envido.status).toBe('closed')
    expect(g.callEnvido('a')).toBe(false)
  })
})

// ─── Flor ───────────────────────────────────────────────────────────────────

describe('Flor', () => {
  test('flor corta o envido — envido is closed for the whole hand if anyone has flor', () => {
    const g = makeGame('1x1')
    g.startHand()
    setHandsBySeat(g, [
      [{ suit: 'clubs', rank: '4' }, { suit: 'clubs', rank: '5' }, { suit: 'clubs', rank: '6' }], // a has flor
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
    ])
    expect(g.tableState.flor.status).toBe('available')
    expect(g.tableState.envido.status).toBe('closed')
    expect(g.callEnvido('b')).toBe(false)
  })

  test('uncontested flor auto-scores 3 points immediately, no response window', () => {
    const g = makeGame('1x1')
    g.startHand() // leader = seat1 (b)
    setHandsBySeat(g, [
      [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      [{ suit: 'clubs', rank: '4' }, { suit: 'clubs', rank: '5' }, { suit: 'clubs', rank: '6' }], // b has flor
    ])
    expect(g.callFlor('a')).toBe(false) // a doesn't have flor
    expect(g.callFlor('b')).toBe(true)
    expect(g.tableState.flor.awaitingResponseFromTeam).toBeNull()
    expect(g.lastFlorResult).toEqual({ winnerTeam: 1, points: 3, reason: 'uncontested', values: { b: 4 + 5 + 6 + 20 } })
    expect(g.tableState.scores).toEqual([0, 3])
  })

  test('contested flor (both teams hold it) compares values on accept', () => {
    const g = makeGame('2x2')
    g.startHand() // leader = seat1 (b, team1)
    setHandsBySeat(g, [
      /* a seat0 team0 */ [{ suit: 'clubs', rank: '4' }, { suit: 'clubs', rank: '5' }, { suit: 'clubs', rank: '6' }],   // flor = 35
      /* b seat1 team1 */ [{ suit: 'diamonds', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'diamonds', rank: 'K' }], // flor = 29
      /* c seat2 team0 */ [{ suit: 'hearts', rank: '4' }, { suit: 'diamonds', rank: '5' }, { suit: 'spades', rank: '6' }],
      /* d seat3 team1 */ [{ suit: 'spades', rank: '4' }, { suit: 'hearts', rank: '5' }, { suit: 'clubs', rank: '6' }],
    ])
    expect(g.callFlor('b')).toBe(true) // opens — a's team also has flor, so it's contested
    expect(g.tableState.flor.awaitingResponseFromTeam).toBe(0)
    expect(g.respondFlor('a', true)).toBe(true)
    expect(g.lastFlorResult).toEqual({ winnerTeam: 0, points: 3, reason: 'compared', values: { a: 35, b: 29 } })
  })
})

// ─── Mão de 11 (reused mechanics — spot check only) ────────────────────────

describe('mão de 11', () => {
  test('reaching 11 gates the next hand; declining cedes 1 point', () => {
    const g = makeGame('2x2')
    for (let i = 0; i < 11; i++) winSimpleHand(g, 0)
    expect(g.tableState.scores).toEqual([11, 0])

    g.startHand()
    expect(g.tableState.phase).toBe('mao_de_onze_decision')
    const team0Player = g.players.find((p) => p.teamIndex === 0)!
    expect(g.maoDeOnzeDecision(team0Player.id, false)).toBe(true)
    expect(g.lastHandResult).toEqual({ winnerTeam: 1, points: 1, reason: 'mao_de_onze_run' })
  })
})

// ─── Match end ──────────────────────────────────────────────────────────────

describe('match end', () => {
  test('match ends at 12; matchWins persist across resetForRematch', () => {
    const g = makeGame('1x1')
    for (let i = 0; i < 12; i++) winSimpleHand(g, 0)
    expect(g.isMatchOver()).toBe(true)
    expect(g.matchResult()).toEqual({ winnerTeam: 0, scores: [12, 0] })

    g.recordMatchWin(0)
    g.resetForRematch()
    expect(g.tableState.scores).toEqual([0, 0])
    expect(g.isMatchOver()).toBe(false)
    for (const p of g.players) expect(p.matchWins).toBe(p.teamIndex === 0 ? 1 : 0)
  })
})
