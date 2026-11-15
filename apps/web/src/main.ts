import { mount } from 'svelte'
import App from './App.svelte'
import './style.css'

const target = document.getElementById('app')!
mount(App, { target })
