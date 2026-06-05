/**
 * OpenTelemetry instrumentation for New Relic.
 *
 * This file MUST be imported first — before any other application code —
 * so that auto-instrumentation hooks activate when modules load.
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
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

const LICENSE_KEY = process.env.NEW_RELIC_LICENSE_KEY
const ENDPOINT    = process.env.NEW_RELIC_OTLP_ENDPOINT ?? 'https://otlp.nr-data.net'
const APP_NAME    = process.env.NEW_RELIC_APP_NAME ?? 'poker-server'
const ENVIRONMENT = process.env.NODE_ENV ?? 'development'

let sdk: NodeSDK | null = null

export function startTelemetry(): void {
  if (!LICENSE_KEY) {
    console.log('[telemetry] NEW_RELIC_LICENSE_KEY not set — skipping OpenTelemetry init')
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
    instrumentations: [
      getNodeAutoInstrumentations({
        // WebSocket doesn't have an auto-instrumentation; disable noisy ones
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  })

  sdk.start()
  console.log(`[telemetry] OpenTelemetry → New Relic (${ENDPOINT}) service="${APP_NAME}" env="${ENVIRONMENT}"`)
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown()
    console.log('[telemetry] OpenTelemetry SDK shut down')
  }
}
