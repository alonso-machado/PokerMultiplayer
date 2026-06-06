/**
 * Guest identity tokens.
 *
 * Format: `{playerId}.{hmac_base64url}`
 *   - playerId = two crypto UUIDs concatenated (no dashes) — 64 hex chars, ~244 bits
 *   - hmac     = HMAC-SHA256(playerId, PLAYER_SECRET) encoded as base64url
 *
 * If PLAYER_SECRET is not set the server generates an ephemeral key on startup.
 * Sessions will not survive a server restart — acceptable for dev, not for prod.
 *
 * Future: Google-authenticated users will go through a separate issue path that
 * signs their Google sub claim with the same key, keeping the token format identical.
 */

const SECRET = process.env.PLAYER_SECRET

let _key: CryptoKey | null = null

async function getKey(): Promise<CryptoKey> {
  if (_key) return _key
  let raw: Uint8Array
  if (SECRET) {
    if (SECRET.length !== 64) throw new Error('PLAYER_SECRET must be a 64-character hex string (32 bytes)')
    raw = hexToBytes(SECRET)
  } else {
    raw = crypto.getRandomValues(new Uint8Array(32))
    console.warn('[identity] PLAYER_SECRET not set — sessions will not survive server restart')
  }
  _key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  return _key
}

export function newPlayerId(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
}

export async function issueToken(playerId: string): Promise<string> {
  const key = await getKey()
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(playerId))
  return `${playerId}.${bytesToBase64url(new Uint8Array(sig))}`
}

/** Returns the verified playerId, or null if the token is missing, malformed, or tampered. */
export async function verifyToken(token: string): Promise<string | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const playerId = token.slice(0, dot)
  const sigB64   = token.slice(dot + 1)
  if (!playerId || !sigB64) return null
  try {
    const key = await getKey()
    const sig = base64urlToBytes(sigB64)
    const ok  = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(playerId))
    return ok ? playerId : null
  } catch {
    return null
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64.length % 4) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}
