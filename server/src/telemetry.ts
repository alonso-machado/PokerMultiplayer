/**
 * OpenTelemetry instrumentation for New Relic.
 *
 * This file MUST be imported first — before any other application code —
 * so that auto-instrumentation hooks activate when modules load.
 *
 * Sets up all three OTel signals over OTLP/HTTP:
 *   - traces  → /v1/traces
 *   - metrics → /v1/metrics
 *   - logs    → /v1/logs   (see ./logger.ts for the application-facing API)
 *
 * New Relic OTLP endpoints:
 *   US: https://otlp.nr-data.net
 *   EU: https://otlp.eu01.nr-data.net
 *
 * Required env vars:
 *   NEW_RELIC_LICENSE_KEY   — your New Relic ingest license key
 *   NEW_RELIC_OTLP_ENDPOINT — (optional) defaults to US endpoint
 *   NEW_RELIC_APP_NAME      — (optional) defaults to "poker-server"
 *   NODE_ENV                — used as deployment.environment attribute
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { logger } from './logger'

const LICENSE_KEY = process.env.NEW_RELIC_LICENSE_KEY
const ENDPOINT    = process.env.NEW_RELIC_OTLP_ENDPOINT ?? 'https://otlp.nr-data.net'
const APP_NAME    = process.env.NEW_RELIC_APP_NAME ?? 'poker-server'
const ENVIRONMENT = process.env.NODE_ENV ?? 'development'

let sdk: NodeSDK | null = null

export function startTelemetry(): void {
  if (!LICENSE_KEY) {
    logger.info('telemetry_disabled', { 'poker.reason': 'NEW_RELIC_LICENSE_KEY not set' })
    return
  }

  const headers = { 'api-key': LICENSE_KEY }

  const traceExporter = new OTLPTraceExporter({
    url: `${ENDPOINT}/v1/traces`,
    headers,
  })

  const metricExporter = new OTLPMetricExporter({
    url: `${ENDPOINT}/v1/metrics`,
    headers,
  })

  const logExporter = new OTLPLogExporter({
    url: `${ENDPOINT}/v1/logs`,
    headers,
  })

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:    APP_NAME,
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment': ENVIRONMENT,
    'telemetry.sdk.runtime': 'bun',
  })

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,   // ship metrics every 60 s
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(logExporter),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // WebSocket doesn't have an auto-instrumentation; disable noisy ones
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  })

  sdk.start()
  // From this point on, the global LoggerProvider is registered, so this
  // record is itself shipped to New Relic via OTLP — confirms the pipeline.
  logger.info('telemetry_started', {
    'poker.otlp_endpoint': ENDPOINT,
    'service.name': APP_NAME,
    'deployment.environment': ENVIRONMENT,
  })
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown()
    // The LoggerProvider is already shut down by the line above, so this
    // final message is console-only (not shipped via OTLP).
    console.log('[telemetry] OpenTelemetry SDK shut down')
  }
}
