import { useState } from 'react'
import { z } from 'zod'
import type { TournamentInfo } from '../../../shared/types'

const SERVER = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL
  ?? 'http://localhost:3001'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  user: z.string().min(1, 'Usuário obrigatório'),
  pass: z.string().min(1, 'Senha obrigatória'),
})

const TournamentSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(40, 'Máximo 40 caracteres'),
  scheduledStart: z.string().refine(v => {
    const d = new Date(v)
    return !isNaN(d.getTime()) && d.getTime() > Date.now()
  }, 'Data deve ser no futuro'),
  smallBlind: z.coerce.number().int().min(1, 'Mínimo 1'),
  bigBlind: z.coerce.number().int().min(2, 'Mínimo 2'),
  ante: z.coerce.number().int().min(0, 'Mínimo 0'),
  maxPlayers: z.coerce.number().int().min(2, 'Mínimo 2').max(6, 'Máximo 6'),
}).refine(d => d.smallBlind < d.bigBlind, {
  message: 'Small blind deve ser menor que big blind',
  path: ['smallBlind'],
})

type LoginForm      = z.infer<typeof LoginSchema>
type TournamentForm = z.infer<typeof TournamentSchema>
type FieldErrors<T> = Partial<Record<keyof T, string>>

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown, token?: string) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<Record<string, unknown>>
}

