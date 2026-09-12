/**
 * 반응형·접근성 실측. 추측 대신 실제 브라우저에서 잰다.
 *
 *   npm run audit            (개발 서버가 떠 있어야 한다)
 *   node scripts/audit.mjs http://localhost:4321
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTHS = [320, 390, 768, 1280, 1920];
const PAGES = [
  '',
  'research',
  'people',
  'publications',
  'teaching',
  'news',
  'ko',
  'ko/research',
  'ko/people',
  'ko/publications',
  'ko/teaching',
  'ko/news',
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

let fail = 0;
const rows = [];

for (const path of PAGES) {
  for (const w of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });

    let status = 0;
    try {
      const res = await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle0', timeout: 30000 });
      status = res ? res.status() : 0;
    } catch {
      status = -1;
    }

    const r = await page.evaluate(() => {
      const de = document.documentElement;

      // 뷰포트를 넘치는 요소를 전수 조사한다
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.right > de.clientWidth + 1 || b.left < -1) {
          const cls = String(el.className || '').split(' ')[0];
          culprits.push(`${el.tagName.toLowerCase()}.${cls}`);
        }
      }

      const navBtn = document.querySelector('[data-nav-toggle]');
      const navDesk = document.querySelector('header nav[aria-label]');

      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        culprits: [...new Set(culprits)].slice(0, 4),
        h1: document.querySelectorAll('h1').length,
        canvasBad: [...document.querySelectorAll('canvas')].filter(
          (c) => c.getAttribute('aria-hidden') !== 'true',
        ).length,
        navBtn: navBtn ? getComputedStyle(navBtn).display !== 'none' : null,
        navDesk: navDesk ? getComputedStyle(navDesk).display !== 'none' : null,
        rootFont: getComputedStyle(de).fontSize,
      };
    });

    const overflow = r.scrollW > r.clientW;
    const bad = overflow || r.h1 !== 1 || r.canvasBad > 0 || status !== 200;
    if (bad) fail++;
    rows.push({ path: path || '(home)', w, status, overflow, bad, ...r });
    await page.close();
  }
}

await browser.close();

console.log('경로            폭    상태 가로스크롤        h1 메뉴Btn 데스크톱 넘치는요소');
console.log('─'.repeat(100));
for (const r of rows) {
  const scroll = r.overflow ? `넘침 ${r.scrollW}>${r.clientW}` : 'OK';
  console.log(
    `${r.path.padEnd(15)} ${String(r.w).padStart(4)} ${String(r.status).padStart(4)} ` +
      `${scroll.padEnd(16)} ${String(r.h1).padStart(2)} ` +
      `${String(r.navBtn).padEnd(7)} ${String(r.navDesk).padEnd(8)} ${r.culprits.join(' ')}`,
  );
}

console.log(`\nroot font-size: ${rows[0]?.rootFont}`);
console.log(fail === 0 ? '\n✓ 전부 통과' : `\n✗ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
