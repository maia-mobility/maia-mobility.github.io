// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

/*
 * 배포 주소. 저장소 변수 `SITE_URL` 로 덮어쓴다(.github/workflows/deploy.yml).
 * canonical · OG · sitemap · hreflang 이 전부 이 값을 쓰므로 **배포 전에 반드시**
 * 실제 주소로 맞춰야 한다. 기본값은 아직 자리표시자다.
 */
const SITE = process.env.SITE_URL ?? 'https://maia-lab.pages.dev';

/*
 * 사이트가 도메인 루트가 아니라 하위 경로에 놓일 때만 값을 준다.
 * GitHub Pages 의 **프로젝트 저장소**가 그 경우다 —
 *   계정 페이지(`<계정>.github.io`)·Cloudflare Pages·커스텀 도메인 → base 불필요
 *   프로젝트 저장소(`<계정>.github.io/maia-lab`)             → BASE_PATH=/maia-lab
 *
 * 코드 쪽은 `src/i18n/index.ts` 의 `href()`·`asset()`·`stripBase()` 가 이 값을
 * 흡수한다. 링크를 만들 때 붙이고 주소를 읽을 때 떼어내는 짝이라, 한쪽만 고치면
 * 언어 토글이 자기 자신을 가리킨다.
 */
const BASE = process.env.BASE_PATH || undefined;

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,

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
