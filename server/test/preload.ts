// Speed up showdown→next-hand transitions in Room so tournament tests
// (which simulate many hands of all-in play) don't wait on the production
// 4s delay. Must run before `room.ts` is first imported.
process.env.SHOWDOWN_DURATION_MS ??= '20'