async function apiGet(path: string, token: string) {
  const res = await fetch(`${SERVER}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json() as Promise<Record<string, unknown>>
}

async function apiDelete(path: string, token: string) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json() as Promise<Record<string, unknown>>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [adminToken, setAdminToken] = useState<string | null>(
    () => sessionStorage.getItem('admin_token')
  )
  const [tournament, setTournament] = useState<TournamentInfo | null>(null)
  const [loading, setLoading]       = useState(false)

  // ── Login ──────────────────────────────────────────────────────────────────

  const [loginForm, setLoginForm]     = useState<LoginForm>({ user: '', pass: '' })
  const [loginErrors, setLoginErrors] = useState<FieldErrors<LoginForm>>({})
  const [loginMsg, setLoginMsg]       = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginMsg('')
    const result = LoginSchema.safeParse(loginForm)
    if (!result.success) {
      const errs: FieldErrors<LoginForm> = {}
      for (const issue of result.error.issues) errs[issue.path[0] as keyof LoginForm] = issue.message
      setLoginErrors(errs); return
    }
    setLoginErrors({}); setLoading(true)
    try {
      const data = await apiPost('/api/admin/login', { user: loginForm.user, pass: loginForm.pass })
      if (typeof data.token === 'string') {
        sessionStorage.setItem('admin_token', data.token)
        setAdminToken(data.token)
        loadTournament(data.token)
      } else {
        setLoginMsg((data.error as string) || 'Credenciais inválidas.')
      }
    } catch { setLoginMsg('Erro de conexão.') }
    finally { setLoading(false) }
  }

  // ── Load tournament ────────────────────────────────────────────────────────

  async function loadTournament(token: string) {
    try {
      const data = await apiGet('/api/admin/tournament', token)
      setTournament((data.tournament as TournamentInfo) ?? null)
    } catch { /* ignore */ }
  }

  // ── Create tournament ──────────────────────────────────────────────────────

  const now1h = () => {
    const d = new Date(Date.now() + 3600_000); d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
  }

  const [tForm, setTForm]       = useState<TournamentForm>({
    name: '', scheduledStart: now1h(),
    smallBlind: 25, bigBlind: 50, ante: 0, maxPlayers: 6,
  })
  const [tErrors, setTErrors]   = useState<FieldErrors<TournamentForm>>({})
  const [tMsg, setTMsg]         = useState('')

  function setT<K extends keyof TournamentForm>(k: K, v: TournamentForm[K]) {
    setTForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setTMsg('')
    const result = TournamentSchema.safeParse(tForm)
    if (!result.success) {
      const errs: FieldErrors<TournamentForm> = {}
      for (const issue of result.error.issues) errs[issue.path[0] as keyof TournamentForm] = issue.message
      setTErrors(errs); return
    }
    setTErrors({}); setLoading(true)
    try {
      const d = result.data
      const data = await apiPost('/api/admin/tournament', {
        name: d.name,
        scheduledStart: new Date(d.scheduledStart).toISOString(),
        config: { smallBlind: d.smallBlind, bigBlind: d.bigBlind, ante: d.ante, maxPlayers: d.maxPlayers },
      }, adminToken!)
      if (data.ok) {
        setTMsg('Torneio criado!')
        loadTournament(adminToken!)
      } else {
        setTMsg((data.error as string) || 'Erro ao criar.')
      }
    } catch { setTMsg('Erro de conexão.') }
    finally { setLoading(false) }
  }

  async function handleStart() {
    if (!adminToken) return
    setLoading(true)
    try {
      await apiPost('/api/admin/tournament/start', {}, adminToken)
      loadTournament(adminToken)
    } finally { setLoading(false) }
  }

  async function handleDelete() {
    if (!adminToken || !confirm('Cancelar o torneio?')) return
    setLoading(true)
    try {
      await apiDelete('/api/admin/tournament', adminToken)
      setTournament(null)
    } finally { setLoading(false) }
  }

  function handleLogout() {
    sessionStorage.removeItem('admin_token')
    setAdminToken(null); setTournament(null)
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const chips = tForm.bigBlind * 20

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!adminToken) {
    return (
      <div className="admin-wrap">
        <div className="admin-card">
          <h1 className="admin-title">♠ Admin — Poker</h1>
          <form onSubmit={handleLogin} noValidate>
            <Field label="Usuário" error={loginErrors.user}>
              <input type="text" value={loginForm.user} autoComplete="username"
                onChange={e => setLoginForm(p => ({ ...p, user: e.target.value }))} />
            </Field>
            <Field label="Senha" error={loginErrors.pass}>
              <input type="password" value={loginForm.pass} autoComplete="current-password"
                onChange={e => setLoginForm(p => ({ ...p, pass: e.target.value }))} />
            </Field>
            {loginMsg && <p className="admin-msg err">{loginMsg}</p>}
            <button className="admin-btn primary" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-wrap">
      <div className="admin-card">
        <div className="admin-header">
          <h1 className="admin-title">♠ Admin — Poker</h1>
          <button className="admin-btn ghost" onClick={handleLogout}>Sair</button>
        </div>

        {/* Current tournament status */}
        {tournament && (
          <div className="admin-section">
            <h2>Torneio atual</h2>
            <TournamentStatus t={tournament} />
            {tournament.status === 'registering' && (
              <div className="admin-actions">
                <button className="admin-btn success" onClick={handleStart} disabled={loading}>
                  ▶ Iniciar agora
                </button>
                <button className="admin-btn danger" onClick={handleDelete} disabled={loading}>
                  🗑 Cancelar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Create form — only if no active tournament */}
        {(!tournament || tournament.status === 'finished') && (
          <div className="admin-section">
            <h2>{tournament?.status === 'finished' ? 'Criar próximo torneio' : 'Criar torneio'}</h2>
            <form onSubmit={handleCreate} noValidate>
              <Field label="Nome do torneio" error={tErrors.name}>
                <input type="text" maxLength={40} value={tForm.name}
                  onChange={e => setT('name', e.target.value)} placeholder="Ex: Torneio da Sexta" />
              </Field>

              <Field label="Data e hora de início (horário local)" error={tErrors.scheduledStart}>
                <input type="datetime-local" value={tForm.scheduledStart}
                  onChange={e => setT('scheduledStart', e.target.value)} />
              </Field>

              <div className="admin-row">
                <Field label="Small Blind" error={tErrors.smallBlind}>
                  <input type="number" min={1} value={tForm.smallBlind}
                    onChange={e => setT('smallBlind', Number(e.target.value))} />
                </Field>
                <Field label="Big Blind" error={tErrors.bigBlind}>
                  <input type="number" min={2} value={tForm.bigBlind}
                    onChange={e => setT('bigBlind', Number(e.target.value))} />
                </Field>
              </div>

              <div className="admin-row">
                <Field label="Ante (0 = sem ante)" error={tErrors.ante}>
                  <input type="number" min={0} value={tForm.ante}
                    onChange={e => setT('ante', Number(e.target.value))} />
                </Field>
                <Field label="Máx. por mesa (2–6)" error={tErrors.maxPlayers}>
                  <input type="number" min={2} max={6} value={tForm.maxPlayers}
                    onChange={e => setT('maxPlayers', Number(e.target.value))} />
                </Field>
              </div>

              <div className="admin-chips-preview">
                Fichas iniciais: <strong>{chips.toLocaleString()}</strong>
                <span> (20× big blind) · Sem rebuy</span>
              </div>

              {tMsg && <p className={`admin-msg ${tMsg.includes('criado') ? 'ok' : 'err'}`}>{tMsg}</p>}

              <button className="admin-btn primary" disabled={loading}>
                {loading ? 'Criando…' : 'Criar torneio'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="admin-field">
      <label>{label}</label>
      {children}
      {error && <span className="admin-field-error">{error}</span>}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  registering: '📋 Inscrições abertas',
  running:     '🟡 Em andamento',
  final_table: '🔥 Mesa Final',
  finished:    '✅ Encerrado',
}

function TournamentStatus({ t }: { t: TournamentInfo }) {
  const start = new Date(t.scheduledStart).toLocaleString()
  return (
    <div className="admin-tournament-info">
      <div className="ati-row"><span>Nome</span><strong>{t.name}</strong></div>
      <div className="ati-row"><span>Status</span><strong>{STATUS_LABEL[t.status] ?? t.status}</strong></div>
      <div className="ati-row"><span>Início</span><strong>{start}</strong></div>
      <div className="ati-row"><span>Fichas</span><strong>{t.startingChips.toLocaleString()}</strong></div>
      <div className="ati-row"><span>Blinds</span><strong>{t.config.smallBlind}/{t.config.bigBlind}{t.config.ante ? ` · Ante ${t.config.ante}` : ''}</strong></div>
      <div className="ati-row"><span>Inscritos</span><strong>{t.registeredCount}</strong></div>
      {t.status !== 'registering' && (
        <div className="ati-row"><span>Ativos</span><strong>{t.activeCount}</strong></div>
      )}
    </div>
  )
}
