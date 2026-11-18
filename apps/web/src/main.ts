import posthog from 'posthog-js'
import { mount } from 'svelte'

import App from './App.svelte'
import './style.css'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
if (typeof posthogKey === 'string' && posthogKey.length > 0) {
  posthog.init(posthogKey, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    defaults: '2026-08-30',
  })
}

const target = document.getElementById('app')!
mount(App, { target })
