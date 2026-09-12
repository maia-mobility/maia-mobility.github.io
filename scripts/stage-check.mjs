/**
 * 연구 무대 실측.
 *
 * 무대는 **옆으로 넘기는 덱**이다. 그래서 훑는 방향도 두 개다:
 *
 *   ① 세로 — 시점이 **무대에서만** 오르내리는가 (그 전후로는 대시캠 1.3m)
 *   ② 가로 — 패널을 하나씩 넘기며 그 막이 실제로 서는가
 *
 * 가로에서 확인하는 것:
 *   · 넘긴 패널의 막만 만개한다 (두 개가 동시에 서면 실패)
 *   · 막마다 카메라가 **다른 자리**에 선다 — 같은 구도면 주석만 바뀐 것이다
 *   · 차간이 불규칙하다 (자로 잰 듯 일정하면 실패)
 *   · 옆 차로에 stop-and-go 파동이 실제로 있다
 *     (한 번은 `step()` 에 난수원을 안 넘겨 일곱 대가 표준편차 0.01m/s 로
 *      굴러간 적이 있다. 화면만 보고는 몰랐고 이 수치가 잡아냈다.)
 *   · 배역(03막 승객·04막 합류차)이 실제로 연기한다
 *   · 차량이 서로 겹치지 않는다
 *   · 지금 선 패널의 시뮬레이션 **하나만** 돌아간다 (나머지는 rAF 정지)
 *
 * 값은 `canvas.roadProbe` 에서 읽는다. 스크린샷 판정이 아니라 계측이다.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/**
 * 한 패널에 머무는 시간(ms)과 표본 수.
 *
 * 무대에 서 있는 동안 도로는 **스스로** 달리고(장면 속도 3.4 m/s), 한 막의 연출은
 * 주행 38m = 약 11초에 한 바퀴 돈다. 그보다 짧게 머물면 승객이 타기도, 파동이
 * 후미에 닿기도 전에 다음 패널로 넘어간다 — 연출이 없는 게 아니라 **덜 본** 것이다.
 * 사람이 한 분야를 보는 시간과 같은 길이로 잡는다.
 */
const DWELL_MS = 13000;
const SAMPLES = 11;

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 3000));

const read = async () =>
  p.evaluate(() => {
    const c = document.querySelector('canvas');
    const rp = c?.roadProbe;
    const cs = getComputedStyle(document.documentElement);
    const room = document.querySelector('[data-deck-room]');
    const track = document.querySelector('[data-deck]');
    return {
      probe: rp
        ? {
            camY: rp.camY,
            rise: rp.rise,
            cars: rp.cars,
            peds: rp.peds,
            acts: [...rp.acts],
            gaps: [...rp.gaps],
            gapsHuman: [...rp.gapsHuman],
            waveBand: [...rp.waveBand],
            speed: [...rp.speed],
            pickup: [...rp.pickup],
            overlap: rp.overlap,
            merge: rp.merge,
            mergeK: rp.mergeK,
            wave: [...rp.wave],
          }
        : null,
      css: [0, 1, 2, 3].map((i) => Number(cs.getPropertyValue(`--a${i}`) || 0)),
      roomTop: room ? Math.round(room.getBoundingClientRect().top) : null,
      deckX: track ? Math.round(track.scrollLeft) : null,
      scroll: Math.round(window.scrollY),
      docH: document.documentElement.scrollHeight,
    };
  });

let fail = 0;
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fail++;
};
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

/* ── ① 세로: 시점이 무대에서만 오르내리는가 ─────────────────────── */
const docH = (await read()).docH;
const range = docH - 860;
console.log(`문서 ${docH}px · 스크롤 범위 ${range}px\n`);
console.log('① 세로 훑기');
console.log('    진행%   camY   rise   차량  사람');
console.log('    ' + '─'.repeat(38));

