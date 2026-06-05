import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'
import './index.css'
import App from './App'

const env = (import.meta as { env?: Record<string, string> }).env ?? {}

// Only init PostHog when a project token is configured.
// In local dev without the token, analytics are simply skipped.
if (env.VITE_POSTHOG_KEY) {
  posthog.init(env.VITE_POSTHOG_KEY, {
    api_host:       env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    defaults:       '2026-01-30',
    person_profiles: 'identified_only',   // no anonymous profiles (GDPR-friendly)
    capture_pageview: true,
    capture_pageleave: true,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <App />
    </PostHogProvider>
  </StrictMode>,
)
