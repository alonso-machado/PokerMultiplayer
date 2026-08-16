/** Cumulative, in-memory, since-boot counters for the admin metrics tab.
 *  Deliberately not persisted — matches this project's zero-persistent-state
 *  constraint (see .claude/Server.md); a restart resets them along with
 *  every other piece of live game state. Each room class increments its own
 *  entry at the natural "a hand/round/match just resolved" point — see the
 *  call sites in room.ts / trucoRoom.ts / gauchoRoom.ts / canastraRoom.ts /
 *  blackjackRoom.ts / pushyourluckdrawRoom.ts. */
export const gameMetrics = {
  poker:            { handsCompleted: 0 },
  truco:            { handsCompleted: 0, matchesCompleted: 0 },
  gaucho:           { handsCompleted: 0, matchesCompleted: 0 },
  // A Canastra "round" already is the whole match (first team to the target
  // wins, then a rematch vote) — see canastraRoom.ts — so there's no
  // separate hands-vs-matches split to track here.
  canastra:         { matchesCompleted: 0 },
  blackjack:        { roundsCompleted: 0 },
  pushyourluckdraw: { roundsCompleted: 0, matchesCompleted: 0 },
}

export const serverStartedAt = Date.now()
