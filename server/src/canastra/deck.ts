import type { Suit, Rank, CanastraCard } from '../../../shared/types'

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/** 108 cards: 2 full 52-card decks + 4 jokers. Each card gets a unique `id`
 *  because the double deck has duplicate suit+rank combinations — see
 *  .claude/Canastra.md → "Baralho". */
export function createDeck(): CanastraCard[] {
  const deck: CanastraCard[] = []
  for (const copy of [1, 2]) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `d${copy}-${suit}-${rank}`, suit, rank, isJoker: false })
      }
    }
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `joker-${i}`, suit: null, rank: null, isJoker: true })
  }
  return deck
}

export function shuffle<T>(deck: T[]): T[] {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j]!, d[i]!]
  }
  return d
}

/** Point value of a single card — used both for meld scoring and the
 *  end-of-round penalty on cards left in hand. See .claude/Canastra.md
 *  → "Pontos por carta". */
export function cardValue(card: CanastraCard): number {
  if (card.isJoker) return 50
  switch (card.rank) {
    case 'A': return 15
    case '2': return 10
    case '3': case '4': case '5': case '6': case '7': return 5
    default: return 10 // 8, 9, 10, J, Q, K
  }
}

/** `2`s and jokers are wildcards everywhere *except* a `2` sitting in its
 *  natural low-end sequence slot (e.g. A-2-3 or 2-3-4 of the same suit) —
 *  that specific case is resolved inside `validateSequence`, not here. */
function isWildCard(card: CanastraCard): boolean {
  return card.isJoker || card.rank === '2'
}

export interface MeldValidation {
  kind: 'sequence' | 'group'
  wildcardCount: number
  isCanastra: boolean
  isClean: boolean
}

// Ace-low and Ace-high rank orders — a sequence must fit as a contiguous
// window in *one* of these (no K-A-2 wraparound). See .claude/Canastra.md
// → "Jogos válidos".
const LOW_ACE: Rank[]  = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const HIGH_ACE: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function validateSequence(cards: CanastraCard[]): MeldValidation | null {
  const jokers = cards.filter((c) => c.isJoker)
  const twos = cards.filter((c) => !c.isJoker && c.rank === '2')
  const others = cards.filter((c) => !c.isJoker && c.rank !== '2')
  if (others.length === 0) return null // need at least one definite natural to anchor the suit

  const suit = others[0]!.suit
  if (others.some((c) => c.suit !== suit)) return null
  if (new Set(others.map((c) => c.rank)).size !== others.length) return null // duplicate rank

  const sameSuitTwos = twos.filter((t) => t.suit === suit)
  const offSuitTwos = twos.filter((t) => t.suit !== suit)

  // At most 1 wildcard substitute total. A same-suit `2` can additionally
  // sit "for free" in its natural low slot without counting against the cap.
  const pureWilds = jokers.length + offSuitTwos.length
  if (pureWilds > 1) return null
  const remainingBudget = 1 - pureWilds
  const extraSameSuitTwos = Math.max(0, sameSuitTwos.length - 1) // only 1 can be "natural"
  if (extraSameSuitTwos > remainingBudget) return null

  const wildcardCount = pureWilds + extraSameSuitTwos
  const naturalRanks = others.map((c) => c.rank!)
  if (sameSuitTwos.length >= 1) naturalRanks.push('2')

  const length = cards.length
  for (const order of [LOW_ACE, HIGH_ACE]) {
    const idxs = naturalRanks.map((r) => order.indexOf(r))
    const min = Math.min(...idxs)
    const max = Math.max(...idxs)
    if (max - min + 1 > length) continue
    const startMin = Math.max(0, max - length + 1)
    const startMax = Math.min(min, order.length - length)
    if (startMin <= startMax) {
      return { kind: 'sequence', wildcardCount, isCanastra: length >= 7, isClean: wildcardCount === 0 }
    }
  }
  return null
}

function validateGroup(cards: CanastraCard[]): MeldValidation | null {
  const naturals = cards.filter((c) => !isWildCard(c))
  const wilds = cards.filter(isWildCard)
  if (naturals.length === 0) return null
  const rank = naturals[0]!.rank
  if (naturals.some((c) => c.rank !== rank)) return null
  if (wilds.length > 1) return null
  return { kind: 'group', wildcardCount: wilds.length, isCanastra: cards.length >= 7, isClean: wilds.length === 0 }
}

/** Validates a candidate meld (3+ cards) as either a sequence or a group.
 *  Returns null if invalid. See .claude/Canastra.md → "Jogos válidos". */
export function validateMeld(cards: CanastraCard[]): MeldValidation | null {
  if (cards.length < 3) return null
  return validateSequence(cards) ?? validateGroup(cards)
}
