/**
 * Structured application logger — adherent to the OpenTelemetry Logs Data Model
 * (https://opentelemetry.io/docs/specs/otel/logs/data-model/).
 *
 * Every call emits an OTel LogRecord (severityNumber + severityText, a string
 * `body`, and structured `attributes`) through the global LoggerProvider that
 * `telemetry.ts` registers. When NEW_RELIC_LICENSE_KEY is set, records are
 * batched and shipped via OTLP/HTTP to New Relic (`/v1/logs`), correlated with
 * traces/metrics via the same Resource (service.name, deployment.environment…).
 * If telemetry isn't configured, OTel emission is a harmless no-op (NoopLogger).
 *
 * Each call also mirrors a one-line JSON record to the console, so logs stay
 * visible in `bun dev` and in Render's log viewer regardless of OTel export.
 *
 * Usage:
 *   logger.info('room_created', { 'poker.room_id': room.id, 'poker.player_count': 2 })
 *   logger.warn('player_secret_not_set', { hint: 'sessions will not survive restart' })
 *   logger.error('tournament_start_failed', { 'error.message': String(err) })
 *
 * Custom attributes use the `poker.*` namespace to avoid colliding with
 * OTel/New Relic reserved attribute names.
 */

import { context, trace } from '@opentelemetry/api'
import { logs, SeverityNumber, type LogAttributes } from '@opentelemetry/api-logs'

const otelLogger = logs.getLogger('poker-server')

type Level = 'debug' | 'info' | 'warn' | 'error'

const SEVERITY: Record<Level, { number: SeverityNumber; text: string }> = {
  debug: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  info:  { number: SeverityNumber.INFO,  text: 'INFO'  },
  warn:  { number: SeverityNumber.WARN,  text: 'WARN'  },
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
}

const CONSOLE: Record<Level, (line: string) => void> = {
  debug: (l) => console.debug(l),
  info:  (l) => console.log(l),
  warn:  (l) => console.warn(l),
  error: (l) => console.error(l),
}

function emit(level: Level, body: string, attributes?: LogAttributes): void {
  const { number, text } = SEVERITY[level]
  const ctx = context.active()

  // OTel LogRecord — exported via OTLP when telemetry is configured.
  otelLogger.emit({
    severityNumber: number,
    severityText: text,
    body,
    attributes,
    context: ctx,
  })

  // Console mirror — always on, for local dev and Render's log viewer.
  const line: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: text,
    body,
  }
  if (attributes && Object.keys(attributes).length) line.attributes = attributes

  const span = trace.getSpanContext(ctx)
  if (span) { line.trace_id = span.traceId; line.span_id = span.spanId }

  CONSOLE[level](JSON.stringify(line))
}

export const logger = {
  debug: (body: string, attributes?: LogAttributes) => emit('debug', body, attributes),
  info:  (body: string, attributes?: LogAttributes) => emit('info',  body, attributes),
  warn:  (body: string, attributes?: LogAttributes) => emit('warn',  body, attributes),
  error: (body: string, attributes?: LogAttributes) => emit('error', body, attributes),
}
