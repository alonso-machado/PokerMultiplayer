const PID_KEY  = 'pk_pid'
const NAME_KEY = 'pk_name'
const TOUR_KEY = 'pk_tid'   // tournament registration token
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

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export interface PlayerIdentity {
  playerId: string
  name: string
  tournamentToken: string | null
}

/** Returns existing identity or creates a new persistent one */
export function getOrCreateIdentity(fallbackName = 'Jogador'): PlayerIdentity {
  let playerId = getCookie(PID_KEY)
  if (!playerId) {
    playerId = uuidv4()
    setCookie(PID_KEY, playerId, DAYS)
  }
  const name = getCookie(NAME_KEY) ?? fallbackName
  const tournamentToken = getCookie(TOUR_KEY)
  return { playerId, name, tournamentToken }
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
