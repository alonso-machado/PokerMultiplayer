import type { RoomConfig } from '../../shared/types'
import { usernameFilter } from './bloomFilter'
import { randomToken } from './random'

const ADMIN_USER = process.env.ADMIN_USER ?? 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'changeme'

// token -> expiry (ms epoch). Plain Set previously meant sessions never expired.
const sessions = new Map<string, number>()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24h

function generateToken(): string {
  return randomToken(32)
}

/** Constant-time-ish string compare via hashing — avoids both a length short-circuit
 *  and per-character early exit, so wrong-password requests all take the same shape. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const ba = new Uint8Array(da), bb = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!
  return diff === 0
}

// ── Login rate limiting ──────────────────────────────────────────────────────
// In-memory, per-client-key sliding window. Render sits behind a proxy, so we
// key on X-Forwarded-For (falls back to a shared bucket if absent — still
// caps the *global* login rate, better than nothing).
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW_MS    = 60_000
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_LOGIN_ATTEMPTS
}

function resetAttempts(key: string): void {
  loginAttempts.delete(key)
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

export function checkAdminAuth(req: Request): boolean {
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const expiry = sessions.get(token)
  if (expiry === undefined) return false
  if (Date.now() > expiry) { sessions.delete(token); return false }
  return true
}

export interface TournamentData {
  name: string
  scheduledStart: string
  config: RoomConfig
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>

export function adminRouter(
  getTournamentInfo: () => object | null,
  createTournament:  (data: TournamentData)  => { ok: boolean; error?: string },
  startTournament:   () => { ok: boolean; error?: string },
  deleteTournament:  () => { ok: boolean; error?: string },
): Handler {
  return async (req, url) => {
    const path   = url.pathname
    const method = req.method

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (path === '/api/admin/login' && method === 'POST') {
      const key = clientKey(req)
      if (rateLimited(key)) return json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, 429)

      const body = await req.json() as { user?: string; pass?: string }
      const userOk = await safeEqual(body.user ?? '', ADMIN_USER)
      const passOk = await safeEqual(body.pass ?? '', ADMIN_PASS)
      if (userOk && passOk) {
        resetAttempts(key)
        const token = generateToken()
        sessions.set(token, Date.now() + SESSION_TTL_MS)
        return json({ token })
      }
      return json({ error: 'Credenciais inválidas.' }, 401)
    }

    if (path === '/api/admin/check' && method === 'GET') {
      return json({ ok: checkAdminAuth(req) })
    }

    if (!checkAdminAuth(req)) return json({ error: 'Não autorizado.' }, 401)

    if (path === '/api/admin/tournament' && method === 'GET') {
      return json({ tournament: getTournamentInfo() })
    }

    if (path === '/api/admin/tournament' && method === 'POST') {
      const body = await req.json() as TournamentData
      if (!body.name?.trim())     return json({ error: 'Nome obrigatório.' }, 400)
      if (!body.scheduledStart)   return json({ error: 'Data obrigatória.' }, 400)
      const cfg = body.config
      if (!cfg || cfg.bigBlind < 2 || cfg.smallBlind < 1) return json({ error: 'Blinds inválidos.' }, 400)
      const result = createTournament(body)
      return json(result, result.ok ? 200 : 400)
    }

    if (path === '/api/admin/tournament/start' && method === 'POST') {
      return json(startTournament())
    }

    if (path === '/api/admin/tournament' && method === 'DELETE') {
      return json(deleteTournament())
    }

    if (path === '/api/admin/bloomfilter' && method === 'GET') {
      return json(usernameFilter.stats())
    }

    return json({ error: 'Not found.' }, 404)
  }
}

export function publicTournamentHandler(getTournamentInfo: () => object | null): Handler {
  return () => new Response(JSON.stringify({ tournament: getTournamentInfo() }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}
