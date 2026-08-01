const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
// Truco base ranking (weakest → strongest). No 8/9/10, no jokers.
const BASE_RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
// Manilha suit strength for the 'vira' variant (Paulista), strongest → weakest:
// Paus (Zap) > Copas > Espadas (Espadilha) > Ouros.
const SUIT_STRENGTH = { clubs: 4, hearts: 3, spades: 2, diamonds: 1 };
// Fixed manilhas for the 'fixed' variant (Mineiro), strongest → weakest.
const FIXED_MANILHAS = [
    { suit: 'diamonds', rank: '7' }, // 7♦
    { suit: 'spades', rank: 'A' }, // A♠
    { suit: 'hearts', rank: '7' }, // 7♥
    { suit: 'clubs', rank: '4' }, // 4♣ (zap)
];
export function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of BASE_RANKS) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}
export function shuffle(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}
/**
 * Resolves the manilha context for a new hand. For the 'vira' variant this
 * draws (pops) the vira card from `deck` — call after shuffling, before
 * dealing hole cards.
 */
export function resolveManilha(variant, deck) {
    if (variant === 'fixed') {
        return { variant, vira: null, manilhaCards: FIXED_MANILHAS };
    }
    const vira = deck.pop();
    if (!vira)
        throw new Error('deck exhausted before drawing vira');
    const viraIdx = BASE_RANKS.indexOf(vira.rank);
    const manilhaRank = BASE_RANKS[(viraIdx + 1) % BASE_RANKS.length];
    const manilhaCards = SUITS.map((suit) => ({ suit, rank: manilhaRank }));
    return { variant, vira, manilhaCards };
}
function isManilha(card, ctx) {
    return ctx.manilhaCards.some((m) => m.suit === card.suit && m.rank === card.rank);
}
/**
 * Strength of a card given the hand's manilha context — higher wins.
 * Manilhas always outrank non-manilhas. Among manilhas: fixed order
 * (Mineiro) or suit order (Paulista) breaks ties. Among non-manilhas: base
 * rank order — equal rank across different suits is a true tie (see
 * .claude/Truco.md → "Empate de vaza").
 */
export function cardStrength(card, ctx) {
    if (isManilha(card, ctx)) {
        if (ctx.variant === 'fixed') {
            const idx = FIXED_MANILHAS.findIndex((m) => m.suit === card.suit && m.rank === card.rank);
            return 1000 + (FIXED_MANILHAS.length - idx);
        }
        return 1000 + SUIT_STRENGTH[card.suit];
    }
    return BASE_RANKS.indexOf(card.rank);
}
/** > 0 if a beats b, < 0 if b beats a, 0 if they tie. */
export function compareCards(a, b, ctx) {
    return cardStrength(a, ctx) - cardStrength(b, ctx);
}
