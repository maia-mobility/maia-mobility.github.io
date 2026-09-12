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

  /*
   * 콘텐츠 보안 정책(CSP). Astro 가 인라인 스크립트·스타일마다 **해시**를 계산해
   * 넣어 준다 — `'unsafe-inline'` 을 쓰지 않으므로, 주입된 스크립트는 해시가
   * 맞지 않아 브라우저가 **실행을 거부한다.** 정적 호스팅이라 헤더를 못 넣는
   * 대신 `<meta http-equiv>` 로 나간다.
   *
   * 이 사이트는 외부 리소스를 하나도 쓰지 않는다(폰트·스크립트 전부 자체 호스팅).
   * 그래서 기본값인 `'self'` 만으로 전부 돌아가고, 예외를 열어 줄 곳이 없다.
   * 나중에 외부 스크립트를 넣게 되면 여기서 명시적으로 열어야 한다 — 그 순간
   * "무엇을 왜 불러오는가"를 한 번 생각하게 되는 것이 이 설정의 또 다른 값이다.
   */
  security: {
    csp: {
      /*
       * 스크립트·스타일은 Astro 가 해시로 잠근다(위 설명). 나머지는 여기서 닫는다.
       * 이 사이트가 실제로 부르는 외부 출처는 **하나도 없으므로** 전부 `'self'` 다.
       *
       * `frame-ancestors`(클릭재킹 방지)는 일부러 넣지 않았다 — `<meta>` 로는
       * 브라우저가 무시하는 지시어라, 넣으면 보호받는다고 착각하게 된다.
       * 그것만은 응답 헤더로만 가능하고 GitHub Pages 는 헤더를 못 넣는다.
       */
      directives: [
        "default-src 'self'",
        "img-src 'self' data:", // 캔버스 스냅샷·SVG 파비콘
        // 폰트는 전부 자체 호스팅(@fontsource·pretendard)이지만, Vite 가 4KB 미만
        // 서브셋(키릴 등)을 `data:` URI 로 인라인한다. data: 폰트는 실행되는 것이
        // 없어 위험이 없다 — 막으면 그 글자만 폴백으로 떨어진다.
        "font-src 'self' data:",
        "connect-src 'self'", // fetch·XHR·WebSocket 을 쓰지 않는다
        "object-src 'none'", // <object>·<embed> 금지
        "base-uri 'self'", // <base> 주입으로 상대경로를 훔치는 것을 막는다
        "form-action 'none'", // 폼이 없다 — 생기면 그때 연다
      ],

      /*
       * 인라인 `style=""` **속성**만 따로 연다.
       *
       * `style-src` 에 해시가 있으면 CSP 규격상 `'unsafe-inline'` 은 무시되고,
       * 속성에는 해시를 붙일 자리가 없다 — 그래서 속성이 통째로 막힌다.
       * 막히면 `--k`(연구 덱의 현재 위치 표시)·초상 비율·히어로 타이핑이
       * **조용히** 죽는다. 콘솔에도 안 찍혀서 화면을 봐야만 알 수 있다.
       * (실제로 그렇게 배포됐고, 눈금 넷이 다 켜진 것을 사람이 보고 잡았다.)
       *
       * `style-src-attr` 은 속성만 다스리는 별도 지시어라 해시가 없고,
       * 여기서는 `'unsafe-inline'` 이 그대로 적용된다. `<style>` 요소와
       * **스크립트는 해시로 잠긴 채** 남는다 — XSS 의 핵심은 그대로 막힌다.
       *
       * 이 사이트는 사용자 입력을 받지 않는다(폼·쿼리 반영·댓글 없음).
       * 속성을 주입할 경로 자체가 없으므로 실질적인 손실이 없다.
       */
      styleDirective: {
        resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }],
      },
    },
  },

  build: {
    // CSS를 인라인하지 않고 별도 파일로 — 페이지 간 캐시가 걸린다
    inlineStylesheets: 'never',
  },
});