const vert = [];
for (let i = 0; i <= 20; i++) {
  await p.evaluate((y) => window.scrollTo(0, y), Math.round((range * i) / 20));
  // 카메라는 스크롤 목표를 감쇠 추종한다 — 따라붙을 시간을 준다.
  await new Promise((r) => setTimeout(r, 550));
  const s = await read();
  if (!s.probe) continue;
  vert.push(s.probe);
  console.log(
    `    ${String(i * 5).padStart(4)}%  ${s.probe.camY.toFixed(2).padStart(5)}m  ` +
      `${s.probe.rise.toFixed(2)}  ${String(s.probe.cars).padStart(4)}  ${String(s.probe.peds).padStart(4)}`,
  );
}

console.log('');
const maxRise = Math.max(...vert.map((r) => r.rise));
say(maxRise > 0.9, `연구 무대에서 시점이 올라간다 (최대 rise ${maxRise.toFixed(2)})`);
say(vert[0].rise < 0.02, `무대 전에는 대시캠 (camY ${vert[0].camY.toFixed(2)}m)`);
say(
  vert[vert.length - 1].rise < 0.05,
  `무대를 지나면 다시 대시캠으로 내려온다 (camY ${vert[vert.length - 1].camY.toFixed(2)}m)`,
);

/* ── ② 가로: 패널을 하나씩 넘긴다 ──────────────────────────────── */
const start = await p.evaluate(() => {
  const r = document.querySelector('[data-deck-room]').getBoundingClientRect();
  return Math.round(r.top + window.scrollY + 60);
});
await p.evaluate((y) => window.scrollTo(0, y), start);
await new Promise((r) => setTimeout(r, 900));

console.log('\n② 가로 넘기기 (무대 위)');
console.log('    패널   camY   rise   막(a0 a1 a2 a3)     차간σ   옆차로 속도대   겹침');
console.log('    ' + '─'.repeat(70));

const rows = [];
for (let k = 0; k < 4; k++) {
  await p.evaluate((i) => {
    const t = document.querySelector('[data-deck]');
    t.scrollTo({ left: t.clientWidth * i });
  }, k);
  await new Promise((r) => setTimeout(r, 900));
  for (let d = 0; d < SAMPLES; d++) {
    // 세로로는 움직이지 않는다 — 무대 위의 도로는 스스로 달린다.
    await new Promise((r) => setTimeout(r, DWELL_MS / SAMPLES));
    const s = await read();
    if (!s.probe) continue;
    const g = s.probe.gaps;
    const mean = g.reduce((a, v) => a + v, 0) / (g.length || 1);
    const sd = Math.sqrt(g.reduce((a, v) => a + (v - mean) ** 2, 0) / (g.length || 1));
    rows.push({ k, ...s.probe, sd, mean, css: s.css });
    if (d === SAMPLES - 1) {
      const bar = s.probe.acts
        .map((a) => (a > 0.66 ? '█' : a > 0.33 ? '▓' : a > 0.05 ? '░' : '·'))
        .join('');
      console.log(
        `    ${String(k + 1).padStart(4)}  ${s.probe.camY.toFixed(2).padStart(5)}m  ` +
          `${s.probe.rise.toFixed(2)}  ${bar}  ${s.probe.acts.map((a) => a.toFixed(2)).join(' ')}  ` +
          `${sd.toFixed(2)}m  ${s.probe.waveBand[0].toFixed(0).padStart(3)}–${s.probe.waveBand[1].toFixed(0)}km/h  ` +
          `${String(s.probe.overlap).padStart(4)}`,
      );
    }
  }
}

console.log('');
// 넘긴 패널의 막이 서는가 — CSS 변수와 캔버스가 같은 값을 보는가도 함께 본다
for (let k = 0; k < 4; k++) {
  const on = rows.filter((r) => r.k === k);
  const peak = Math.max(...on.map((r) => r.acts[k]));
  const cssPeak = Math.max(...on.map((r) => r.css[k]));
  say(
    peak > 0.9 && cssPeak > 0.9,
    `0${k + 1} 패널을 넘기면 0${k + 1}막이 선다 (캔버스 ${peak.toFixed(2)} · CSS ${cssPeak.toFixed(2)})`,
  );
}
const clash = rows.filter((r) => r.acts.filter((a) => a > 0.85).length > 1);
say(clash.length === 0, `막이 겹쳐 만개하지 않는다 (겹침 ${clash.length}지점)`);

