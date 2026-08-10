/**
 * Cryptographically secure random id/token helpers.
 *
 * Never use Math.random() for anything that grants access or gets used as a
 * bearer credential (session tokens, tournament registration tokens) or that
 * gets handed back to an anonymous client (room ids) — Math.random()'s
 * internal generator state (V8/JSC xorshift128+) is not designed to resist
 * state-recovery from observed outputs, and it's a single stream shared by
 * the whole process, so predictable ids feed predictable tokens.
 */

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Short, URL-safe random id — for room/table ids (public, just needs to be unguessable enough to avoid enumeration). */
export function randomId(bytes = 9): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Long, high-entropy random token — for bearer-style credentials (admin session, tournament registration). */
export function randomToken(bytes = 32): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(bytes)))
}
