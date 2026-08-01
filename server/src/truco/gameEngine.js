import { createDeck, shuffle, resolveManilha, cardStrength } from './deck';
const LEVELS = [1, 3, 6, 9, 12];
export class TrucoGame {
    config;
    players = [];
    deck = [];
    handCount = 0;
    manilhaCtx;
    _phase = 'waiting';
    _vaza = 1;
    _vazaCardsPlayed = [];
    _vazaWinners = [];
    _stake = 1;
    _pendingStake = null;
    _stakeCalledByTeam = null;
    _awaitingResponseFromTeam = null;
    _dealerSeat = -1;
    _leaderSeat = 0;
    _currentSeat = 0;
    _scores = [0, 0];
    _maoDeOnzePendingTeams = new Set();
    _maoDeOnzeDecisions = new Map();
    _lastHandResult = null;
    constructor(config) {
        this.config = config;
        this.manilhaCtx = { variant: config.manilhaVariant, vira: null, manilhaCards: [] };
    }
    get maxPlayers() {
        return this.config.mode === '1x1' ? 2 : 4;
    }
    get tableState() {
        return {
            phase: this._phase,
            vira: this.manilhaCtx.vira,
            manilhaCards: [...this.manilhaCtx.manilhaCards],
            vaza: this._vaza,
            vazaCardsPlayed: [...this._vazaCardsPlayed],
            vazaWinners: [...this._vazaWinners],
            stake: this._stake,
            stakeCalledByTeam: this._stakeCalledByTeam,
            awaitingResponseFromTeam: this._awaitingResponseFromTeam,
            dealerSeat: this._dealerSeat,
            leaderSeat: this._leaderSeat,
            currentSeat: this._currentSeat,
            scores: [...this._scores],
        };
    }
    get lastHandResult() {
        return this._lastHandResult;
    }
    // ── Player management ───────────────────────────────────────────────────
    addPlayer(id, name) {
        const seat = this.nextSeat();
        const teamIndex = (this.config.mode === '1x1' ? seat : seat % 2);
        this.players.push({
            id, name, seatIndex: seat, teamIndex,
            status: 'waiting', matchWins: 0, holeCards: [],
        });
    }
    removePlayer(id) {
        this.players = this.players.filter((p) => p.id !== id);
    }
    nextSeat() {
        const used = new Set(this.players.map((p) => p.seatIndex));
        for (let i = 0; i < this.maxPlayers; i++)
            if (!used.has(i))
                return i;
        return this.players.length;
    }
    teamOf(playerId) {
        return this.players.find((p) => p.id === playerId).teamIndex;
    }
    playerAtSeat(seat) {
        return this.players.find((p) => p.seatIndex === seat);
    }
    // ── Match / hand lifecycle ──────────────────────────────────────────────
    /** Resets scores to 0-0 for a rematch. matchWins persist on `players`. */
    resetForRematch() {
        this._scores = [0, 0];
        this._dealerSeat = -1;
        this.handCount = 0;
    }
    recordMatchWin(team) {
        for (const p of this.players)
            if (p.teamIndex === team)
                p.matchWins++;
    }
    startHand() {
        this.handCount++;
        this.deck = shuffle(createDeck());
        this.manilhaCtx = resolveManilha(this.config.manilhaVariant, this.deck);
        this._vaza = 1;
        this._vazaCardsPlayed = [];
        this._vazaWinners = [];
        this._stake = 1;
        this._pendingStake = null;
        this._stakeCalledByTeam = null;
        this._awaitingResponseFromTeam = null;
        this._lastHandResult = null;
        this._maoDeOnzePendingTeams.clear();
        this._maoDeOnzeDecisions.clear();
        this._dealerSeat = (this._dealerSeat + 1) % this.players.length;
        this._leaderSeat = (this._dealerSeat + 1) % this.players.length;
        for (const p of this.players) {
            p.holeCards = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
            p.status = 'active';
        }
        const pending = new Set();
        if (this._scores[0] === 11)
            pending.add(0);
        if (this._scores[1] === 11)
            pending.add(1);
        if (pending.size > 0) {
            this._phase = 'mao_de_onze_decision';
            this._maoDeOnzePendingTeams = pending;
            for (const p of this.players)
                if (pending.has(p.teamIndex))
                    p.status = 'mao_de_onze_pending';
        }
        else {
            this._phase = 'playing';
            this._currentSeat = this._leaderSeat;
        }
    }
    /** Combined hand of the caller's team — self + partner (or just self in 1x1). */
    teamHand(playerId) {
        const team = this.teamOf(playerId);
        return this.players.filter((p) => p.teamIndex === team).flatMap((p) => p.holeCards);
    }
    isFerro() {
        return this._maoDeOnzePendingTeams.size === 2;
    }
    maoDeOnzeDecision(playerId, accept) {
        if (this._phase !== 'mao_de_onze_decision')
            return false;
        const team = this.teamOf(playerId);
        if (!this._maoDeOnzePendingTeams.has(team))
            return false;
        if (this._maoDeOnzeDecisions.has(team))
            return false;
        this._maoDeOnzeDecisions.set(team, accept);
        if (!accept) {
            const other = team === 0 ? 1 : 0;
            this.endHand(other, 1, 'mao_de_onze_run');
            return true;
        }
        const allAccepted = [...this._maoDeOnzePendingTeams].every((t) => this._maoDeOnzeDecisions.get(t) === true);
        if (allAccepted) {
            this._phase = 'playing';
            this._currentSeat = this._leaderSeat;
            for (const p of this.players)
                if (p.status === 'mao_de_onze_pending')
                    p.status = 'active';
        }
        return true;
    }
    // ── Play ─────────────────────────────────────────────────────────────────
    playCard(playerId, card) {
        if (this._phase !== 'playing' || this._awaitingResponseFromTeam !== null)
            return false;
        const player = this.players.find((p) => p.id === playerId);
        if (!player || player.seatIndex !== this._currentSeat)
            return false;
        const cardIdx = player.holeCards.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
        if (cardIdx === -1)
            return false;
        player.holeCards.splice(cardIdx, 1);
        this._vazaCardsPlayed.push({ playerId, card });
        if (this._vazaCardsPlayed.length === this.players.length) {
            this.resolveVaza();
        }
        else {
            this._currentSeat = (this._currentSeat + 1) % this.players.length;
        }
        return true;
    }
    resolveVaza() {
        const strengths = this._vazaCardsPlayed.map((vc) => ({
            ...vc, strength: cardStrength(vc.card, this.manilhaCtx),
        }));
        const maxStrength = Math.max(...strengths.map((s) => s.strength));
        const maxPlayers = strengths.filter((s) => s.strength === maxStrength);
        const teams = new Set(maxPlayers.map((mp) => this.teamOf(mp.playerId)));
        let winnerTeam = null;
        if (teams.size === 1) {
            winnerTeam = [...teams][0];
            this._leaderSeat = this.players.find((p) => p.id === maxPlayers[0].playerId).seatIndex;
        }
        this._vazaWinners.push(winnerTeam);
        const over = this.checkHandOver();
        if (over.over) {
            this.endHand(over.winnerTeam, this._stake, 'vazas');
            return;
        }
        this._vaza = (this._vaza + 1);
        this._vazaCardsPlayed = [];
        this._currentSeat = this._leaderSeat;
    }
    /** Tie-break table — see .claude/Truco.md → "Empate de vaza". */
    checkHandOver() {
        const w = this._vazaWinners;
        if (w.length < 2)
            return { over: false, winnerTeam: null };
        const [w1, w2] = w;
        if (w1 !== null && w2 !== null && w1 === w2)
            return { over: true, winnerTeam: w1 };
        if (w1 === null && w2 !== null)
            return { over: true, winnerTeam: w2 };
        if (w1 !== null && w2 === null)
            return { over: true, winnerTeam: w1 };
        if (w.length < 3)
            return { over: false, winnerTeam: null };
        return { over: true, winnerTeam: w[2] }; // may be null → "ninguém pontua"
    }
    endHand(winnerTeam, points, reason) {
        if (winnerTeam !== null)
            this._scores[winnerTeam] += points;
        this._phase = 'hand_end';
        this._lastHandResult = { winnerTeam, points, reason };
    }
    // ── Truco escalation ─────────────────────────────────────────────────────
    callTruco(playerId) {
        if (this._phase !== 'playing' || this._awaitingResponseFromTeam !== null)
            return false;
        const player = this.players.find((p) => p.id === playerId);
        if (!player || player.seatIndex !== this._currentSeat)
            return false;
        if (player.teamIndex === this._stakeCalledByTeam)
            return false; // must wait for the other team to act
        const next = LEVELS[LEVELS.indexOf(this._stake) + 1];
        if (!next)
            return false; // already at 12 (teto)
        this._pendingStake = next;
        this._stakeCalledByTeam = player.teamIndex;
        this._awaitingResponseFromTeam = player.teamIndex === 0 ? 1 : 0;
        return true;
    }
    respond(playerId, accept) {
        if (this._awaitingResponseFromTeam === null)
            return false;
        const player = this.players.find((p) => p.id === playerId);
        if (!player || player.teamIndex !== this._awaitingResponseFromTeam)
            return false;
        if (accept) {
            this._stake = this._pendingStake;
            this._pendingStake = null;
            this._awaitingResponseFromTeam = null;
            return true;
        }
        const winner = this._stakeCalledByTeam;
        const points = this._stake;
        this._pendingStake = null;
        this._awaitingResponseFromTeam = null;
        this.endHand(winner, points, 'corri');
        return true;
    }
    // ── Queries ──────────────────────────────────────────────────────────────
    currentPlayerId() {
        return this.playerAtSeat(this._currentSeat)?.id;
    }
    turnInfo(playerId) {
        const player = this.players.find((p) => p.id === playerId);
        if (!player || this._phase !== 'playing')
            return { canPlay: false, canCallTruco: false, canRespond: false };
        if (this._awaitingResponseFromTeam !== null) {
            return { canPlay: false, canCallTruco: false, canRespond: player.teamIndex === this._awaitingResponseFromTeam };
        }
        const isTurn = player.seatIndex === this._currentSeat;
        const canCallTruco = isTurn && player.teamIndex !== this._stakeCalledByTeam && this._stake < 12;
        return { canPlay: isTurn, canCallTruco, canRespond: false };
    }
    isMatchOver() {
        return this._scores[0] >= 12 || this._scores[1] >= 12;
    }
    matchResult() {
        if (this._scores[0] >= 12)
            return { winnerTeam: 0, scores: [...this._scores] };
        if (this._scores[1] >= 12)
            return { winnerTeam: 1, scores: [...this._scores] };
        return null;
    }
    publicPlayers() {
        return this.players.map(({ holeCards: _h, ...p }) => p);
    }
    /** Weakest card in a player's hand under the current manilha context — used for turn-timeout auto-play. */
    weakestCard(playerId) {
        const player = this.players.find((p) => p.id === playerId);
        if (!player || player.holeCards.length === 0)
            return undefined;
        return [...player.holeCards].sort((a, b) => cardStrength(a, this.manilhaCtx) - cardStrength(b, this.manilhaCtx))[0];
    }
}
