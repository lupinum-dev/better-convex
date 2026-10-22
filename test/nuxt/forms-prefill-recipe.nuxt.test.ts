import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { setupBetterConvexTest } from '../../src/runtime/test'
import { getProjectSettings } from './fixtures/project-settings-api'
import ProjectSettingsForm from './fixtures/ProjectSettingsForm.vue'

// One copy of the Vue package for the Nuxt composables and the test kit.
vi.mock('@lupinum/better-convex-vue', () => import('../../packages/vue/src/index'))
vi.mock('@lupinum/better-convex-vue/internal', () => import('../../packages/vue/src/internal'))
vi.mock('@lupinum/better-convex-vue/embedded', () => import('../../packages/vue/src/embedded'))
vi.mock('@lupinum/better-convex-vue/errors', () => import('../../packages/vue/src/errors'))
vi.mock('@lupinum/better-convex-vue/test', () => import('../../packages/vue/src/test'))

afterEach(() => {
  vi.useRealTimers()
})

describe('forms recipe: prefill a form from a query', () => {
  it('seeds the defaults from a null result once and keeps the edits when a live value arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const convex = setupBetterConvexTest()
    const settings = convex.query(getProjectSettings, { projectId: 'p1' })
    settings.resolve(null)

    const wrapper = await mountSuspended(ProjectSettingsForm, {
      props: { projectId: 'p1' },
      global: { plugins: [convex.plugin] },
    })
    await vi.runAllTimersAsync()
    await nextTick()

    const name = wrapper.find<HTMLInputElement>('input[name="name"]')
    const notify = wrapper.find<HTMLInputElement>('input[name="notifyByEmail"]')
    // `null` means "no settings yet", not "not loaded": the defaults appear.
    expect(name.exists()).toBe(true)
    expect(name.element.value).toBe('')
    expect(notify.element.checked).toBe(true)

    await name.setValue('Typed by the user')
    await notify.setValue(false)

    settings.push({
      _id: 's1',
      projectId: 'p1',
      name: 'Saved elsewhere',
      notifyByEmail: true,
    })
    await vi.runAllTimersAsync()
    await nextTick()

    expect(settings.activeSubscriptions()).toBe(1)
    expect(name.element.value).toBe('Typed by the user')
    expect(notify.element.checked).toBe(false)
    wrapper.unmount()
  })
})
