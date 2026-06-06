import type { RoomConfig } from '../../shared/types'
import { usernameFilter } from './bloomFilter'

const ADMIN_USER = process.env.ADMIN_USER ?? 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'changeme'

const sessions = new Set<string>()

function generateToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
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
  return sessions.has(token)
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
      const body = await req.json() as { user?: string; pass?: string }
      if (body.user === ADMIN_USER && body.pass === ADMIN_PASS) {
        const token = generateToken()
        sessions.add(token)
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