// 막마다 카메라가 다른 자리에 선다 — 같은 구도면 "주석만 바뀐 화면"이 된다
const camAt = [0, 1, 2, 3].map((k) => med(rows.filter((r) => r.k === k).map((r) => r.camY)));
const camSpread = Math.max(...camAt) - Math.min(...camAt);
say(
  camSpread > 3,
  `막마다 카메라가 다른 자리에 선다 (${camAt.map((v) => v.toFixed(1)).join(' / ')}m · 폭 ${camSpread.toFixed(1)}m)`,
);

/* 불규칙성은 **사람 운전 차로**에서 잰다. 앞 대열은 상용 ACC 라 간격이 고른 것이
   정상이고(그게 ACC 다), 실제로 고르게 만들어 두었다 — 사람 폭의 정지간격 편차를
   주었더니 차간이 21m 까지 벌어져 선두 급제동이 두 대 뒤에서 흡수돼 버렸다.

   판정은 **비율**로 한다. 절대값(표준편차 1.2m 같은)으로 잡으면 장면의 기준 속도를
   바꾸는 순간 같이 무너진다 — 실제로 정체류(12km/h)로 낮췄더니 현상은 그대로인데
   수치만 임계값 아래로 떨어졌다. 변동의 **상대적 크기**를 본다. */
const cvHuman = med(
  rows.map((r) => {
    const g = r.gapsHuman;
    const m = g.reduce((a, v) => a + v, 0) / (g.length || 1);
    const sd = Math.sqrt(g.reduce((a, v) => a + (v - m) ** 2, 0) / (g.length || 1));
    return sd / Math.max(0.1, m);
  }),
);
const cvFleet = med(rows.map((r) => r.sd / Math.max(0.1, r.mean)));
say(
  cvHuman > 0.2,
  `사람 운전 차로의 차간이 불규칙하다 (변동계수 중앙값 ${(cvHuman * 100).toFixed(0)}% · 앞 대열 ACC 는 ${(cvFleet * 100).toFixed(0)}%)`,
);

const spread = Math.max(...rows.map((r) => (r.waveBand[1] - r.waveBand[0]) / Math.max(1, r.waveBand[1])));
const wLo = Math.min(...rows.map((r) => r.waveBand[0]));
const wHi = Math.max(...rows.map((r) => r.waveBand[1]));
say(spread > 0.7, `옆 차로에 stop-and-go 파동이 있다 (속도대 폭 ${(spread * 100).toFixed(0)}%)`);
say(wLo < 4, `파동이 실제로 차를 세운다 (최저 ${wLo.toFixed(0)}km/h · 최고 ${wHi.toFixed(0)}km/h)`);

const hailed = rows.filter((r) => r.k === 2 && r.pickup[0] && r.pickup[1] < 70).length;
const boarded = rows.some((r) => r.pickup[4] > 0);
const mk = Math.max(0, ...rows.filter((r) => r.k === 3).map((r) => r.mergeK));
say(hailed > 0, `03막에서 배차 차량이 화면 안에 선다 (지점 ${hailed})`);
say(boarded, '03막에서 승객이 탑승한다');
say(mk > 0.5, `04막에서 옆 차로 차가 합류한다 (합류 진행도 최대 ${mk.toFixed(2)})`);

const ov = rows.reduce((a, r) => a + r.overlap, 0);
say(ov === 0, `차량이 서로 겹치지 않는다 (겹친 쌍 ${ov})`);

/* 01막의 교란이 실제로 후미까지 내려가는가 — 화면의 제동등 연쇄와 같은 기준이다.
   보는 것은 **파동이 뒤로 움직이는가**이지 어느 깊이까지 가는가가 아니다. */
