/**
 * OG 이미지 생성 — 히어로의 실제 포인트클라우드를 한 프레임 캡처해서 쓴다.
 * 별도로 그림을 그리지 않는다. 사이트가 바뀌면 이 스크립트를 다시 돌리면 된다.
 *
 *   npm run og                       (빌드 → preview → 캡처 → preview 종료)
 *   node scripts/make-og.mjs <url>   (이미 떠 있는 서버에 대고)
 *
 * 기본값이 preview(프로덕션 빌드)인 이유: 개발 서버에는 Astro 개발 툴바가 떠 있어서
 * 미리보기 이미지 하단에 같이 찍힌다.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/og');
mkdirSync(OUT, { recursive: true });

// OG 권장 1200×630
const W = 1200;
const H = 630;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const BASE = process.argv[2] ?? 'http://localhost:4321';

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// 스윕이 한 바퀴 다 돌아 점군이 전부 드러난 뒤에 찍는다
await new Promise((r) => setTimeout(r, 9000));

// 정지 이미지에서 의미 없는 요소를 숨긴다.
// 클래스명은 CSS Modules 가 해싱하므로 접두사로 찾는다.
const hidden = await page.evaluate(() => {
  const hide = (el) => {
    if (el instanceof HTMLElement) {
      el.style.visibility = 'hidden';
      return 1;
    }
    return 0;
  };
  let n = 0;
  // 스크롤 힌트
  for (const el of document.querySelectorAll('p, div, a')) {
    if (/(^|_)scroll(_|$)/.test(String(el.className))) n += hide(el);
  }
  // 내비 — 미리보기에서는 잡음이다
  n += hide(document.querySelector('body > header'));
  // 개발 서버일 때만 존재하는 Astro 툴바
  n += hide(document.querySelector('astro-dev-toolbar'));
  return n;
});
console.log(`숨긴 요소 ${hidden}개 (스크롤 힌트 · 내비 · 개발툴바)`);

const file = join(OUT, 'cover.png');
await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });

const lit = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return 0;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 28) n++;
  return ((n / (d.length / 4)) * 100).toFixed(3);
});

await browser.close();

console.log(`OG 이미지 생성: public/og/cover.png (${W}×${H})`);
console.log(`캔버스 밝은 픽셀 ${lit}% ${Number(lit) > 0.05 ? '✓ 점군이 찍혔다' : '✗ 비어 있다 — 대기 시간을 늘려라'}`);
process.exit(Number(lit) > 0.05 ? 0 : 1);
