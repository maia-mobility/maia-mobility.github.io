/**
 * dot portrait 가 실제로 해상되는지, JS 가 꺼져도 사진이 보이는지 확인한다.
 *   node scripts/portrait-check.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const OUT =
  '/private/tmp/claude-501/-Users-dnwls-Desktop-Lab--------------/cf7eb34b-8577-4c97-897a-4ff1edf20d5d/scratchpad/shots';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const probe = () =>
  page.evaluate(() => {
    const wrap = document.querySelector('[data-dot-wrap]');
    const c = document.querySelector('canvas[data-dot-portrait]');
    if (!c || !wrap) return { err: '요소 없음' };
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) lit++;
    const img = wrap.querySelector('img');
    return {
      litPct: ((lit / (d.length / 4)) * 100).toFixed(2),
      active: wrap.getAttribute('data-dot-active'),
      resolved: wrap.getAttribute('data-resolved'),
      imgOpacity: img ? getComputedStyle(img).opacity : '?',
      canvasOpacity: getComputedStyle(c).opacity,
      aria: c.getAttribute('aria-hidden'),
    };
  });

// ── 1. 정상 (JS 켜짐) ─────────────────────────────────────
let page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/people`, { waitUntil: 'networkidle0' });

console.log('── JS 켜짐 · 해상 과정 ──');
await page.evaluate(() => document.querySelector('[data-dot-wrap]')?.scrollIntoView({ block: 'center' }));
for (const t of [300, 700, 1500, 2600]) {
  await new Promise((r) => setTimeout(r, t === 300 ? 300 : 500));
  const r = await probe();
  console.log(
    `  ~${String(t).padStart(4)}ms  점군 ${String(r.litPct).padStart(5)}%  ` +
      `active=${r.active} resolved=${r.resolved ?? '-'}  ` +
      `img=${r.imgOpacity} canvas=${r.canvasOpacity}  aria-hidden=${r.aria}`,
  );
}
await page.screenshot({ path: `${OUT}/portrait-resolved.png`, clip: { x: 0, y: 200, width: 700, height: 640 } });

// 해상 중간 장면
const p2 = await browser.newPage();
await p2.setViewport({ width: 1280, height: 900 });
await p2.goto(`${BASE}/people`, { waitUntil: 'networkidle0' });
await p2.evaluate(() => document.querySelector('[data-dot-wrap]')?.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 450));
await p2.screenshot({ path: `${OUT}/portrait-mid.png`, clip: { x: 0, y: 200, width: 700, height: 640 } });
await p2.close();

// ── 2. JS 꺼짐 ────────────────────────────────────────────
await page.close();
page = await browser.newPage();
await page.setJavaScriptEnabled(false);
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/people`, { waitUntil: 'networkidle0' });
const noJs = await page.evaluate(() => {
  const wrap = document.querySelector('[data-dot-wrap]');
  const img = wrap?.querySelector('img');
  return {
    active: wrap?.getAttribute('data-dot-active') ?? null,
    imgOpacity: img ? getComputedStyle(img).opacity : '?',
    imgW: img?.getBoundingClientRect().width.toFixed(0),
  };
});
console.log('\n── JS 꺼짐 (사진이 그냥 보여야 한다) ──');
console.log(
  `  data-dot-active=${noJs.active ?? 'null(정상)'}  img opacity=${noJs.imgOpacity}  폭 ${noJs.imgW}px`,
);
console.log(noJs.imgOpacity === '1' ? '  ✓ 사진 보임' : '  ✗ 사진이 안 보인다');

// ── 3. reduced-motion ─────────────────────────────────────
await page.close();
page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/people`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.querySelector('[data-dot-wrap]')?.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 1200));
const rm = await probe();
console.log('\n── reduced-motion (즉시 완성 상태여야 한다) ──');
console.log(`  resolved=${rm.resolved} 점군 ${rm.litPct}% img=${rm.imgOpacity}`);

await browser.close();
console.log(`\n스크린샷: ${OUT}/portrait-mid.png · portrait-resolved.png`);