// 제동 연쇄는 **플래툰 막**(지금은 02번 패널)에서만 걸린다 — 화면 순서가 바뀌면 여기도 바뀐다.
const PLATOON_PANEL = 1;
const fronts = rows.filter((r) => r.k === PLATOON_PANEL && r.wave[0] > 0).map((r) => r.wave[0]);
/* **깊이가 아니라 전파를 본다.** 이 장면은 12km/h·차두 1.7s 의 상용 ACC 라
   스트링 **안정** 영역이다 — 교란이 뒤로 갈수록 잦아든다(−4 → −0.7 → −0.3 → −0.1).
   증폭은 /research 의 12대·54km/h 설정이 보여준다. 여기서 참인 것은 "선두의 제동이
   뒤차로 전달되어 뒤로 흘러간다"이고, 그것만 잰다. 깊이를 요구하는 판정을 두면
   대열이 우연히 압축된 순간에만 통과하는, 재현되지 않는 검사가 된다. */
const maxFront = fronts.length ? Math.max(...fronts) : 0;
const maxReach = Math.max(0, ...rows.filter((r) => r.k === PLATOON_PANEL).map((r) => r.wave[1]));
say(
  maxFront >= 2 && maxReach > 12,
  `02막 교란이 뒷차로 전파된다 (VEH ${maxFront}/${rows[0].speed.length} · ${maxReach.toFixed(0)}m 뒤까지)`,
);

/* 시뮬레이션은 **보이는 것 하나만** 돈다. 넷이 동시에 돌면 배터리도 프레임도 없다.
   캔버스 한가운데 띠의 픽셀이 변하는지로 잰다 — rAF 를 세는 것보다 정직하다. */
const busy = await p.evaluate(async () => {
  const cs = [...document.querySelectorAll('[data-act] canvas')];
  const snap = () =>
    cs.map((c) => {
      try {
        const d = c.getContext('2d').getImageData(0, (c.height >> 1) - 8, c.width, 16).data;
        let h = 7;
        for (let i = 0; i < d.length; i += 17) h = (h * 31 + d[i]) >>> 0;
        return h;
      } catch {
        return -1;
      }
    });
  const a = snap();
  await new Promise((r) => setTimeout(r, 700));
  const c2 = snap();
  return a.map((v, i) => v !== c2[i]);
});
say(
  busy.filter(Boolean).length === 1 && busy[3] === true,
  `지금 선 패널의 시뮬만 돌아간다 (구동 ${busy.map((v) => (v ? '●' : '○')).join('')})`,
);

/* 넘길 수 있다는 것을 알리는 장치가 실제로 넘기는가. 스크립트 없이 앵커만으로
   도는 구조라, 링크가 빠지면 덱은 넘길 수 없는 채로 조용히 남는다. */
await p.evaluate(() => document.querySelector('[data-deck]').scrollTo({ left: 0, behavior: 'auto' }));
await new Promise((r) => setTimeout(r, 900));
const yBefore = await p.evaluate(() => window.scrollY);
await p.evaluate(() =>
  document.querySelector('[data-act="0"]').querySelector('a[href^="#area-"]').click(),
);
await new Promise((r) => setTimeout(r, 1500));
const stepped = await p.evaluate(() => {
  const t = document.querySelector('[data-deck]');
  return { x: Math.round(t.scrollLeft), w: t.clientWidth, y: window.scrollY };
});
stepped.dy = Math.round(stepped.y - yBefore);
say(stepped.x === stepped.w, `▸ 를 누르면 다음 분야로 넘어간다 (scrollLeft ${stepped.x}/${stepped.w})`);
say(Math.abs(stepped.dy) <= 2, `넘길 때 페이지가 세로로 튀지 않는다 (${stepped.dy}px)`);

await p.screenshot({ path: process.argv[3] ?? '/tmp/stage.png' });
await b.close();
process.exit(fail ? 1 : 0);
