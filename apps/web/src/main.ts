import { mount } from 'svelte'
import App from './App.svelte'
import './style.css'

const target = document.getElementById('app')!
if (window.location.pathname === '/mesh-debug') {
  import('./debug/MeshDebug.svelte').then(({ default: MeshDebug }) => mount(MeshDebug, { target }))
}
else {
  mount(App, { target })
}
