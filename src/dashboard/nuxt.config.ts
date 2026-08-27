// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // NUXT_DASHBOARD_PASSWORD — required, see server/middleware/auth.ts
    dashboardPassword: '',
  },
  // Light-only — no dark mode designed for this app, but @nuxt/ui otherwise
  // auto-follows the OS/browser prefers-color-scheme via @nuxtjs/color-mode.
  ui: {
    colorMode: false,
  },
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  modules: [
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxtjs/google-fonts',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    'dayjs-nuxt',
    'nuxt-charts'
  ]
})