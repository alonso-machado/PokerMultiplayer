import type { Card } from '../../../shared/types'

// Maps our card format to react-playing-cards format
// react-playing-cards expects: "AS" (ace spades), "KH" (king hearts), etc.
const RANK_MAP: Record<string, string> = {
  'A': 'A', 'K': 'K', 'Q': 'Q', 'J': 'J',
  '10': '0', '9': '9', '8': '8', '7': '7',
  '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
}
const SUIT_MAP: Record<string, string> = {
  spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C',
}

interface Props {
  card?: Card
  faceDown?: boolean
  width?: number
}

// Simple SVG card fallback — avoids dependency issues with react-playing-cards
const SUIT_SYMBOL: Record<string, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
}
const RED_SUITS = new Set(['hearts', 'diamonds'])

export function PlayingCard({ card, faceDown, width = 52 }: Props) {
  const height = Math.round(width * 1.4)

  if (faceDown || !card) {
    return (
      <svg width={width} height={height} viewBox="0 0 52 74" xmlns="http://www.w3.org/2000/svg">
        <rect width="52" height="74" rx="5" fill="#1a4fa0" stroke="#fff" strokeWidth="1.5" />
        <rect x="4" y="4" width="44" height="66" rx="4" fill="#2260c0" stroke="#4a80d0" strokeWidth="1" />
        <text x="26" y="43" textAnchor="middle" fontSize="22" fill="#4a80d0">🂠</text>
      </svg>
    )
  }

  const color = RED_SUITS.has(card.suit) ? '#c0392b' : '#1a1a2e'
  const sym = SUIT_SYMBOL[card.suit] ?? ''

  return (
    <svg width={width} height={height} viewBox="0 0 52 74" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="74" rx="5" fill="#fff" stroke="#ccc" strokeWidth="1" />
      <text x="4" y="14" fontSize="11" fontWeight="bold" fill={color}>{card.rank}</text>
      <text x="4" y="25" fontSize="10" fill={color}>{sym}</text>
      <text x="26" y="44" textAnchor="middle" fontSize="22" fill={color}>{sym}</text>
      <text x="48" y="70" textAnchor="end" fontSize="11" fontWeight="bold" fill={color}
        transform="rotate(180 26 65)">{card.rank}</text>
    </svg>
  )
}

// Keep the mapping exports in case we switch to react-playing-cards later
export function toRpcCode(card: Card): string {
  return (RANK_MAP[card.rank] ?? card.rank) + SUIT_MAP[card.suit]
}
