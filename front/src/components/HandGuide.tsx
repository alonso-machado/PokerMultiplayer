import { useState } from 'react'
import { PlayingCard } from './PlayingCard'
import type { Card } from '../../../shared/types'

interface HandExample {
  rank: number
  nameEn: string        // English name (primary, bold)
  namePt: string        // Portuguese (secondary, muted)
  subtitle: string      // one-line description
  cards: Card[]
  probability: string   // % chance in 5-card deal
  color: string         // rank badge color
}

const HANDS: HandExample[] = [
  {
    rank: 1, nameEn: 'Royal Flush', namePt: 'Flush Real',
    subtitle: '5 cartas altas do mesmo naipe',
    probability: '0.000154%', color: '#f1c40f',
    cards: [
      { rank: 'A',  suit: 'spades' }, { rank: 'K',  suit: 'spades' },
      { rank: 'Q',  suit: 'spades' }, { rank: 'J',  suit: 'spades' },
      { rank: '10', suit: 'spades' },
    ],
  },
  {
    rank: 2, nameEn: 'Straight Flush', namePt: 'Sequência de Cor',
    subtitle: '5 cartas em sequência do mesmo naipe',
    probability: '0.00139%', color: '#e74c3c',
    cards: [
      { rank: '9', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '7', suit: 'hearts' }, { rank: '6', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
    ],
  },
  {
    rank: 3, nameEn: 'Four of a Kind', namePt: 'Quadra',
    subtitle: '4 cartas do mesmo valor',
    probability: '0.0240%', color: '#9b59b6',
    cards: [
      { rank: 'Q', suit: 'spades' }, { rank: 'Q', suit: 'hearts' },
      { rank: 'Q', suit: 'diamonds' }, { rank: 'Q', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ],
  },
  {
    rank: 4, nameEn: 'Full House', namePt: 'Full House',
    subtitle: 'Trinca + Par',
    probability: '0.1441%', color: '#e67e22',
    cards: [
      { rank: 'J', suit: 'spades' }, { rank: 'J', suit: 'hearts' },
      { rank: 'J', suit: 'clubs' },  { rank: '9', suit: 'spades' },
      { rank: '9', suit: 'diamonds' },
    ],
  },
  {
    rank: 5, nameEn: 'Flush', namePt: 'Cor',
    subtitle: '5 cartas do mesmo naipe',
    probability: '0.1965%', color: '#2980b9',
    cards: [
      { rank: 'A', suit: 'diamonds' }, { rank: 'J', suit: 'diamonds' },
      { rank: '8', suit: 'diamonds' }, { rank: '5', suit: 'diamonds' },
      { rank: '2', suit: 'diamonds' },
    ],
  },
  {
    rank: 6, nameEn: 'Straight', namePt: 'Sequência',
    subtitle: '5 cartas em sequência',
    probability: '0.3925%', color: '#27ae60',
    cards: [
      { rank: '10', suit: 'spades' }, { rank: '9', suit: 'hearts' },
      { rank: '8',  suit: 'diamonds' }, { rank: '7', suit: 'clubs' },
      { rank: '6',  suit: 'spades' },
    ],
  },
  {
    rank: 7, nameEn: 'Three of a Kind', namePt: 'Trinca',
    subtitle: '3 cartas do mesmo valor',
    probability: '2.1128%', color: '#16a085',
    cards: [
      { rank: '7', suit: 'spades' }, { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' }, { rank: 'K', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ],
  },
  {
    rank: 8, nameEn: 'Two Pair', namePt: 'Dois Pares',
    subtitle: '2 pares de valores diferentes',
    probability: '4.7539%', color: '#7f8c8d',
    cards: [
      { rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'diamonds' },
      { rank: '8', suit: 'hearts' }, { rank: '8', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ],
  },
  {
    rank: 9, nameEn: 'Pair', namePt: 'Par',
    subtitle: '2 cartas do mesmo valor',
    probability: '42.26%', color: '#95a5a6',
    cards: [
      { rank: '5', suit: 'spades' }, { rank: '5', suit: 'hearts' },
      { rank: 'A', suit: 'clubs' },  { rank: 'J', suit: 'diamonds' },
      { rank: '8', suit: 'spades' },
    ],
  },
  {
    rank: 10, nameEn: 'High Card', namePt: 'Carta Alta',
    subtitle: 'Nenhuma combinação — vence a carta mais alta',
    probability: '50.12%', color: '#bdc3c7',
    cards: [
      { rank: 'A', suit: 'clubs' },  { rank: 'J', suit: 'spades' },
      { rank: '9', suit: 'diamonds' }, { rank: '6', suit: 'hearts' },
      { rank: '2', suit: 'spades' },
    ],
  },
]

export function HandGuide() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Guia de mãos do poker"
        aria-label="Guia de mãos"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="hg-header">
          <h2>Hand Rankings</h2>
          <span className="hg-sub">da mais forte para a mais fraca</span>
        </div>

        <div className="hg-list">
          {HANDS.map(hand => (
            <div key={hand.rank} className="hg-hand">
              <div className="hg-hand-header">
                <span className="hg-rank" style={{ background: hand.color }}>#{hand.rank}</span>
                <div className="hg-hand-info">
                  <span className="hg-hand-name">
                    {hand.nameEn}
                    {hand.namePt !== hand.nameEn && (
                      <span className="hg-name-pt"> ({hand.namePt})</span>
                    )}
                  </span>
                  <span className="hg-hand-sub">{hand.subtitle}</span>
                </div>
                <span className="hg-prob">{hand.probability}</span>
              </div>
              <div className="hg-cards">
                {hand.cards.map((card, i) => (
                  <PlayingCard key={i} card={card} width={34} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="hg-footer">
          <p>Probabilidades em mãos de 5 cartas (baralho de 52).</p>
          <p>No Texas Hold'em combinam-se as 2 cartas da mão com até 5 da mesa.</p>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
