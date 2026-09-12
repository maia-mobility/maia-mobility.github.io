/**
 * 화면에 가로로 긴 "줄"이 생기는 지점을 찾는다.
 * 각 픽셀 행의 평균 색과 앞 행과의 차이를 재서, 급격히 튀는 행을 집어낸다.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const FRAC = Number(process.argv[3] ?? 0.18);

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 3500));

const H = await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
await p.evaluate((y) => window.scrollTo(0, y), Math.round(H * FRAC));
await new Promise((r) => setTimeout(r, 1500));

const shot = await p.screenshot({ encoding: 'base64' });

// 캔버스 픽셀을 직접 읽어 행 평균을 낸다(스크린샷 디코딩 없이).
const rows = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const g = c.getContext('2d');
  const { width, height } = c;
  const d = g.getImageData(0, 0, width, height).data;
  const out = [];
  for (let y = 0; y < height; y++) {
    let r = 0, gg = 0, bb = 0, a = 0, lit = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r += d[i]; gg += d[i + 1]; bb += d[i + 2]; a += d[i + 3];
      // 캔버스는 alpha:false 로 잡혀 있어 알파 채널이 늘 255 다 — 밝기로 센다.
      if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 28) lit++;
    }
    out.push({ y, r: r / width, g: gg / width, b: bb / width, a: a / width, lit });
  }
  return { width, height, out };
});

if (!rows) {
  console.log('캔버스 없음');
} else {
  const { height, out } = rows;
  // 앞 행 대비 "밝기 총합" 이 급증하는 행 = 가로줄
  const score = out.map((row, i) => {
    const prev = out[Math.max(0, i - 3)];
    return { y: row.y, jump: row.lit - prev.lit, lit: row.lit, r: row.r, g: row.g, b: row.b };
  });
  const top = [...score].sort((a, c) => c.jump - a.jump).slice(0, 6);
  console.log(`캔버스 ${rows.width}×${height}, 스크롤 ${Math.round(FRAC * 100)}%`);
  console.log('가장 급격한 가로줄 후보 (y / 점개수 급증 / 평균 RGB):');
  for (const s of top) {
    const hue = s.b > s.r * 1.4 && s.b > s.g * 1.2 ? ' ← 파랑' : '';
    console.log(
      `  y=${String(s.y).padStart(4)}  +${String(s.jump).padStart(4)}점  ` +
        `rgb(${s.r.toFixed(0)},${s.g.toFixed(0)},${s.b.toFixed(0)})${hue}`,
    );
  }
  // 가장 아래쪽에서 점이 사라지는 경계
  let lastLit = 0;
  for (let i = 0; i < out.length; i++) if (out[i].lit > 2) lastLit = i;
  console.log(`점이 있는 마지막 행: y=${lastLit} / ${height}  (아래 ${height - lastLit}px 는 비어 있음)`);

  // y 방향 점 분포 — 대시캠 구간에서 하단이 비어 있지 않은지 본다
  const third = (a, b) => out.slice(Math.round(height * a), Math.round(height * b))
    .reduce((s, r) => s + r.lit, 0);
  const [t, m, btm] = [third(0, 1 / 3), third(1 / 3, 2 / 3), third(2 / 3, 1)];
  const all = t + m + btm || 1;
  console.log(
    `y 분포  상 ${t} (${((t / all) * 100).toFixed(1)}%) · ` +
      `중 ${m} (${((m / all) * 100).toFixed(1)}%) · 하 ${btm} (${((btm / all) * 100).toFixed(1)}%)`,
  );
}

await p.screenshot({
  path: process.argv[4] ?? '/tmp/band.png',
});
await b.close();
void shot;
