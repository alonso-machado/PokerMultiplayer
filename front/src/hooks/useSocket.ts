import { useEffect, useRef, useCallback, useState } from 'react'
import type { ClientMessage, ServerMessage } from '../../../shared/types'
import type { PlayerIdentity } from './usePlayerToken'

const WS_URL = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? 'ws://localhost:3001/ws'

type Handler = (msg: ServerMessage) => void

export function useSocket(identity: PlayerIdentity, onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Announce ourselves immediately with our persistent identity
      ws.send(JSON.stringify({
        type: 'hello',
        playerId: identity.playerId,
        name: identity.name,
        tournamentToken: identity.tournamentToken ?? undefined,
      }))
    }
    ws.onclose = () => setConnected(false)
    ws.onerror = () => console.error('[WS] error')
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage
        onMsgRef.current(msg)
      } catch { /* ignore */ }
    }

    return () => { ws.close(); wsRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  return { send, connected }
}
