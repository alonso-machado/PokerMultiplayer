/**
 * OpenAPI 3.0 spec for the PokerMultiplayer HTTP API.
 * Only served in development (NODE_ENV !== 'production').
 *
 * WebSocket game protocol is NOT part of this spec — it lives in .claude/Server.md.
 */

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PokerMultiplayer — Server API',
    version: '1.0.0',
    description: [
      'HTTP API for the PokerMultiplayer server.',
      '',
      '**WebSocket** (`/ws`) is the primary game channel — not documented here.',
      'See `.claude/Server.md` for the full WS message protocol.',
    ].join('\n'),
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Local dev' },
  ],
  components: {
    securitySchemes: {
      bearerToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Token obtained from POST /api/admin/login',
      },
    },
    schemas: {
      RoomConfig: {
        type: 'object',
        required: ['smallBlind', 'bigBlind', 'ante', 'maxPlayers'],
        properties: {
          smallBlind: { type: 'integer', minimum: 1, example: 5 },
          bigBlind:   { type: 'integer', minimum: 2, example: 10 },
          ante:       { type: 'integer', minimum: 0, example: 0 },
          maxPlayers: { type: 'integer', minimum: 2, maximum: 6, example: 6 },
        },
      },
      BlindLevel: {
        type: 'object',
        properties: {
          level:           { type: 'integer', example: 1 },
          smallBlind:      { type: 'integer', example: 5 },
          bigBlind:        { type: 'integer', example: 10 },
          ante:            { type: 'integer', example: 0 },
          durationMinutes: { type: 'integer', example: 10 },
        },
      },
      TournamentInfo: {
        type: 'object',
        properties: {
          id:                 { type: 'string', example: 'abc12345' },
          name:               { type: 'string', example: 'Friday Night Poker' },
          status:             { type: 'string', enum: ['registering', 'running', 'final_table', 'finished'] },
          scheduledStart:     { type: 'string', format: 'date-time' },
          registeredCount:    { type: 'integer' },
          activeCount:        { type: 'integer' },
          config:             { $ref: '#/components/schemas/RoomConfig' },
          startingChips:      { type: 'integer' },
          currentBlindLevel:  { $ref: '#/components/schemas/BlindLevel', nullable: true },
          nextBlindLevel:     { $ref: '#/components/schemas/BlindLevel', nullable: true },
          nextBlindInSeconds: { type: 'integer', nullable: true },
        },
      },
      BloomFilterStats: {
        type: 'object',
        properties: {
          epoch:             { type: 'string',  description: 'Deploy epoch — changes on every deploy to reset the namespace', example: 'abc123def' },
          m:                 { type: 'integer', description: 'Total number of bits in the filter', example: 1440000 },
          k:                 { type: 'integer', description: 'Number of hash functions', example: 10 },
          bitsSet:           { type: 'integer', description: 'Number of bits currently set to 1', example: 4200 },
          estimatedItems:    { type: 'integer', description: 'Estimated number of usernames registered this epoch', example: 420 },
          falsePositiveRate: { type: 'number',  description: 'Current false-positive probability (0–1)', example: 0.000001 },
          fillRatio:         { type: 'number',  description: 'Fraction of bits set (bitsSet / m)', example: 0.0029 },
          bits:              { type: 'string',  description: 'Full 180 KB bit array encoded as base64 (1 bit per username slot)', example: 'AAAA...' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Não autorizado.' },
        },
      },
      OkResponse: {
        type: 'object',
        properties: {
          ok:    { type: 'boolean' },
          error: { type: 'string', nullable: true },
        },
      },
    },
  },
  paths: {
    '/': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
              },
            },
          },
        },
      },
    },

    '/api/tournament': {
      get: {
        summary: 'Get public tournament info',
        tags: ['Tournament (public)'],
        responses: {
          '200': {
            description: 'Current tournament, or null if none exists',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { tournament: { $ref: '#/components/schemas/TournamentInfo', nullable: true } },
                },
              },
            },
          },
        },
      },
    },

    '/api/admin/login': {
      post: {
        summary: 'Admin login — returns a bearer token',
        tags: ['Admin'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user', 'pass'],
                properties: {
                  user: { type: 'string', example: 'admin' },
                  pass: { type: 'string', example: 'changeme' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { token: { type: 'string' } } },
              },
            },
          },
          '401': {
            description: 'Wrong credentials',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },

    '/api/admin/check': {
      get: {
        summary: 'Check whether the bearer token is still valid',
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        responses: {
          '200': {
            description: 'Auth status',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },

    '/api/admin/tournament': {
      get: {
        summary: 'Get current tournament (admin)',
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        responses: {
          '200': {
            description: 'Tournament info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { tournament: { $ref: '#/components/schemas/TournamentInfo', nullable: true } },
                },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      post: {
        summary: 'Create a new tournament',
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'scheduledStart', 'config'],
                properties: {
                  name:           { type: 'string', maxLength: 40, example: 'Friday Night Poker' },
                  scheduledStart: { type: 'string', format: 'date-time', example: '2026-06-10T20:00:00Z' },
                  config:         { $ref: '#/components/schemas/RoomConfig' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      delete: {
        summary: 'Cancel / delete the current tournament',
        description: 'Only allowed when status is `registering`. Cannot cancel a running tournament.',
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '400': { description: 'Tournament is already running', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },

    '/api/admin/bloomfilter': {
      get: {
        summary: 'Bloom filter diagnostics',
        description: [
          'Returns the full state of the username uniqueness bloom filter for the current deploy epoch.',
          '',
          '**bits** is a base64-encoded 180 KB `Uint8Array` (1,440,000 bits).',
          'Decode it to inspect individual bit positions.',
          '',
          '`estimatedItems` uses the standard formula: `-(m/k) × ln(1 − fill)`.',
          '`falsePositiveRate` ≈ `fill^k` — approaches 0.1% at capacity (100 k users).',
        ].join('\n'),
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        responses: {
          '200': {
            description: 'Bloom filter stats + raw bits',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BloomFilterStats' },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },

    '/api/admin/tournament/start': {
      post: {
        summary: 'Start the tournament immediately (before scheduledStart)',
        description: 'Requires at least 2 registered players.',
        tags: ['Admin'],
        security: [{ bearerToken: [] }],
        responses: {
          '200': { description: 'Started', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '400': { description: 'Cannot start — no tournament or already running', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
  },
}

export function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PokerMultiplayer API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    })
  </script>
</body>
</html>`
}
