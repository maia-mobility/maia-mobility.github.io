/**
 * 히어로 캔버스가 실제로 그려지는지 픽셀로 확인한다.
 *
 *   node scripts/hero-check.mjs [baseUrl] [waitMs]
 *   node scripts/hero-check.mjs https://maia-mobility.github.io
 *
 * 첫 인자는 **주소**다 — audit.mjs · stage-check.mjs 와 같은 규칙이다.
 * (예전에는 여기만 경로를 받아서, 배포 주소를 넘겼더니 localhost 뒤에 그대로
 *  이어 붙어 "Cannot navigate to invalid URL" 로 죽었다.)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:4321').replace(/\/+$/, '');
const PATHS = ['/', '/ko'];
const WAIT = Number(process.argv[3] ?? 5000);
const OUT =
  '/private/tmp/claude-501/-Users-dnwls-Desktop-Lab--------------/cf7eb34b-8577-4c97-897a-4ff1edf20d5d/scratchpad/shots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--enable-gpu-rasterization'],
});

for (const path of PATHS) {
  for (const [w, h, tag] of [
    [1280, 860, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });

    // 스윕이 한 바퀴 돌 시간을 실제로 기다린다
    await new Promise((r) => setTimeout(r, WAIT));

    const r = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return { err: 'canvas 없음' };
      const g = c.getContext('2d');
      if (!g) return { err: '2d 컨텍스트 없음' };

      const { width, height } = c;
      const d = g.getImageData(0, 0, width, height).data;

      let lit = 0;
      const cols = new Array(16).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        // 배경 #05070A 보다 눈에 띄게 밝은 픽셀
        if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 28) {
          lit++;
          const px = (i / 4) % width;
          cols[Math.min(15, Math.floor((px / width) * 16))]++;
        }
      }
      return {
        w: width,
        h: height,
        litPct: ((lit / (d.length / 4)) * 100).toFixed(3),
        colsLit: cols.filter((n) => n > 0).length,
        aria: c.getAttribute('aria-hidden'),
      };
    });

    const file = `${OUT}/check${path.replace(/\//g, '_')}-${tag}.png`;
    await page.screenshot({ path: file });

    const ok = !r.err && Number(r.litPct) > 0.05 && r.colsLit === 16;
    console.log(
      `${(path + ' ' + tag).padEnd(18)} ${ok ? '✓' : '✗'}  ` +
        (r.err
          ? r.err
          : `버퍼 ${r.w}×${r.h}  밝은픽셀 ${r.litPct}%  가로16구간중 ${r.colsLit}개 점등  aria-hidden=${r.aria}`),
    );
    await page.close();
  }
}

await browser.close();
