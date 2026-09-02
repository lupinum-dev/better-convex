const siteUrl = 'https://better-convex.lupinum.com'

export default {
  ginkoDocs: {
    site: {
      url: siteUrl,
      name: { en: 'Better Convex' },
      description: {
        en: 'Convex integration for Nuxt, Vue, and MCP consumers.',
      },
      logo: { light: '/favicon.svg', dark: '/favicon.svg' },
      docsSidebarSwitcher: 'tabs',
      legalLinks: [
        { label: { en: 'Legal notice' }, to: 'https://lupinum.com/impressum' },
        { label: { en: 'Privacy' }, to: 'https://lupinum.com/datenschutz' },
      ],
    },
    nav: { links: 'auto', socialIcons: true },
    social: {
      github: 'https://github.com/lupinum-dev/better-convex',
      discord: 'https://discord.gg/RPH6SeA36N',
    },
    feedback: { enabled: true },
    analytics: { plausible: { scriptId: '03E34LSIgT0kGko07f39A' } },
    repository: {
      url: 'https://github.com/lupinum-dev/better-convex',
      branch: 'main',
      contentDirectory: 'docs/content',
    },
    landing: {
      eyebrow: { en: 'Nuxt 4 × Convex' },
      title: { en: 'Realtime Nuxt apps, one coherent lifecycle.' },
      description: {
        en: 'SSR-to-realtime queries, Better Auth, request-scoped server calls, optimistic updates, uploads, and one structured error model.',
      },
      primary: {
        label: { en: 'Choose your path' },
        to: { en: '/docs/get-started/choose-your-path' },
      },
      secondary: {
        label: { en: 'View on GitHub' },
        to: { en: 'https://github.com/lupinum-dev/better-convex' },
      },
      features: [
        {
          title: { en: 'SSR to realtime' },
          description: {
            en: 'Render once on the server, hydrate without duplicate work, then continue as a live subscription.',
          },
          icon: 'lucide:refresh-cw',
        },
        {
          title: { en: 'Identity stays isolated' },
          description: {
            en: 'Better Auth and Convex identity move through explicit, request-safe boundaries.',
          },
          icon: 'lucide:fingerprint',
        },
        {
          title: { en: 'Production behavior included' },
          description: {
            en: 'Typed server calls, optimistic state, uploads, connection status, and structured errors share one model.',
          },
          icon: 'lucide:blocks',
        },
      ],
    },
  },
}
