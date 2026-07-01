import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Social Annotate',
  description: 'Self-Healing Browser Extension to Annotate and Collect Social Media Data',
  base: '/social-annotate/',
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'icon', href: '/social-annotate/icon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,700;0,800;1,700&display=swap' }],
  ],
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Installation', link: '/installation/' },
      { text: 'Configuration', link: '/configuration/' },
      { text: 'Intervention', link: '/intervention/' },
      { text: 'Agent', link: '/agent/' },
      { text: 'About', link: '/about/' },
    ],
    sidebar: {
      '/installation/': [
        {
          text: 'Installation',
          items: [
            { text: 'Getting Started', link: '/installation/#getting-started' },
            { text: 'Load the Extension', link: '/installation/#load-the-extension' },
            { text: 'Quick Start', link: '/installation/#quick-start' },
          ],
        },
      ],
      '/configuration/': [
        {
          text: 'Configuration',
          items: [
            { text: 'Options Page', link: '/configuration/#options-page' },
            { text: 'Survey Form Schema', link: '/configuration/#survey-form-schema' },
            { text: 'Informed Consent', link: '/configuration/#informed-consent' },
            { text: 'Guided Mode', link: '/configuration/#guided-mode' },
            { text: 'Data Export', link: '/configuration/#data-export' },
            { text: 'API Endpoint', link: '/configuration/#api-endpoint' },
          ],
        },
      ],
      '/intervention/': [
        {
          text: 'Intervention',
          items: [
            { text: 'Overview', link: '/intervention/#intervention' },
            { text: 'Modes', link: '/intervention/#modes' },
            { text: 'Live Server', link: '/intervention/#live-server' },
            { text: 'Static Map', link: '/intervention/#static-map' },
          ],
        },
      ],
      '/agent/': [
        {
          text: 'Self-Healing Agent',
          items: [
            { text: 'Overview', link: '/agent/#overview' },
            { text: 'How It Works', link: '/agent/#how-it-works' },
            { text: 'Prerequisites', link: '/agent/#prerequisites' },
            { text: 'Usage', link: '/agent/#usage' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ViralLab/social-annotate' },
    ],
    footer: {
      message: 'Released under the GPL-3.0 License.',
      copyright: 'Copyright © 2026 Ali Najafi, Ismail Uluturk, Onur Varol',
    },
  },
})
