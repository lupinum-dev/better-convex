import { createApp } from 'vue'

import NotesDashboard from './NotesDashboard.vue'

const vueApp = createApp(NotesDashboard)
const teardown = () => {
  vueApp.unmount()
  window.removeEventListener('better-convex:notes-dashboard-teardown', teardown)
}

window.addEventListener('better-convex:notes-dashboard-teardown', teardown, { once: true })
vueApp.mount('#app')
