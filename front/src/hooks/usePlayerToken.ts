const PID_KEY  = 'pk_pid'
const NAME_KEY = 'pk_name'
const TOUR_KEY = 'pk_tid'
const DAYS = 365

function setCookie(name: string, value: string, days: number): void {
  const exp = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]!) : null
}

function delCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
}

export interface PlayerIdentity {
  playerId: string   // holds the full signed token issued by the server
  name: string
  tournamentToken: string | null
}

/**
 * Returns the stored identity.
 * If no token cookie exists yet, sends an empty playerId so the server issues a fresh signed token.
 * The server will respond with an `identity` message — call saveIdentityToken() to persist it.
 */
export function getOrCreateIdentity(fallbackName = 'Jogador'): PlayerIdentity {
  const playerId       = getCookie(PID_KEY) ?? ''
  const name           = getCookie(NAME_KEY) ?? fallbackName
  const tournamentToken = getCookie(TOUR_KEY)
  return { playerId, name, tournamentToken }
}

/** Called when the server sends an `identity` message with a fresh signed token. */
export function saveIdentityToken(token: string): void {
  setCookie(PID_KEY, token, DAYS)
}

export function saveName(name: string): void {
  setCookie(NAME_KEY, name, DAYS)
}

export function saveTournamentToken(token: string): void {
  setCookie(TOUR_KEY, token, DAYS)
}

export function clearTournamentToken(): void {
  delCookie(TOUR_KEY)
}
