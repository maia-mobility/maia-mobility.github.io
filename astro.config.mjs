// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// TODO: 배포 주소 확정되면 교체 (GitHub Pages면 https://<user>.github.io/<repo>).
// 빌드 시 SITE_URL 환경변수로도 덮어쓸 수 있다.
const SITE = process.env.SITE_URL ?? 'https://maia-lab.pages.dev';

// https://astro.build/config
export default defineConfig({
  site: SITE,

  i18n: {
    locales: ['en', 'ko'],
    defaultLocale: 'en',
    routing: {
      // 영문은 접두사 없이 `/`, 한글은 `/ko/`
      prefixDefaultLocale: false,
    },
  },

  integrations: [
    react(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', ko: 'ko-KR' },
      },
    }),
  ],

  build: {
    // CSS를 인라인하지 않고 별도 파일로 — 페이지 간 캐시가 걸린다
    inlineStylesheets: 'never',
  },
});
