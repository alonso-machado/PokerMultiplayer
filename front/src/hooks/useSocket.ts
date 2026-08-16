import { useEffect, useRef, useCallback, useState } from 'react'
import type { ClientMessage, ServerMessage } from '../../../shared/types'
import type { PlayerIdentity } from './usePlayerToken'

const WS_URL = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? 'ws://localhost:3001/ws'

// Reconnect backoff — starts fast (a deploy-triggered drop usually recovers
// in seconds) but caps well below "hammer the server" territory for a longer
// outage. Resets to BASE the moment a connection actually opens.
const RECONNECT_BASE_MS = 1500
const RECONNECT_MAX_MS  = 15_000

type Handler = (msg: ServerMessage) => void

export function useSocket(identity: PlayerIdentity, onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let stopped = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = RECONNECT_BASE_MS

    function connect() {
      if (stopped) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        backoff = RECONNECT_BASE_MS
        setConnected(true)
        // Announce ourselves immediately with our persistent identity
        ws.send(JSON.stringify({
          type: 'hello',
          playerId: identity.playerId,
          name: identity.name,
          tournamentToken: identity.tournamentToken ?? undefined,
        }))
      }
      ws.onclose = () => {
        setConnected(false)
        if (stopped) return
        // A fresh identity/room reconnect happens naturally once the new
        // socket's `hello` lands — the server's PersistentSession already
        // handles resuming wherever this player was (see server/src/index.ts).
        reconnectTimer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS)
      }
      ws.onerror = () => console.error('[WS] error')
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as ServerMessage
          onMsgRef.current(msg)
        } catch { /* ignore */ }
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  return { send, connected }
}
