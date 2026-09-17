import { useEffect, useRef, type RefObject } from "react";
import { useCanvas2D, type Canvas2DView } from "./useCanvas2D";
import { useRafLoop } from "./useRafLoop";
import {
  FS_DEFAULT,
  PRESETS,
  makeVehicle,
  speedSpread,
  step,
  type IDMParams,
  type Vehicle,
} from "../lib/idm";
import { PLATOON } from "../lib/scenarios";

/* ============================================================================
   usePointCloud — LiDAR 로 스캔한 정밀도로지도를 Canvas 2D 로 절차적 재생성한다.
   이미지가 아니다. 점군을 만들고, 직접 원근 투영한다.

   **도로는 페이지 전체의 배경이다.** 캔버스는 `position: fixed` 로 뷰포트에 깔려
   있고, 히어로 → 미션 → 연구 → 소식 → 함께하기 → 푸터의 주소까지 스크롤 내내
   그 위를 지나간다. 핀(sticky) 구간은 없다.

   **스크롤이 주행이다.** 시간이 아니라 문서 스크롤 위치가 카메라의 z 를 정한다.
   스크롤을 멈추면 관성으로 미끄러지다 **완전히 정지한다** — 상시 움직이는 배경이 아니다.

   **시점은 두 개다.**
     ① 블랙박스(대시캠)  — 히어로·미션 구간. 앞유리 안쪽 높이(1.3m), 수평에 가깝고 광각.
                           화면 아래를 카울(대시보드)이 가로막아 "차 안"이 읽힌다.
     ② 루프탑 LiDAR      — 연구 구간. 카메라가 12m 까지 완만히 상승하고 시선이 내려가,
                           플래툰 대형·차간거리·정체 파동이 한눈에 들어온다.

   좌표계:  x = 횡방향(오른쪽 +)   y = 높이(위 +)   z = 전방(+)
   투영  :  sx = cx + (X - camX)·f/(Z - camZ)
            sy = cy + (camY - Y)·f/(Z - camZ)     ← 캔버스 y 는 아래가 +

   외부 라이브러리 없음. three.js 없음. arc() 없음 — 점은 전부 fillRect 정사각.
   ========================================================================= */

/* ------------------------------------------------------------------ *
 * 색 — global.css 토큰에서만 읽는다 (하드 룰 8). 하드코딩된 색 없음.
 * ------------------------------------------------------------------ */

type RGB = [number, number, number];

/** 토큰을 못 읽는 환경(SSR·테스트)용 중립 회색. 팔레트를 복제하지 않는다. */
const NEUTRAL: RGB = [140, 152, 164];

function parseHexToken(raw: string): RGB | null {
  const v = raw.trim();
  if (v.length < 4 || v.charCodeAt(0) !== 35 /* '#' */) return null;
  const body = v.slice(1);
  const short = body.length === 3 || body.length === 4;
  const step2 = short ? 1 : 2;
  if (!short && body.length !== 6 && body.length !== 8) return null;
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const part = body.slice(i * step2, i * step2 + step2);
    const n = Number.parseInt(short ? part + part : part, 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

function readToken(name: string): RGB {
  if (typeof window === "undefined") return NEUTRAL;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseHexToken(raw) ?? NEUTRAL;
}

/** LiDAR intensity 램프 (global.css §2.1). 낮은 강도 → 높은 강도. */
const RAMP_TOKENS = [
  "--i-0",
  "--i-1",
  "--i-2",
  "--i-3",
  "--i-4",
  "--i-5",
  "--i-6",
] as const;

/**
 * intensity 버킷. 0‥10 = 램프 보간, 11 = `--fg` (수목·폴의 흰색 반사),
 * 12‥13 = **첫 화면 글자의 잉크 색**(§글자 = 스캔 반사점).
 * 프레임당 fillStyle 은 "버킷당 1회"만 세팅한다 — 점마다 색을 바꾸지 않는다.
 *
 * `RAMP_BUCKETS` 를 `BUCKETS − 1` 로 유도하지 않는 이유: 잉크 버킷을 뒤에 붙이면
 * 램프가 같이 늘어나 제동등(`RAMP_BUCKETS − 1`)이 엉뚱한 색이 된다.
 */
const RAMP_BUCKETS = 11; // 0‥10
/** `--fg` — 수목·폴의 흰색 반사. halo 가 붙는 마지막 버킷이다. */
const FG_BUCKET = 11;
/**
 * 잉크 버킷의 시작. 색은 **글자 요소의 computed color 에서** 그때그때 읽어 채운다
 * (`setGlyphColors`) — 토큰을 여기 복제하지 않는다.
 *
 * 따로 버킷을 두는 이유는 색이 달라서가 아니라 **halo 를 안 씌우려고**다. 글자는
 * 화면 위의 글자라 또렷해야 하는데, `--fg` 버킷(11)으로 찍으면 3px 후광이 붙어
 * 첫 프레임의 워드마크가 번져 보인다.
 */
const INK_B0 = 12;
const INK_SLOTS = 2;
const BUCKETS = INK_B0 + INK_SLOTS;

/** 거리 페이드(포그)를 담는 알파 계단. 버킷 × 알파 = 112 개의 bin. */
const ALPHA_STEPS = 8;
const BINS = BUCKETS * ALPHA_STEPS;

/** 글로우 halo 를 덧그리는 범위 — 가깝고(알파 높음) 밝은(고강도) 점만. */
const HALO_MIN_BUCKET = 8;
const HALO_MIN_ALPHA = 5;

interface Palette {
  /** bin 별 `rgba()` 문자열 — 96 개. */
  core: string[];
  /** bin 별 halo 문자열(같은 색, 낮은 알파). */
  halo: string[];
  /** 배경 — 매 프레임 전체를 이 색으로 덮는다. */
  bg: string;
}

function buildPalette(): Palette {
  const stops = RAMP_TOKENS.map(readToken);
  const colors: RGB[] = [];

  for (let b = 0; b < RAMP_BUCKETS; b++) {
    const p = (b / (RAMP_BUCKETS - 1)) * (stops.length - 1);
    const i0 = Math.min(stops.length - 1, Math.floor(p));
    const i1 = Math.min(stops.length - 1, i0 + 1);
    const k = p - i0;
    const a = stops[i0] ?? NEUTRAL;
    const c = stops[i1] ?? NEUTRAL;
    colors.push([
      Math.round(a[0] + (c[0] - a[0]) * k),
      Math.round(a[1] + (c[1] - a[1]) * k),
      Math.round(a[2] + (c[2] - a[2]) * k),
    ]);
  }
  colors.push(readToken("--fg"));
  // 잉크 버킷은 베이크 때 실제 글자 색으로 덮인다. 그때까지는 `--fg` 로 둔다.
  for (let i = 0; i < INK_SLOTS; i++) colors.push(readToken("--fg"));

  const core: string[] = new Array(BINS);
  const halo: string[] = new Array(BINS);
  for (let b = 0; b < BUCKETS; b++) {
    const c = colors[b] ?? NEUTRAL;
    const head = `rgba(${c[0]},${c[1]},${c[2]},`;
    for (let k = 0; k < ALPHA_STEPS; k++) {
      const a = (k + 0.5) / ALPHA_STEPS;
      core[b * ALPHA_STEPS + k] = `${head}${a.toFixed(3)})`;
      halo[b * ALPHA_STEPS + k] = `${head}${(a * 0.16).toFixed(3)})`;
    }
  }

  const bg = readToken("--bg");
  return { core, halo, bg: `rgb(${bg[0]},${bg[1]},${bg[2]})` };
}

/**
 * 잉크 버킷(12‥13)의 색을 **글자 요소가 실제로 쓰는 색**으로 채운다.
 * 토큰 이름을 훅에 적어 두면 디자인이 `.expand` 를 다른 색으로 바꾼 날
 * 배경의 글자 점만 옛 색으로 남는다 — computed color 를 그대로 받는다.
 */
function setGlyphColors(pal: Palette, colors: RGB[]): void {
  for (let i = 0; i < INK_SLOTS; i++) {
    const c = colors[i] ?? colors[0] ?? NEUTRAL;
    const head = `rgba(${c[0]},${c[1]},${c[2]},`;
    const b = INK_B0 + i;
    for (let k = 0; k < ALPHA_STEPS; k++) {
      const a = (k + 0.5) / ALPHA_STEPS;
      pal.core[b * ALPHA_STEPS + k] = `${head}${a.toFixed(3)})`;
      pal.halo[b * ALPHA_STEPS + k] = `${head}0)`;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 씬 — 절차적 생성
 * ------------------------------------------------------------------ */

/** 씬 길이(m). 이 길이에서 wrap 된다. 포그 소멸 거리와 맞춰 낭비를 없앤다. */
const SCENE_LEN = 120;
const FAR = 116;
const INV_FAR = 1 / FAR;

/* --- 인도 기하 -------------------------------------------------------
   연석 단차와 보도블록 줄눈이 인도를 인도로 읽히게 한다. 보행자의 발높이는
   반드시 `WALK_Y` 여야 한다 — 여기가 어긋나면 사람이 공중에 뜨거나 파묻힌다. */
/** 연석선의 횡방향 위치(m). 길가장자리 실선(±7.9) 바로 바깥. */
const WALK_CURB = 8.2;
/** 인도 폭(m). */
const WALK_W = 4.2;
/** 인도 노면 높이(m) = 연석 단차. */
const WALK_Y = 0.17;

/** 센서(카메라) 높이(m) — 블랙박스: 앞유리 안쪽, 운전자 눈높이 부근. */
const CAM_Y_DASH = 1.3;
/**
 * 연구 구간의 카메라 높이는 **막마다 다르다** — `ACT_CAM` 표가 정한다.
 * 여기 있던 단일 상수(8.5m)는 네 주제를 전부 같은 구도로 보여줘서
 * "주석만 바뀐 같은 화면"이 되는 원인이었다.
 * 12m 까지 올리면 같은 점 예산으로 훨씬 넓은 지면을 덮어 노면이 성겨진다 —
 * 그래서 02막(위에서 파동을 내려다보는 장면)에만 그 높이를 쓴다.
 */

/** 소실점의 화면 세로 위치(비율). 대시캠은 수평에 가깝다. */
const HORIZON_DASH = 0.47;

/**
 * 차량이 달리는 차로의 횡방향 위치(m). 도로 중심선(0)에 두면 중앙분리대를
 * 뚫고 지나가고 좌우가 대칭이라 "두 배 넓은 도로"가 보이지 않는다.
 * 왼쪽 차로 중앙에 앉히면 중앙분리대와 반대편 차로가 전부 오른쪽에 펼쳐지고,
 * 화면 왼쪽(타이포가 앉는 자리)은 노변만 남아 조용해진다.
 */
const LANE_X = -2.8;

const TWO_PI = Math.PI * 2;
const W1 = TWO_PI / SCENE_LEN;

/**
 * 도로의 평면 선형. SCENE_LEN 을 정확히 한 주기로 갖는 사인의 합이라
 * wrap 지점에서 도로가 끊기지 않는다. 곡률 ≈ 0.008/m (R ≈ 125m) — 도심 완곡선.
 */
const curveX = (z: number): number =>
  5 * Math.sin(z * W1) + 1.3 * Math.sin(z * W1 * 2 + 1.1);
/** 평면 선형의 기울기 — 차량 요(yaw)를 도로에 맞추는 데 쓴다. */
const curveDx = (z: number): number =>
  5 * W1 * Math.cos(z * W1) + 2.6 * W1 * Math.cos(z * W1 * 2 + 1.1);
/** 종단 선형(완만한 오르내림). 역시 SCENE_LEN 주기. */
const curveY = (z: number): number => 0.55 * Math.sin(z * W1 + 2.2);

/** 결정적 난수 — 새로고침·스크린샷마다 같은 씬이 나온다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 씬 좌표계(0…SCENE_LEN)로 되접는다. 카메라가 되접히므로 연출 좌표도 같이 접어야 한다. */
const wrapScene = (z: number): number =>
  z - Math.floor(z / SCENE_LEN) * SCENE_LEN;

/** 부드러운 계단 — 카메라 상승·차량 등장에 쓴다. 선형으로 올리면 멀미난다. */
const smooth = (t: number): number =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

interface Scene {
  n: number;
  /** 곡선 오프셋이 이미 더해진 월드 x */
  xw: Float32Array;
  yw: Float32Array;
  zw: Float32Array;
  bucket: Uint8Array;
  /** 구조물 종류별 기준 밝기 */
  baseA: Float32Array;
  /** 점이 대표하는 실제 크기(m) — 화면 점 크기 = sw·f/depth */
  sw: Float32Array;
  /** 빔이 마지막으로 훑고 지나간 시각(초). -1 = 아직 스캔 전 */
  lastHit: Float32Array;
  /** 한 번이라도 스캔됐는가 — 로드 직후 리빌 게이트 */
  seen: Uint8Array;
}

const toBucket = (intensity: number): number => {
  const b = Math.round(intensity * (RAMP_BUCKETS - 1));
  return b < 0 ? 0 : b > RAMP_BUCKETS - 1 ? RAMP_BUCKETS - 1 : b;
};

/** 차선 도색의 횡방향 위치·강도·파선 여부. 정적 층과 근거리 층이 같은 표를 쓴다. */
const LANE_LINES: { x: number; i: number; dashed: boolean }[] = [
  { x: -1.1, i: 0.95, dashed: false }, // 중앙분리대 바깥 실선
  { x: 1.1, i: 0.95, dashed: false },
  { x: -4.5, i: 0.84, dashed: true }, // 차로 구분 파선
  { x: 4.5, i: 0.84, dashed: true },
  { x: -7.9, i: 0.89, dashed: false }, // 길가장자리 실선
  { x: 7.9, i: 0.89, dashed: false },
];
/** 파선 주기(m)와 도색 길이(m). */
const DASH_PERIOD = 8;
const DASH_ON = 3;

/**
 * 정밀도로지도의 층 구조를 절차화한다. 참조는 실제 MMS 스캔 데이터의 단면이다.
 *
 *   ① 노면 산란 — 낮은 강도(남색~시안). 바닥 층.
 *   ② 차선 도색 — 고강도(노랑~빨강) 실선/파선. 도로의 뼈대다.
 *   ③ 연석 · 중앙분리대 — 단차.
 *   ④ 중앙분리대 방호울타리 — 소실점으로 수렴하는 두 줄의 레일.
 *   ⑤ 길가장자리 가드레일 — 규칙적인 지주 + 레일.
 *   ⑥ 노면표시 — 정지선 · 횡단보도 · 직진 화살표(최고강도).
 *   ⑦ 갠트리 — 머리 위를 지나가는 표지판 구조물.
 *   ⑧ 노변 수목 · ⑨ 가로등 · ⑩ 담장 — 흰색 희소 클러스터.
 *   ⑪ 원경 건물 파사드 — 지평선을 채우는 수직 격자.
 *
 * 이 층은 **원경 담당**이다. 근거리(화면 아래 절반)는 카메라 상대 좌표로 도는
 * `RelLayer` 가 채운다 — 실제 LiDAR 도 가까울수록 점밀도가 높다.
 */
function buildScene(budget: number): Scene {
  /** 데스크톱/모바일 두 단계만 쓴다 — 중간 예산은 없다. */
  const hi = budget > 5000;
  const d = budget / 9000;
  const rnd = mulberry32(0x5eed_2026);

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const bk: number[] = [];
  const ba: number[] = [];
  const sw: number[] = [];

  const put = (
    x: number,
    y: number,
    z: number,
    bucket: number,
    alpha: number,
    size: number,
  ) => {
    xs.push(x + curveX(z));
    ys.push(y + curveY(z));
    zs.push(z);
    bk.push(bucket);
    ba.push(alpha);
    sw.push(size);
  };

  /* --- ① 노면 산란 (원경) -------------------------------------------- */
  // 근거리는 RelLayer 가 맡으므로 여기서는 먼 노면만 담당한다.
  const surfaceN = hi ? 2900 : 1400;
  for (let i = 0; i < surfaceN; i++) {
    const z = rnd() * SCENE_LEN;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (1 + rnd() * 7.2);
    // 바퀴 궤적(wheel path) 근처는 반사가 조금 높다 — 실제 노면의 광택 띠.
    const lane =
      Math.abs(Math.abs(x) - 2.8) < 0.55 || Math.abs(Math.abs(x) - 6.2) < 0.55;
    let intensity = 0.08 + rnd() * 0.2 + (lane ? 0.06 : 0);
    if (rnd() < 0.05) intensity = 0.36 + rnd() * 0.18; // 보수 패치·맨홀
    put(x, rnd() * 0.012, z, toBucket(intensity), 0.5 + rnd() * 0.24, 0.046);
  }

  /* --- ①b 보도 · 노변 지반 ------------------------------------------- */
  // 차도 바깥의 지반 반사. 실제 MMS 스캔에서 가장 넓게 깔리는 층이고,
  // 화면에서는 프레임 좌우 끝을 채워 도로가 "띠"가 아니라 "면"으로 읽히게 한다.
  const vergeN = hi ? 1200 : 520;
  for (let i = 0; i < vergeN; i++) {
    const z = rnd() * SCENE_LEN;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (8.4 + rnd() * 6.6);
    // 보도블록 줄눈이 가끔 세게 튄다 — 균일한 회색 판이 아니다.
    const seam = rnd() < 0.07;
    const intensity = seam ? 0.26 + rnd() * 0.1 : 0.08 + rnd() * 0.15;
    put(
      x,
      0.17 + rnd() * 0.03,
      z,
      toBucket(intensity),
      0.42 + rnd() * 0.2,
      0.046,
    );
  }

  /* --- ② 차선 도색 -------------------------------------------------- */
  // 0.4m 간격(데스크톱). 실선은 끊김 없이, 파선은 3m 도색 / 5m 공백으로 또렷하게.
  const paintStep = hi ? 0.26 : 0.45;
  for (const ln of LANE_LINES) {
    for (let z = 0; z < SCENE_LEN; z += paintStep) {
      if (ln.dashed && z % DASH_PERIOD > DASH_ON) continue;
      const x = ln.x + (rnd() - 0.5) * 0.16;
      // 강도 산포 — 도색 마모. 균일한 띠는 CG 처럼 보인다.
      const intensity = ln.i + (rnd() - 0.5) * 0.11;
      put(x, 0.012 + rnd() * 0.008, z, toBucket(intensity), 0.9, 0.058);
    }
  }

  /* --- ③ 연석 · 중앙분리대 (단차) ------------------------------------ */
  const curbStep = hi ? 1 : 2.4;
  for (let z = 0; z < SCENE_LEN; z += curbStep) {
    // 중앙분리대 상면 + 양 측면
    put(
      (rnd() * 2 - 1) * 0.75,
      0.15 + rnd() * 0.012,
      z,
      toBucket(0.3 + rnd() * 0.12),
      0.6,
      0.05,
    );
    put(-0.75, rnd() * 0.15, z, toBucket(0.44), 0.62, 0.05);
    put(0.75, rnd() * 0.15, z, toBucket(0.44), 0.62, 0.05);
  }

  /* --- ③b 인도 — 연석 + 보도블록 ------------------------------------
     사람이 걸으려면 걸을 자리가 보여야 한다. 실제 MMS 스캔에서 인도를 인도로
     읽히게 하는 것은 두 가지다: **연석의 수직 단차**(도로와 인도를 가르는 선)와
     **보도블록 줄눈**(세로 한 줄, 가로 60cm 간격). 이 격자가 없으면 인도는
     그냥 회색 바닥이고, 그 위에 선 사람이 허공에 떠 보인다. */
  const walkStep = hi ? 0.3 : 0.7;
  for (let z = 0; z < SCENE_LEN; z += walkStep) {
    for (let s = -1; s <= 1; s += 2) {
      // 연석 수직면 — 도로 가장자리를 따라 달리는 15cm 단차
      for (let h = 0; h < (hi ? 3 : 1); h++) {
        put(
          s * WALK_CURB,
          0.02 + h * 0.06 + rnd() * 0.03,
          z,
          toBucket(0.28 + rnd() * 0.1),
          0.72,
          0.05,
        );
      }
      // 연석 상면(모서리) — 가장 또렷한 선
      put(
        s * (WALK_CURB + 0.14 + rnd() * 0.1),
        WALK_Y,
        z,
        toBucket(0.38 + rnd() * 0.08),
        0.78,
        0.055,
      );
      // 보도블록 줄눈 — 세로 한 줄
      put(
        s * (WALK_CURB + 1.9 + rnd() * 0.1),
        WALK_Y + rnd() * 0.006,
        z,
        toBucket(0.24 + rnd() * 0.08),
        0.54,
        0.05,
      );
    }
  }
  // 줄눈 — 가로 방향. 60cm 간격이라 인도가 '블록'으로 읽힌다.
  for (let z = 0; z < SCENE_LEN; z += 0.6) {
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < (hi ? 5 : 2); i++) {
        put(
          s * (WALK_CURB + 0.2 + (i / (hi ? 4 : 1)) * WALK_W),
          WALK_Y + rnd() * 0.006,
          z,
          toBucket(0.2 + rnd() * 0.1),
          0.46,
          0.05,
        );
      }
    }
  }

  /* --- ④ 중앙분리대 방호울타리 --------------------------------------- */
  // 소실점으로 정확히 수렴하는 두 줄의 레일. 화면 한가운데라 도로의 척추가 된다.
  const railStep = hi ? 0.78 : 1.2;
  const railY = hi ? [0.55, 0.82] : [0.74];
  for (const ry of railY) {
    for (let z = 0; z < SCENE_LEN; z += railStep) {
      for (let s = -1; s <= 1; s += 2) {
        put(
          s * 0.55,
          ry + (rnd() - 0.5) * 0.02,
          z,
          toBucket(0.52 + rnd() * 0.12),
          0.66,
          0.05,
        );
      }
    }
  }
  const barPostStep = hi ? 3 : 7;
  for (let z = 1.5; z < SCENE_LEN; z += barPostStep) {
    for (let j = 0; j < 3; j++) {
      put((rnd() - 0.5) * 0.24, 0.18 + j * 0.24, z, toBucket(0.4), 0.6, 0.05);
    }
  }

  /* --- ⑤ 길가장자리 가드레일 (지주 + 레일) ---------------------------- */
  const shoulderRailStep = hi ? 0.95 : 2.2;
  for (let z = 0; z < SCENE_LEN; z += shoulderRailStep) {
    for (let s = -1; s <= 1; s += 2) {
      put(
        s * 8.62,
        0.62 + (rnd() - 0.5) * 0.03,
        z,
        toBucket(0.48 + rnd() * 0.1),
        0.6,
        0.05,
      );
    }
  }
  const postStep = hi ? 4 : 9;
  const postN = hi ? 4 : 3;
  for (let z = 2; z < SCENE_LEN; z += postStep) {
    for (let s = -1; s <= 1; s += 2) {
      for (let j = 0; j < postN; j++) {
        put(
          s * 8.62,
          0.06 + (j / postN) * 0.56,
          z,
          toBucket(0.42),
          0.62,
          0.048,
        );
      }
    }
  }

  /* --- ⑥ 노면표시: 정지선 · 횡단보도 · 화살표 ------------------------- */
  // 재귀반사 도색이라 intensity 가 최상단(노랑→빨강)에 걸린다. 교차로 1곳.
  const JZ = 44;
  const stopDx = hi ? 0.15 : 0.42;
  for (let s = -1; s <= 1; s += 2) {
    for (let x = 1.25; x < 7.85; x += stopDx) {
      for (let k = 0; k < 2; k++) {
        put(
          s * x,
          0.014,
          JZ + k * 0.24,
          toBucket(0.96 + rnd() * 0.04),
          0.86,
          0.06,
        );
      }
    }
  }
  // 횡단보도 — 진행방향과 나란한 띠가 가로로 반복된다
  const zebraDz = hi ? 0.6 : 1.4;
  const zebraDx = hi ? 0.16 : 0.3;
  for (let b = 0; b < 12; b++) {
    const bx = -7.55 + b * 1.36;
    if (Math.abs(bx) < 1.05) continue; // 중앙분리대 구간은 비운다
    for (let ox = 0; ox < 0.46; ox += zebraDx) {
      for (let z = 0; z < 5; z += zebraDz) {
        put(
          bx + ox,
          0.014,
          JZ + 1.6 + z,
          toBucket(0.9 + rnd() * 0.09),
          0.84,
          0.058,
        );
      }
    }
  }
  // 직진 화살표 — 주행 차로(왼쪽 차도) 두 곳, 정지선 앞
  if (hi) {
    for (const lane of [-2.8, -6.2]) {
      const az = JZ - 9.5;
      for (let z = 0; z < 2.4; z += 0.3) {
        for (let ox = -0.1; ox <= 0.11; ox += 0.1) {
          put(lane + ox, 0.014, az + z, toBucket(0.93), 0.84, 0.058);
        }
      }
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const halfW = 0.55 * (1 - t);
        for (let ox = -halfW; ox <= halfW + 1e-6; ox += 0.16) {
          put(
            lane + ox,
            0.014,
            az + 2.4 + t * 0.85,
            toBucket(0.93),
            0.84,
            0.058,
          );
        }
      }
    }
  }

  /* --- ⑦ 갠트리 · 표지판 (머리 위를 지나간다) ------------------------- */
  const WHITE = FG_BUCKET;
  const gantryZ = hi ? [18, 58, 98] : [26, 86];
  let gFlip = 0;
  for (const gz of gantryZ) {
    // 지주
    const colStep = hi ? 0.28 : 0.6;
    for (let s = -1; s <= 1; s += 2) {
      for (let y = 0; y < 6.1; y += colStep) {
        put(s * 9.6, y, gz, toBucket(0.5 + rnd() * 0.08), 0.6, 0.05);
      }
    }
    // 상부 트러스 — 상현·하현 두 줄
    const chordStep = hi ? 0.42 : 1.1;
    for (const cy2 of [6.1, 6.55]) {
      for (let x = -9.6; x <= 9.6; x += chordStep) {
        put(x, cy2, gz, toBucket(0.46 + rnd() * 0.08), 0.58, 0.05);
      }
    }
    // 사재(zigzag)
    if (hi) {
      for (let k = 0; k < 24; k++) {
        const t = k / 23;
        put(
          -9.6 + t * 19.2,
          k % 2 ? 6.1 : 6.55,
          gz + 0.1,
          toBucket(0.4),
          0.5,
          0.048,
        );
      }
    }
    // 표지판 — 재귀반사 시트라 최고강도. 좌우 차도에 번갈아 건다.
    const sgn = gFlip++ % 2 === 0 ? -1 : 1;
    const panelStep = hi ? 0.34 : 0.7;
    for (let x = 1.2; x < 5.4; x += panelStep) {
      for (let y = 4.7; y < 5.95; y += panelStep) {
        // 테두리(재귀반사 시트)가 판면보다 세게 돌아온다. 완벽한 격자는 CG 로 보인다.
        const edge =
          x < 1.2 + panelStep || y < 4.7 + panelStep || y > 5.95 - panelStep;
        const jz = (rnd() - 0.5) * 0.05;
        put(
          sgn * x,
          y + jz,
          gz + 0.05 + jz,
          toBucket(edge ? 0.88 : 0.66),
          0.78,
          0.056,
        );
      }
    }
  }

  /* --- ⑧ 노변 수목 ---------------------------------------------------- */
  const crownN = Math.max(6, Math.round(26 * d));
  let flip = 0;
  for (let z = 3; z < SCENE_LEN; z += 8.6) {
    const side = flip++ % 2 === 0 ? -1 : 1;
    const tx = side * (10.4 + rnd() * 3);
    const tz = z + rnd() * 3;
    const cyTree = 3.2 + rnd() * 0.9;
    for (let j = 0; j < crownN; j++) {
      // 구형 분포 근사 — 캔버스에는 사각 점으로 찍힌다(arc 금지)
      const u = rnd() * 2 - 1;
      const th = rnd() * TWO_PI;
      const r = 1.7 * Math.cbrt(rnd());
      const sq = Math.sqrt(1 - u * u);
      put(
        tx + r * sq * Math.cos(th),
        cyTree + r * u * 0.95,
        (tz + r * sq * Math.sin(th) + SCENE_LEN) % SCENE_LEN,
        WHITE,
        0.34 + rnd() * 0.24,
        0.05,
      );
    }
    const trunkN = Math.max(2, Math.round(5 * d));
    for (let j = 0; j < trunkN; j++) {
      put(tx + (rnd() - 0.5) * 0.2, rnd() * 1.9, tz, WHITE, 0.4, 0.045);
    }
  }

  /* --- ⑨ 가로등 열 — 규칙적인 리듬 ------------------------------------ */
  const poleN = hi ? 18 : 13;
  const armN = hi ? 8 : 3;
  flip = 0;
  for (let z = 6; z < SCENE_LEN; z += 22) {
    const side = flip++ % 2 === 0 ? 1 : -1;
    const px = side * 9.15;
    for (let j = 0; j < poleN; j++) {
      put(px, (j / poleN) * 7.5, z, WHITE, 0.5, 0.045);
    }
    for (let j = 0; j < armN; j++) {
      put(
        px - side * (j / armN) * 2.2,
        7.5 - (j / armN) * 0.5,
        z,
        WHITE,
        0.5,
        0.045,
      );
    }
  }

  /* --- ⑩ 담장 · 관목 — 원경 실루엣 ------------------------------------ */
  const wallStep = hi ? 1.2 : 2.6;
  for (let z = 0; z < SCENE_LEN; z += wallStep) {
    for (let s = -1; s <= 1; s += 2) {
      put(
        s * (14.6 + rnd() * 1.3),
        rnd() * 2.2,
        z,
        WHITE,
        0.22 + rnd() * 0.12,
        0.045,
      );
    }
  }

  /* --- ⑪ 원경 건물 파사드 — 지평선을 채우는 수직 격자 ------------------ */
  const facades = hi ? 5 : 3;
  const facadeDz = hi ? 1.3 : 2.8;
  const facadeDy = hi ? 1.4 : 3;
  for (let b = 0; b < facades; b++) {
    const side = b % 2 === 0 ? -1 : 1;
    const fx = side * (19 + rnd() * 6);
    const z0 = (b * SCENE_LEN) / facades + rnd() * 6;
    const depth = 9 + rnd() * 7;
    const top = 8 + rnd() * 10;
    for (let z = 0; z < depth; z += facadeDz) {
      for (let y = 1.2; y < top; y += facadeDy) {
        // 층마다 밝기가 조금씩 다르다 — 창이 켜진 정도
        const a =
          0.14 +
          ((b * 7 + Math.round(y)) % 3 === 0 ? 0.16 : 0.04) +
          rnd() * 0.08;
        put(fx, y, (z0 + z) % SCENE_LEN, WHITE, a, 0.045);
      }
    }
  }

  const n = xs.length;
  return {
    n,
    xw: Float32Array.from(xs),
    yw: Float32Array.from(ys),
    zw: Float32Array.from(zs),
    bucket: Uint8Array.from(bk),
    baseA: Float32Array.from(ba),
    sw: Float32Array.from(sw),
    lastHit: new Float32Array(n).fill(-1),
    seen: new Uint8Array(n),
  };
}

/* ------------------------------------------------------------------ *
 * 근거리 층 — 카메라 상대 좌표로 도는 노면
 *
 * 실제 LiDAR 는 각해상도가 일정하므로 **가까울수록 점밀도가 높다.** 정적 씬은
 * 월드 좌표에 균일하게 뿌려져 있어서 화면 아래 절반(= 가장 가까운 몇 미터가
 * 화면의 큰 면적을 차지하는 구간)이 성겨 보인다 — 도로가 면이 아니라 흩뿌린
 * 색종이로 읽히는 원인이 그것이다.
 *
 * 그래서 근거리는 **깊이 창(window)** 안에서만 사는 층으로 따로 만든다.
 * 점은 월드에 고정돼 있고(주행하면 dz 가 그만큼 줄어든다) 창을 벗어나면
 * 반대쪽 끝으로 되접힌다. 창의 위치·길이는 카메라 높이를 따라 늘어난다 —
 * 12m 로 올라가면 발밑이 아니라 20~60m 가 화면을 채우기 때문이다.
 * ------------------------------------------------------------------ */

interface RelLayer {
  n: number;
  /** 현재 깊이(m). 매 프레임 주행거리만큼 줄어든다. */
  dz: Float32Array;
  /** 도로 중심선 기준 횡방향 위치(m) */
  x: Float32Array;
  /** 노면 위 높이(m) */
  y: Float32Array;
  bucket: Uint8Array;
  baseA: Float32Array;
  sw: Float32Array;
  /** 1 = 파선 도색 — 되접힐 때 도색 구간으로 스냅한다(깜빡이지 않게). */
  dash: Uint8Array;
  /** 이 점이 사는 깊이 대역(REL_BANDS 인덱스) */
  band: Uint8Array;
}

/**
 * 근거리 층의 **깊이 대역**. 단위는 화면 아래끝의 깊이(dzBottom) 배수다 —
 * 카메라가 12m 로 오르면 발밑이 아니라 15~110m 가 화면을 채우므로, 고정 미터로
 * 잡으면 두 시점 중 하나는 반드시 빈다.
 *
 * 대역을 셋으로 나눈 이유: 창 하나에 균일하게 뿌리면 창이 끝나는 깊이에서
 * **밀도가 한 번에 떨어져 가로줄이 생긴다**(실측으로 확인). 화면에서 각 대역이
 * 차지하는 세로 비율(1/a − 1/b)에 맞춰 점을 나눠 주면 화면 밀도가 고르게 된다.
 *
 *   share 는 화면 세로 점유율 ≈ 0.71 / 0.21 / 0.06 을 반영해 잡았다.
 */
const REL_BANDS = [
  { lo: 0.85, hi: 3.4, share: 0.66 },
  { lo: 3.4, hi: 12, share: 0.24 },
  { lo: 12, hi: 46, share: 0.1 },
] as const;
/** 대역 경계(m) — dzBottom 배수를 실제 깊이로 바꾸고 가시거리 안쪽으로 막는다. */
const relLo = (b: number, dzBottom: number): number =>
  Math.min(REL_BANDS[b]!.lo * dzBottom, FAR * 0.9);
const relHi = (b: number, dzBottom: number): number =>
  Math.min(REL_BANDS[b]!.hi * dzBottom, FAR * 0.94);

function buildRelLayer(budget: number): RelLayer {
  const hi = budget > 5000;
  const rnd = mulberry32(0x2ea5_0011);
  const scatterN = hi ? 9000 : 4200;
  const paintPer = hi ? 320 : 170;
  const walkPer = hi ? 1700 : 780;
  const n = scatterN + paintPer * LANE_LINES.length + walkPer;

  const dz = new Float32Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const bucket = new Uint8Array(n);
  const baseA = new Float32Array(n);
  const sw = new Float32Array(n);
  const dash = new Uint8Array(n);
  const band = new Uint8Array(n);

  // 대역은 대시캠 기준(화면 아래끝 ≈ 2m)으로 초기화한다.
  // 카메라가 올라가면 매 프레임 선형 재사상된다.
  /** 누적 share 로 대역을 뽑는다. */
  const pickBand = (u: number): number => {
    let acc = 0;
    for (let b = 0; b < REL_BANDS.length; b++) {
      acc += REL_BANDS[b]!.share;
      if (u < acc) return b;
    }
    return REL_BANDS.length - 1;
  };

  let k = 0;
  /* 노면 산란 — 차도 + 노변을 가로질러 고르게.
     깊이를 격자(스캔선)에 스냅해 보았지만, 그렇게 하면 화면에 가로 줄무늬가
     생겨 "파란 줄"로 읽힌다(실측 확인). 무작위 분포를 유지한다. */
  for (let i = 0; i < scatterN; i++, k++) {
    const b = pickBand(rnd());
    band[k] = b;
    dz[k] = relLo(b, 2) + rnd() * (relHi(b, 2) - relLo(b, 2));
    const side = rnd() < 0.5 ? -1 : 1;
    // 차도 안쪽(|x|<8.2)에 2/3, 노변에 1/3 — 프레임 좌우 끝까지 지면이 닿아야 한다.
    const road = rnd() < 0.68;
    x[k] = side * (road ? 0.9 + rnd() * 7.3 : 8.4 + rnd() * 7.5);
    y[k] = road ? rnd() * 0.012 : 0.17 + rnd() * 0.03;
    const lane =
      road &&
      (Math.abs(Math.abs(x[k]) - 2.8) < 0.55 ||
        Math.abs(Math.abs(x[k]) - 6.2) < 0.55);
    let intensity = 0.08 + rnd() * 0.2 + (lane ? 0.06 : 0);
    if (rnd() < 0.05) intensity = 0.36 + rnd() * 0.18;
    bucket[k] = toBucket(intensity);
    baseA[k] = 0.46 + rnd() * 0.24;
    sw[k] = 0.05;
  }

  /* 인도 — 근거리에서 연석 단차와 줄눈이 끊기면 사람이 딛고 선 면이 사라진다.
     가까운 두 대역에만 넣는다(멀리는 정적 층이 맡는다). */
  for (let j = 0; j < walkPer; j++, k++) {
    const b = j * 3 < walkPer * 2 ? 0 : 1;
    band[k] = b;
    const lo = relLo(b, 2);
    dz[k] = lo + ((j + rnd() * 0.5) / walkPer) * (relHi(b, 2) - lo);
    const side = rnd() < 0.5 ? -1 : 1;
    const kind = rnd();
    if (kind < 0.34) {
      // 연석 수직면
      x[k] = side * WALK_CURB;
      y[k] = 0.02 + rnd() * 0.14;
      bucket[k] = toBucket(0.28 + rnd() * 0.1);
      baseA[k] = 0.72;
    } else if (kind < 0.5) {
      // 연석 상면 모서리
      x[k] = side * (WALK_CURB + 0.1 + rnd() * 0.12);
      y[k] = WALK_Y;
      bucket[k] = toBucket(0.38 + rnd() * 0.08);
      baseA[k] = 0.78;
    } else {
      // 보도블록 면 + 줄눈
      const seam = rnd() < 0.22;
      x[k] = side * (WALK_CURB + 0.2 + rnd() * WALK_W);
      y[k] = WALK_Y + rnd() * 0.008;
      bucket[k] = toBucket(seam ? 0.24 + rnd() * 0.08 : 0.09 + rnd() * 0.14);
      baseA[k] = seam ? 0.54 : 0.44;
    }
    sw[k] = 0.05;
  }

  /* 차선 도색 — 근거리에서는 정적 층의 0.4m 간격이 점선으로 끊겨 보인다.
     도색은 가까운 두 대역에만 넣는다(멀리는 정적 층이 이미 촘촘하다). */
  for (const ln of LANE_LINES) {
    for (let j = 0; j < paintPer; j++, k++) {
      const b = j * 3 < paintPer * 2 ? 0 : 1;
      band[k] = b;
      const lo = relLo(b, 2);
      dz[k] = lo + ((j + rnd() * 0.5) / paintPer) * (relHi(b, 2) - lo);
      x[k] = ln.x + (rnd() - 0.5) * 0.14;
      y[k] = 0.012 + rnd() * 0.008;
      bucket[k] = toBucket(ln.i + (rnd() - 0.5) * 0.11);
      baseA[k] = 0.9;
      sw[k] = 0.06;
      dash[k] = ln.dashed ? 1 : 0;
    }
  }

  return { n, dz, x, y, bucket, baseA, sw, dash, band };
}

/* ------------------------------------------------------------------ *
 * 차량 점군 — 도로 위의 다른 차들
 *
 * 물리는 `src/lib/idm.ts` 가 소유한다. 여기서 만드는 것은 "LiDAR 가 차 한 대에서
 * 돌려받는 점" 뿐이다.
 *
 * 세 가지를 실제 스캔에 맞춘다:
 *
 *   ① **면을 표본한다.** 윤곽선을 긋는 게 아니라 차체 표면을 격자로 훑는다.
 *      실제 LiDAR 에 차는 "선"이 아니라 점이 촘촘히 맺힌 **껍데기**로 찍힌다.
 *   ② **재질별 반사강도.** 후미등·번호판은 재귀반사라 최고강도로 튀고, 유리는
 *      빔이 통과해 **거의 아무것도 돌려주지 않는다**(성기게 찍는 이유). 타이어는
 *      검은 고무라 가장 어둡다. 이 대비가 차를 차로 읽히게 한다.
 *   ③ **보이는 면만.** 뒤에서 보는 차와 마주 오는 차는 다른 면을 돌려준다.
 *      후면 뷰와 전면 뷰를 따로 만들어 둔다.
 *
 * 좌표계는 **후면 하단 중앙이 원점**, z 가 전방(+)이다. 예전 템플릿은 z 가 음수
 * 방향이라 지붕이 후미등보다 **카메라 쪽에** 그려졌다 — 차체가 뒤집혀 있었다.
 * ------------------------------------------------------------------ */

/** 차체 치수(m). LiDAR 가 구분할 수 있는 만큼만 나눈다 — 세단·SUV·승합. */
interface CarShape {
  len: number;
  wid: number;
  /** 지붕 높이 */
  roof: number;
  /** 벨트라인(창문 아랫선) 높이 */
  belt: number;
  /** 지붕 면의 z 범위 [뒤, 앞] */
  roofZ: [number, number];
  /** 보닛 윗면 높이 */
  nose: number;
  /** 범퍼 아랫단 높이 */
  sill: number;
}

const SHAPES: CarShape[] = [
  {
    len: 4.62,
    wid: 1.82,
    roof: 1.46,
    belt: 1.06,
    roofZ: [1.3, 3.05],
    nose: 1.0,
    sill: 0.36,
  },
  {
    len: 4.74,
    wid: 1.9,
    roof: 1.74,
    belt: 1.24,
    roofZ: [0.95, 3.5],
    nose: 1.2,
    sill: 0.42,
  },
  {
    len: 5.34,
    wid: 1.96,
    roof: 2.12,
    belt: 1.22,
    roofZ: [0.5, 4.7],
    nose: 1.62,
    sill: 0.44,
  },
];

/**
 * 차체 표면 표본 간격(m).
 *
 * 0.13m 였을 때 차는 25m 에서 4px 간격이라 형태는 읽히지만 면이 성겼다.
 * 0.095m 까지 좁혀 봤더니 이번에는 가까운 차가 **파란 색면 한 장**이 됐다 —
 * 점군의 뜻은 면을 채우는 데 있는 게 아니라 면이 **점으로 이루어져 있음**을
 * 보이는 데 있다. 0.11m 가 그 사이다: 뒷면·유리·바퀴가 구분되면서 점은 여전히
 * 세어진다. 화면에 동시에 서는 차가 17대뿐이라 이 배수는 예산에서 감당된다.
 */
const SURF = 0.11;

interface CarTemplate {
  n: number;
  /** 로컬 좌표 — x 우측, y 높이, **z 전방(후면 0 → 앞쪽 +)** */
  lx: Float32Array;
  ly: Float32Array;
  lz: Float32Array;
  bucket: Uint8Array;
  baseA: Float32Array;
  /** 1 = 제동등. 감속 중이면 최고강도로 점등한다. */
  lamp: Uint8Array;
  /** 차체 **뒤끝 0 → 앞끝 1**. 글자 점이 쌓이는 순서다(스캐너가 훑듯이). */
  ordz: Float32Array;
  /** 점이 대표하는 실제 크기(m) */
  sw: Float32Array;
}

/** 차량 한 종류의 앞·뒤 두 뷰. */
interface CarViews {
  rear: CarTemplate;
  front: CarTemplate;
  shape: CarShape;
}

/**
 * 한 대를 만든다.
 *
 * 점 순서가 곧 LOD 순서다. 앞쪽에 **거리와 무관하게 차를 차로 읽히게 하는 것**
 * (등화류·번호판·차체 윤곽)을 두고, 나머지 표면 표본은 결정적으로 섞는다.
 * 그래야 멀어서 앞쪽 40점만 쓰는 차도 **고르게 성긴 스캔**으로 보인다 —
 * 순서대로 자르면 지붕만 있고 옆면이 없는 반쪽 차가 된다.
 */
function buildCar(shape: CarShape, view: "rear" | "front"): CarTemplate {
  const { len, wid, roof, belt, roofZ, nose, sill } = shape;
  const hw = wid / 2;
  const rnd = mulberry32(view === "rear" ? 0x0a17 : 0x0b23);

  // 핵심(항상 먼저) / 표면(섞어서 뒤에)
  const key: number[][] = [];
  const body: number[][] = [];
  const put = (
    dst: number[][],
    x: number,
    y: number,
    z: number,
    intensity: number,
    a: number,
    size = 0.1,
    lamp = 0,
  ) => dst.push([x, y, z, toBucket(intensity), a, size, lamp]);

  /** 사각 면을 격자로 훑는다. 격자에 미세한 흔들림을 준다 — 자로 잰 격자는 CG 다. */
  const plane = (
    dst: number[][],
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    f: (u: number, v: number) => [number, number, number],
    i0: number,
    i1: number,
    a: number,
    step = SURF,
    drop = 0,
  ) => {
    const nu = Math.max(1, Math.round(Math.abs(u1 - u0) / step));
    const nv = Math.max(1, Math.round(Math.abs(v1 - v0) / step));
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if (drop > 0 && rnd() < drop) continue;
        const u = u0 + ((u1 - u0) * i) / nu + (rnd() - 0.5) * step * 0.45;
        const v = v0 + ((v1 - v0) * j) / nv + (rnd() - 0.5) * step * 0.45;
        const [x, y, z] = f(u, v);
        put(dst, x, y, z, i0 + (i1 - i0) * rnd(), a, step * 0.78);
      }
    }
  };

  if (view === "rear") {
    /* ── 후미등 — 재귀반사. 100m 밖에서도 이것부터 돌아온다. ── */
    for (const s of [-1, 1]) {
      plane(
        key,
        0,
        0.34,
        0,
        0.17,
        (u, v) => [s * (hw - 0.08 - u), belt - 0.18 + v, 0.02],
        0.93,
        1,
        0.96,
        0.075,
      );
    }
    /* ── 번호판 — 재귀반사 시트. 차에서 가장 밝은 한 점. ── */
    plane(
      key,
      -0.17,
      0.17,
      0,
      0.15,
      (u, v) => [u, sill + 0.16 + v, 0.03],
      0.97,
      1,
      0.96,
      0.07,
    );
    /* ── 후면 윤곽 — 차폭과 차고를 세우는 뼈대.
          **도장면과 같은 낮은 반사강도로 둔다.** 실제 차체 도장은 빔을 거의 되돌리지
          않는다 — 여기를 밝게 잡으면 차가 스캔된 물체가 아니라 형광 테두리를 두른
          HUD 박스처럼 보인다(실제로 그랬다). 밝은 것은 재귀반사체뿐이다. ── */
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      put(key, -hw + t * wid, belt, 0.01, 0.26, 0.92, 0.1);
      put(key, -hw + t * wid, sill, 0.01, 0.24, 0.92, 0.1);
    }
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      put(key, -hw, sill + t * (belt - sill), 0.01, 0.2, 0.86, 0.1);
      put(key, hw, sill + t * (belt - sill), 0.01, 0.2, 0.86, 0.1);
    }

    /* ── 테일게이트 면 ── */
    plane(
      body,
      -hw + 0.04,
      hw - 0.04,
      sill,
      belt,
      (u, v) => [u, v, 0],
      0.16,
      0.3,
      0.78,
    );
    /* ── 후면 유리 — 빔이 통과한다. 점이 거의 돌아오지 않는 것이 유리의 서명이다. ── */
    plane(
      body,
      -hw + 0.14,
      hw - 0.14,
      belt + 0.04,
      roof - 0.05,
      (u, v) => [u, v, 0.02 + (v - belt) * 0.22],
      0.03,
      0.1,
      0.5,
      SURF,
      0.72,
    );
    /* ── 범퍼 아래 · 머플러 그늘 ── */
    plane(
      body,
      -hw + 0.1,
      hw - 0.1,
      0.16,
      sill,
      (u, v) => [u, v, -0.04],
      0.08,
      0.18,
      0.6,
    );
  } else {
    /* ── 헤드램프 — 렌즈라 재귀반사만큼은 아니지만 밝다 ── */
    for (const s of [-1, 1]) {
      plane(
        key,
        0,
        0.36,
        0,
        0.16,
        (u, v) => [s * (hw - 0.07 - u), nose - 0.3 + v, len - 0.02],
        0.58,
        0.78,
        0.94,
        0.075,
      );
    }
    /* ── 앞 번호판 ── */
    plane(
      key,
      -0.17,
      0.17,
      0,
      0.15,
      (u, v) => [u, sill + 0.2 + v, len - 0.03],
      0.97,
      1,
      0.96,
      0.07,
    );
    /* ── 전면 윤곽 — 후면과 같은 이유로 낮게 ── */
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      put(key, -hw + t * wid, nose, len - 0.01, 0.26, 0.92, 0.1);
      put(key, -hw + t * wid, sill, len - 0.01, 0.24, 0.92, 0.1);
    }
    /* ── 라디에이터 그릴 — 격자라 반사가 산란한다 ── */
    plane(
      body,
      -hw + 0.06,
      hw - 0.06,
      sill,
      nose - 0.04,
      (u, v) => [u, v, len],
      0.12,
      0.34,
      0.8,
    );
    /* ── 앞유리 — 후면 유리와 같은 이유로 성기다 ── */
    plane(
      body,
      -hw + 0.13,
      hw - 0.13,
      nose + 0.03,
      roof - 0.04,
      (u, v) => [u, v, roofZ[1] + (roof - v) * 0.9],
      0.03,
      0.1,
      0.5,
      SURF,
      0.72,
    );
    /* ── 보닛 윗면 ── */
    plane(
      body,
      -hw + 0.07,
      hw - 0.07,
      roofZ[1] + 0.1,
      len - 0.06,
      (u, v) => [u, nose, v],
      0.1,
      0.22,
      0.66,
    );
  }

  /* ── 지붕 — 위에서 내려다보는 연구 구간에서 차의 몸통을 만든다 ── */
  plane(
    body,
    -hw + 0.06,
    hw - 0.06,
    roofZ[0],
    roofZ[1],
    // 지붕은 평면이 아니라 가운데가 살짝 볼록하다
    (u, v) => [u, roof - 0.035 * (u / hw) * (u / hw) * 4, v],
    0.12,
    0.26,
    0.72,
  );

  /* ── 측면 — 벨트라인 위(유리)와 아래(도장 패널)를 나눈다 ── */
  for (const s of [-1, 1]) {
    // 측면 유리: 성기다
    plane(
      body,
      roofZ[0] + 0.1,
      roofZ[1] - 0.1,
      belt + 0.05,
      roof - 0.06,
      (u, v) => [s * hw * 0.97, v, u],
      0.03,
      0.1,
      0.5,
      SURF,
      0.7,
    );
    // 도장 패널: 차체 옆면. 곡선 구간에서 차 길이가 드러난다.
    plane(
      body,
      0.16,
      len - 0.16,
      sill + 0.06,
      belt - 0.03,
      (u, v) => [s * hw, v, u],
      0.1,
      0.24,
      0.6,
    );
  }

  /* ── 바퀴 — 검은 고무라 가장 어둡다. 그래도 **접지점**은 찍어야
        차가 노면 위에 얹혀 보인다(공중에 뜬 차가 가장 가짜 같다). ── */
  for (const s of [-1, 1]) {
    for (const wz of [0.98, len - 0.92]) {
      // 휠하우스 아치
      for (let i = 0; i <= 7; i++) {
        const th = (Math.PI * i) / 7;
        put(
          body,
          s * (hw - 0.02),
          0.33 + 0.33 * Math.sin(th),
          wz - 0.33 * Math.cos(th),
          0.2,
          0.6,
          0.09,
        );
      }
      // 타이어 면 + 접지
      plane(
        body,
        -0.3,
        0.3,
        0.06,
        0.42,
        (u, v) => [s * (hw - 0.06), v, wz + u],
        0.02,
        0.07,
        0.72,
        0.14,
      );
      put(body, s * (hw - 0.1), 0.02, wz, 0.3, 0.7, 0.11);
    }
  }

  /* 표면 표본을 결정적으로 섞는다 — 어떤 길이로 잘라도 고르게 퍼진 스캔이 된다. */
  for (let i = body.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = body[i]!;
    body[i] = body[j]!;
    body[j] = t;
  }

  const all = key.concat(body);
  const n = all.length;
  const t: CarTemplate = {
    n,
    lx: new Float32Array(n),
    ly: new Float32Array(n),
    lz: new Float32Array(n),
    bucket: new Uint8Array(n),
    baseA: new Float32Array(n),
    lamp: new Uint8Array(n),
    ordz: new Float32Array(n),
    sw: new Float32Array(n),
  };
  let zLo = Infinity;
  let zHi = -Infinity;
  for (const p of all) {
    if (p[2]! < zLo) zLo = p[2]!;
    if (p[2]! > zHi) zHi = p[2]!;
  }
  const zK = 1 / Math.max(0.01, zHi - zLo);
  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    t.lx[i] = p[0]!;
    t.ly[i] = p[1]!;
    t.lz[i] = p[2]!;
    t.bucket[i] = p[3]!;
    t.baseA[i] = p[4]!;
    t.sw[i] = p[5]!;
    t.lamp[i] = p[6]!;
    t.ordz[i] = (p[2]! - zLo) * zK;
  }
  return t;
}

function buildCars(): CarViews[] {
  return SHAPES.map((shape) => ({
    shape,
    rear: buildCar(shape, "rear"),
    front: buildCar(shape, "front"),
  }));
}

/* ------------------------------------------------------------------ *
 * 보행자 점군 — 인도 위의 사람들
 *
 * LiDAR 에서 사람은 **세로로 선 점 덩어리**다. 몸통이 가장 조밀하고, 머리가 작은
 * 뭉치로 얹히고, 다리는 두 갈래로 갈라진다. 옷감이라 반사강도는 낮지만 가방·신발의
 * 반사띠가 가끔 튄다 — 그 불규칙함이 사람을 사람으로 읽히게 한다.
 *
 * 다리는 `limb` 로 표시해 두고 걸음 위상에 따라 앞뒤로 흔든다.
 * ------------------------------------------------------------------ */

interface PedTemplate {
  n: number;
  lx: Float32Array;
  ly: Float32Array;
  lz: Float32Array;
  bucket: Uint8Array;
  baseA: Float32Array;
  sw: Float32Array;
  /** 0 = 몸통, 1 = 왼다리, -1 = 오른다리 (걸음에 따라 z 가 흔들린다) */
  limb: Int8Array;
}

function buildPed(): PedTemplate {
  const rnd = mulberry32(0x9e11);
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const pb: number[] = [];
  const pa: number[] = [];
  const ps: number[] = [];
  const pl: number[] = [];
  const put = (
    x: number,
    y: number,
    z: number,
    i: number,
    a: number,
    s: number,
    limb = 0,
  ) => {
    px.push(x);
    py.push(y);
    pz.push(z);
    pb.push(toBucket(i));
    pa.push(a);
    ps.push(s);
    pl.push(limb);
  };

  // 머리 — 작고 조밀한 뭉치. 사람 판별의 첫 단서다.
  for (let i = 0; i < 16; i++) {
    const th = rnd() * TWO_PI;
    const ph = Math.acos(2 * rnd() - 1);
    const r = 0.095;
    put(
      r * Math.sin(ph) * Math.cos(th),
      1.55 + r * Math.cos(ph),
      r * Math.sin(ph) * Math.sin(th),
      0.13 + rnd() * 0.14,
      0.78,
      0.075,
    );
  }
  // 몸통 — 타원 기둥. 가장 조밀하다.
  for (let i = 0; i < 46; i++) {
    const t = rnd();
    const th = rnd() * TWO_PI;
    put(
      0.2 * Math.cos(th),
      0.92 + t * 0.53,
      0.13 * Math.sin(th),
      0.07 + rnd() * 0.15,
      0.76,
      0.085,
    );
  }
  // 어깨 — 몸통 위를 가로지르는 띠. 실루엣의 폭을 만든다.
  for (let i = 0; i <= 8; i++) {
    const u = -0.22 + (i / 8) * 0.44;
    put(
      u,
      1.42 + (rnd() - 0.5) * 0.03,
      (rnd() - 0.5) * 0.16,
      0.1 + rnd() * 0.12,
      0.78,
      0.09,
    );
  }
  // 팔 — 몸통 양옆으로 흐르는 두 줄
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      put(
        s * (0.22 + t * 0.03),
        1.38 - t * 0.5,
        (rnd() - 0.5) * 0.1,
        0.07 + rnd() * 0.12,
        0.64,
        0.08,
        0,
      );
    }
  }
  // 다리 — 두 갈래. 걸음에 따라 앞뒤로 벌어진다.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      put(
        s * 0.1,
        0.9 - t * 0.86,
        (rnd() - 0.5) * 0.08,
        0.06 + rnd() * 0.12,
        0.68,
        0.085,
        s,
      );
    }
    // 신발 반사띠 — 가끔 세게 튄다
    put(s * 0.1, 0.045, 0.04, 0.72 + rnd() * 0.22, 0.9, 0.08, s);
  }

  const n = px.length;
  return {
    n,
    lx: Float32Array.from(px),
    ly: Float32Array.from(py),
    lz: Float32Array.from(pz),
    bucket: Uint8Array.from(pb),
    baseA: Float32Array.from(pa),
    sw: Float32Array.from(ps),
    limb: Int8Array.from(pl),
  };
}

/* ------------------------------------------------------------------ *
 * 배역 — 도로 위에서 움직이는 것 전부
 *
 * 자차 앞 플래툰 하나뿐이면 도로가 비어 보인다. 실제 도심 단면에는 **옆 차로**와
 * **마주 오는 차로**와 **인도 위의 사람들**이 같이 있다. 전부 같은 시계(scroll)로
 * 움직이고, 스크롤이 멈추면 같이 멈춘다.
 *
 * 간격은 일부러 불규칙하다. 그리고 그 불규칙함은 위치에 난수를 뿌려 만든 것이
 * **아니다** — 운전자마다 차두시간(T)과 정지간격(s0)이 다르게 주어져 있고, IDM
 * 평형이 그 값의 함수라서 각자 다른 간격으로 수렴한다. 실제 교통이 고르지 않은
 * 이유가 바로 이것이고, 난수 배치와 달리 시간이 지나도 흐트러진 채로 남는다.
 * ------------------------------------------------------------------ */

/**
 * 앞서가는 차량 대수(자차 제외).
 *
 * 다섯 대. 배경이 붐빈다는 지적을 받고 넷으로 줄여 봤는데, 02막의 제동 연쇄가
 * 두 대 뒤에서 끊겼다 — 파동은 대열이 길수록 멀리 간다. 붐비던 곳은 대열이 아니라
 * **마주 오는 두 줄**이었으므로(`ONC_N`) 거기서 덜어내고 대열은 되돌렸다.
 */
const FLEET_N = 5;
/**
 * 차로 안의 느린 횡방향 흔들림 진폭(m). 사람도 ACC 도 차로 한가운데를 자로 잰 듯
 * 지키지 않는다 — 고정 오프셋(`jog`)만 두면 대열이 **레일 위를 달리는 것**으로
 * 보였다(교수님: "차들이 일정한 간격으로 가거나 부자연스럽게 움직여서").
 * ACC 는 차로 유지가 촘촘하고 사람은 더 흐른다. 차로 폭 3.5m 안의 ±십수 cm 라
 * 옆 차와 겹칠 수 없다(겹침 검사가 같은 값을 쓴다).
 */
const WANDER_ACC = 0.07;
const WANDER_HUMAN = 0.16;
/**
 * 배경 도로의 앞 대열에만 섞는 가속 잡음(m/s²). 검증표의 `accCommercial` 은 잡음 0 —
 * 그 값은 계측기(TrafficSim)의 것이고 거기서는 건드리지 않는다. 배경에서는 잡음 0 인
 * 다섯 대가 등속으로 줄지어 가서 모형 기차로 보였다. 0.12 는 사람(0.35)의 3분의 1 —
 * 02막의 제동 전파(stage:check)가 그대로 재현되는 것을 확인한 값이다.
 */
const FLEET_NOISE = 0.12;
/**
 * 플래툰 순항 속도(m/s) ≈ 12 km/h — 정체류.
 *
 * **이 값은 화면상 도로 속도와 무관하다.** 도로가 흐르는 속도는 `M_PER_PX` 가
 * 정하고, 차량은 그 도로 위에 얹혀 같이 흐른다. `FLEET_V` 가 정하는 것은
 * **시뮬 시계의 속도**다 — 시뮬 시각은 `주행거리 / FLEET_V` 로 흐르므로,
 * 이 값이 낮을수록 같은 스크롤에 더 많은 시뮬 초가 지난다.
 *
 * 8 m/s 였을 때 한 막(약 39m)에 시뮬 시간이 4.9초밖에 흐르지 않았다. 교란이
 * 여섯 대를 통과하려면 10초 이상 필요한데, 그래서 **선두만 밟고 뒤차는 반응도
 * 하기 전에 막이 끝났다**(실측: 후미 4대 속도 변화 0). 3.4 m/s 로 내리면 같은
 * 막에 11.5초가 흘러 파가 후미까지 닿는다.
 *
 * 부수적으로 평형 차두거리가 11.5m 로 좁아져 다섯 대가 한 화면에 모인다.
 * 그리고 12 km/h 는 상용 ACC 의 스트링 불안정이 실제로 문제가 되는 속도대다.
 */
const FLEET_V = 3.4;
/** 자차가 화면에 들어오기 시작하는 기준 거리(m). 실제 값은 `ACT_CAM.back` 이 막마다 정한다. */
const CAM_BACK = 11;
/** 물리 스텝(s). 반응 지연(0.75s)이 정수 스텝으로 떨어지도록 1/60 고정. */
const SIM_DT = 1 / 60;
/**
 * 한 프레임에 밀어넣을 최대 물리 스텝 — 스크롤을 확 던졌을 때 폭주 방지.
 * 시뮬 시계가 빨라진 만큼(FLEET_V 8 → 3.4) 상한도 올린다. 24스텝 = 0.4s/프레임.
 */
const SIM_MAX_SUB = 24;
/** 교란 주기·길이(시뮬 s). 선두가 한 번 밟으면 파가 뒤로 전파된다. */
const WAVE_PERIOD = 11;
const WAVE_AT = 2.5;

/** 같은 방향 바깥 차로의 중심 x(m). 길가장자리 실선(−7.9)과 차로 파선(−4.5) 사이. */
const LANE_NEXT = -6.2;
/** 마주 오는 차로 두 줄. 중앙분리대(+1.1) 건너편이다. */
const LANE_ONC: number[] = [2.8, 6.2];
/** 인도 중심 x(m) — 사람이 걷는 자리. 연석에서 한 발 물러나 있다. */
const WALK_X = 9.6;

/** 옆 차로 대수 — 120m 링에 7대면 차두 17m, 평형속도 ≈ 25km/h 의 정체류다. */
const NEXT_N = 7;
/**
 * 마주 오는 차로 한 줄당 대수 — 두 줄이라 여기가 화면에서 가장 붐빈다.
 * 다섯씩(24m 간격)이면 맞은편이 늘 차로 메워져 있었다. 셋이면 40m 간격 —
 * 대략 8초에 한 대가 스쳐 지나가는, 한산한 도심 간선의 리듬이다.
 */
const ONC_N = 3;
/** 인도 위 사람 수(양쪽 합). */
const PED_N = 16;

/* --- 옆 차로의 교란 -------------------------------------------------
   한 대가 주기적으로 밟는다. 사람 운전 프리셋은 이 교란을 뒤로 갈수록 키우고
   (검증표 3.92배), 그 결과가 화면에서는 **뒤로 밀려오는 붉은 제동등 띠**다.
   주기는 씬 한 바퀴(120m / 6.4m·s⁻¹ ≈ 19s)보다 짧게 잡아 늘 파가 살아 있게 한다. */
const JAM_PERIOD = 13;
const JAM_DURATION = 2.6;
const JAM_AT = 3;
const JAM_ACCEL = -2.2;

/* --- 03막 배차 차량 -------------------------------------------------- */
/** 갓길 정차 위치(m). 길가장자리 실선(−7.9) 안쪽이라 인도를 밟지 않는다. */
const TAXI_STOP_X = -7.3;
/**
 * 배차 차량의 동선은 **도로 기준**이다 — 카메라 기준이 아니다.
 *
 * 한때 `taxi.dz`(카메라로부터의 거리)를 진행도의 함수로 직접 정했다. 그러면 차가
 * 카메라에 매달려 따라오고, "정차" 중에도 우리와 같은 속도로 굴러가며, 출발할 때는
 * 한 막에 47m 를 앞서 나가려고 우리 속도의 네 배로 튀어 나갔다. 교수님이
 * "주황색 막대 있는 놈 혼자 이상하게 다닌다"고 했다. 지금은 도로 위의 절대
 * 위치(`taxi.z`)를 두고 **도로 대비 속도비**로 움직인다: 다가올 땐 우리보다
 * 느리게(`TAXI_R_IN`) 달리다 서고, 서 있는 동안 우리가 그 옆을 지나가고, 승객이
 * 타면 정상 속도로 빠져나가 우리 뒤로 사라진다. 길이는 한 막의 주행거리에 비례
 * (`TAXI_SPAWN_K` × 한 막의 주행거리)해 창 높이가 달라도 같은 장면이다.
 */
const TAXI_SPAWN_K = 0.6;
const TAXI_R_IN = 0.75;
/** 출발 뒤 속도비. 1 보다 커야 우리 앞에 머물다 멀어진다 — 1 이면 옆에 붙어 따라오고,
    다음 막에서 카메라가 뒤로 빠질 때 다시 화면에 들어온다. */
const TAXI_R_OUT = 1.3;
/** 승객이 인도에서 기다리는 자리와, 타러 나오는 자리(m). */
const PAX_WAIT_X = -9.9;
const PAX_BOARD_X = -8.5;

/* --- 04막 협조 합류 ---------------------------------------------------
   협조 합류의 핵심은 합류차가 끼어드는 것이 아니라 **뒷차가 먼저 간격을 내주는**
   것이다. 그 역할을 맡는 플래툰 차량 번호. */
const MERGE_PARTNER = 2;
/** 간격을 내줄 때의 감속(m/s²). 눈에 보일 만큼은 크고, 대열이 무너지지 않을 만큼은 작다. */
const YIELD_ACCEL = -1.6;
/**
 * 01막에서 선두가 밟는 세기(m/s²). 검증 시나리오의 −2.5 보다 세다 —
 * 정체류(12km/h·차간 14m)는 완충이 커서 −2.5 로는 교란이 두 대 만에 잦아든다.
 * −4.0 이면 선두가 실제로 멈추고(도심 신호 대기와 같은 장면) 네 대까지 반응한다.
 */
const ACT_BRAKE = -4;
/**
 * 제동등이 켜지는 가속도 문턱(m/s²). 실제 차는 브레이크를 **살짝만 밟아도** 켜진다.
 * −0.9 로 잡았더니 대열에서 한두 대만 점등해 연쇄가 거의 보이지 않았다.
 * 계측판의 "파동 위치"도 같은 문턱을 쓴다 — 숫자와 화면이 어긋나면 둘 다 못 믿는다.
 */
const BRAKE_LAMP = -0.28;
/** 02막 후반에 제어 AV 로 바뀌는 옆 차로 차량 **id**. 고르게 흩어 놓는다. */
const AV_IDS = [0, 3, 5];
/** 예약된 자리 주변에서 다른 차가 완전히 되살아나기까지의 여유 거리(m). */
const RESERVE_CLEAR = 4;

/**
 * 03막의 배차 차량과 승객.
 *
 * **위치를 월드가 아니라 카메라 기준 거리(`dz`)로 잡는다.** 월드에 박아 두면
 * 자차 속도의 적분만큼 계속 어긋나서(정체류에서는 그 오차가 막 하나에 수십 m 다)
 * 연출이 화면 밖이나 코앞에서 벌어진다 — 실제로 100m 밖에서 일어나고 있었다.
 *
 * 01·02막의 물리(스트링 불안정, stop-and-go)는 그대로 실제 IDM 시뮬이다.
 * 03막은 **서비스 시연**이라 안무로 둔다. 보여주려는 것이 물리 법칙이 아니라
 * "호출하면 차가 와서 태우고 간다"는 절차이기 때문이다.
 */
interface Taxi {
  /** 연출이 서 있는가 */
  on: number;
  /** 카메라로부터의 거리(m) */
  dz: number;
  x: number;
  shape: number;
  brake: boolean;
  /** 도로 위의 절대 위치(`zAbs` 와 같은 자) — 차는 도로에 서 있지 카메라에 매달려 있지 않다 */
  z: number;
  /** 직전 프레임의 카메라 주행 위치 — 도로가 얼마나 흘렀는지 재는 기준 */
  lastZ: number;
  /** 승객 — 거리·횡위치·걸음 위상·탑승 완료 */
  paxDz: number;
  paxX: number;
  paxPh: number;
  paxGone: number;
}

/* ------------------------------------------------------------------ *
 * 연구 무대의 4개 막
 *
 * 패널을 **옆으로 넘기는 것**이 재생 헤드다. 넘긴 패널의 주제 하나가 배경 도로
 * 위에 올라간다. 막이 바뀌는 것은 도로에 **무엇이 표시되는가**이지 장면이 통째로
 * 갈리는 것이 아니다 — 같은 도로를 계속 달린다.
 *
 *   0 Mixed Traffic Control    — 옆 차로 사람 운전 대열의 stop-and-go 파동.
 *                                제동등의 붉은 띠가 뒤로 전파된다.
 *   1 AV Control and Behavior  — 차마다 속도 막대가 서고, 선두가 밟으면 그 감속이
 *                                뒷차로 전달되며 막대가 차례로 주저앉는다.
 *   2 AV Mobility Service      — 인도의 승객이 차를 부르고, 한 대가 갓길에 붙어
 *                                태우고 떠난다(호출 → 정차 → 탑승 → 출발).
 *   3 CAV and CDA              — 차량 사이에 V2V 링크가 맺히고, 옆 차로 한 대가
 *                                그 협조 아래 우리 차로로 합류한다.
 * ------------------------------------------------------------------ */

const ACTS = 4;

/**
 * **막은 번호가 아니라 이름으로 지목한다.**
 *
 * 화면에 서는 순서는 `RESEARCH` 배열이 정하고, 그 순서는 바뀐다(실제로 01·02 를
 * 맞바꿨다). 연출을 `actK[0]` 처럼 숫자로 지목해 두면 순서를 바꾸는 순간 속도
 * 막대가 혼합교통 막에서 서고 리본이 제어 막에서 깔린다 — 링 시뮬 배열을
 * 인덱스로 지목했다가 제어 AV 가 두 배로 불어난 것과 같은 종류의 버그다.
 *
 * 이 상수들과 `ACT_CAM` · `RESEARCH` 세 곳의 **순서가 같아야 한다.**
 */
const ACT_MIX = 0;
const ACT_PLATOON = 1;
const ACT_SERVICE = 2;
const ACT_CDA = 3;
/**
 * 막이 제자리를 잡기 전/후로 겹치는 폭(막 길이 비율).
 * `t` 가 −LEAD 에서 뜨기 시작해 IN 에서 만개하고, OUT 부터 지다가 1+TAIL 에서 사라진다.
 */
/**
 * 시점이 오르기 시작하는 **선행 거리**(막 길이 배수).
 *
 * 0.62 였다. 그때는 여는 화면이 정확히 한 화면이라 무대 앞에 여유가 없었다 —
 * 0.85 로 잡으면 스크롤 0 에서 이미 rise 0.09 였다. 지금은 여는 화면이 글자
 * 연출 때문에 세 화면 넘게 길어져 **앞에 여유가 충분하다.** 1.3 이면 상승이
 * 1,100px 에 걸쳐 일어나고(전에는 실질 200px), 스크롤 0 에서는 여전히 정확히 0 이다.
 */
const RISE_LEAD = 1.3;

const ACT_LEAD = 0.26;
const ACT_IN = 0.12;
const ACT_OUT = 0.8;
const ACT_TAIL = 0.28;

/**
 * **가로 덱에서 한 막의 연출이 한 바퀴 도는 주행거리(m).**
 *
 * 세로로 쌓은 무대에서는 막이 화면을 지나는 진행도가 그대로 연출의 재생 헤드였다.
 * 가로로 넘기는 덱에서는 패널이 제자리에 서 있어 그 값이 0 에 머문다 — 재생 헤드를
 * **주행거리**로 옮긴다. 이 거리를 지날 때마다 그 막의 연출이 처음부터 다시 흐른다.
 * 세로 무대 한 막(88vh ≈ 39m)과 같은 길이로 잡아 읽는 속도를 그대로 둔다.
 */
const ACT_RUN = 38;

/**
 * **막마다 카메라가 다른 자리에 선다.** 네 주제를 같은 구도로 보여주면 주석만 바뀔 뿐
 * "다른 이야기"로 읽히지 않는다(실제로 그랬다). 높이·시선·화각·자차와의 거리를 전부
 * 다르게 잡아, 막이 넘어갈 때 **다른 장소로 옮겨 간 것처럼** 만든다.
 *
 * `pan` 은 소실점을 오른쪽으로 미는 양이다. 글은 화면 왼쪽에 앉으므로 연출이
 * 오른쪽에 서야 겹치지 않는다 — 03막(인도·픽업)은 왼쪽 인도에서 벌어지므로
 * 가장 크게 민다.
 */
interface ActCam {
  /** 노면 위 카메라 높이(m) */
  y: number;
  /** 소실점의 화면 세로 위치(비율) */
  horizon: number;
  /** 자차 뒤로 빠지는 거리(m) */
  back: number;
  /** 소실점을 오른쪽으로 미는 양(화면 폭 비율) */
  pan: number;
  /** 초점거리 배율(화면 높이 기준) — 작을수록 광각 */
  fov: number;
}

const ACT_CAM: ActCam[] = [
  // 01 혼합교통(ACT_MIX) — 올라가 파동이 뒤로 밀려오는 것을 위에서 본다. 12m 까지
  //    올려 봤지만 옆 차로가 화면 아래끝으로 밀려 리본이 안 보였다.
  { y: 9.5, horizon: 0.24, back: 8, pan: 0.1, fov: 1 },
  // 02 제어·거동(ACT_PLATOON) — 대열이 한 줄로 읽히게 낮고 좁게, 뒤로 멀리 빠진다
  { y: 4.6, horizon: 0.4, back: 22, pan: 0.05, fov: 0.9 },
  // 03 모빌리티 서비스 — 사람 눈높이로 내려오고, 인도가 들어오게 크게 돌린다.
  //    사람이 걸어오는 것을 봐야 해서 화각을 좁혀(=당겨) 잡는다.
  { y: 3.4, horizon: 0.42, back: 8, pan: 0.15, fov: 1.1 },
  // 04 협조 자율주행 — 두 차로가 함께 보이는 중간 높이
  { y: 7.8, horizon: 0.29, back: 19, pan: 0.075, fov: 1 },
];
/**
 * 막별 계측 표기(차간 브래킷·정차선·호출 표식·V2V 링크)가 쓰는 점 여유.
 * 실측: 네 막이 전부 겹치는 최악의 프레임에서 780점. 두 배로 잡아 둔다.
 */
const ANNO_CAP = 1600;
/** 02막 속도 막대를 그리기 시작하는 거리(m). 이보다 가까우면 안 그린다. */
const BAR_NEAR = 16;

/* ------------------------------------------------------------------ *
 * 커서 = 자차 센서의 지향 (2축 짐벌)
 *
 * **화면 위에 아무것도 생기지 않는다.** 커서 자리를 밝히는 원판을 만들어 봤는데,
 * 그건 배경에 손전등을 비추는 것이지 자율주행 연구실의 인터랙션이 아니었다.
 * 반응하는 것은 커서 자리가 아니라 **세계**다. 커서는 자차가 겨누는 곳이고,
 * 자차는 거기를 보려고 **몸을 움직인다**:
 *
 *   가로 — 운전대. 차가 차로 안에서 그쪽으로 옮겨 가고(`STEER_X`), 시선이 그만큼
 *          돌아가고(`STEER_YAW`), **차체가 바깥쪽으로 기운다**(`STEER_ROLL`).
 *   세로 — 센서의 피치. 고개를 들면 지평선이 내려가 먼 곳이 열리고, 숙이면
 *          지평선이 올라가 노면이 화면을 채운다(`STEER_PITCH`).
 *
 * 셋 다 화면 효과가 아니라 **투영 자체**를 움직인다 — 주점(cx·cy)과 카메라
 * 횡위치를 옮기는 것이라 시차가 진짜로 생긴다. 가까운 차선 도색은 크게, 먼
 * 가로등은 거의 안 움직인다. 화면을 덧칠해서는 나오지 않는 깊이 단서이고,
 * 이 배경이 이미지가 아니라 점군이라는 사실이 그때 드러난다.
 *
 * **롤만은 카울(보닛)에 걸지 않는다.** 보닛은 차에 붙어 있어 차와 함께 기울므로
 * 화면에서는 그대로 있고, 그 고정된 실루엣에 대고 **세계가 기운다** — 차 안에서
 * 커브를 돌 때 실제로 보이는 그림이다. 둘 다 기울이면 아무 일도 안 일어난다.
 *
 * 값은 rAF 안에서 한 번만 뒤따르고 리스너는 목표만 적는다 — 프레임 안에서
 * 이벤트를 읽지도, state 를 건드리지도 않는다.
 * ------------------------------------------------------------------ */

/** 차로 안에서 좌우로 움직이는 폭(m). 차로가 3.4m 라 이보다 크면 선을 밟는다. */
const STEER_X = 1.15;
/** 조향에 딸려오는 요 — 주점 이동량(화면 폭 대비). */
const STEER_YAW = 0.034;
/**
 * 차체 롤 — 화면 가로 1px 당 세로 기울기. 0.034 는 약 2°(폭 1440 에서 양끝 ±24px).
 * 더 주면 수평선이 기운 사진처럼 보이고, 덜 주면 조향했다는 것을 못 알아챈다.
 */
const STEER_ROLL = 0.034;
/**
 * 센서 피치 — 소실점의 세로 이동량(화면 높이 대비, 편도).
 * 위아래가 대칭이 아니다: 고개를 들면 하늘(빈 곳)만 늘어나므로 위쪽은 절반만 준다.
 */
const STEER_PITCH = 0.055;
const STEER_PITCH_UP = 0.5;
/** 손을 따라잡는 시간상수(s). 차라서 시선보다 느리다. */
const STEER_TAU = 0.38;
/**
 * 지향이 움직이는 동안 스윕 빔이 살아나는 정도 — **프레임당 지향 변화량**에 곱한다.
 * 센서를 돌리면 그 각도를 다시 훑는 것이 LiDAR 가 실제로 하는 일이다. 커서 자리에
 * 무언가를 덧그리는 것이 아니라, 이미 있는 스캔선이 화면 전체를 한 번 훑고 간다.
 *
 * **정착하면 정확히 0 이 되어야 한다** — 지향이 목표에 스냅하면 변화량이 0 이 되고,
 * 그래야 "완전 정지 프레임은 통째로 건너뛴다" 판정이 다시 선다.
 */
const STEER_BEAM = 18;

/* ------------------------------------------------------------------ *
 * 조용한 영역 — 본문이 앉는 자리
 *
 * 움직이는 점군 위에서는 본문이 읽히지 않는다. 이것을 CSS 블러 판으로 풀면
 * 프로스티드 글래스 카드가 되어(실제로 한 번 그랬다) 이 사이트의 전제가 깨진다.
 * 대신 **캔버스가 직접** 조용해진다: `data-quiet` 가 붙은 요소의 자리에서 점의
 * 알파가 떨어진다. 테두리도, 재질 변화도, 판도 없다 — 점이 성겨질 뿐이다.
 *
 * **요소의 사각형이 아니라 글줄의 자리를 쓴다.** 한때 요소의 border box 하나를
 * 통째로 조용하게 만들었는데, 본문 구역은 전부 화면 폭짜리 블록이라 결과가
 * **화면 전체가 10% 로 죽는 것**이었다(`.papers` 는 1440×1481 이었다). 도로가
 * 있다가 없어지니, 구역을 지날 때마다 배경이 꺼졌다 켜졌다 했다 — 교수님이
 * "배경과 요소의 경계가 어색하다"고 한 것의 절반이 이것이다.
 *
 * 그래서 요소 안의 **글줄 상자**(Range.getClientRects)를 모아 줄 단위로 뭉쳐
 * 쓴다. 글이 실제로 앉은 자리만 조용해지고, 빈 여백·바깥 칼럼에서는 도로가
 * 그대로 산다. 글줄은 레이아웃이 바뀔 때만 달라지므로 **요소 기준 상대 좌표로
 * 캐시**하고, 프레임마다 읽는 것은 여전히 요소의 rect 하나뿐이다.
 *
 * 점마다 상자들과 거리를 재면 비싸다(점 3만 × 상자 수십). 대신 화면을 거친
 * 격자로 나눠 감쇠값을 **프레임당 한 번** 굽고, 점은 한 번 조회한다.
 * ------------------------------------------------------------------ */

/** 감쇠 격자 해상도. 1280px 에서 셀 20px — 감쇠 거리(120px)의 1/6 이라 계단이 안 보인다. */
const QW = 64;
const QH = 44;
/**
 * 상자 밖으로 감쇠가 풀리는 거리(화면 짧은 변 기준 비율).
 * 글줄 상자로 바꾸면서 0.14 → 0.19 로 늘렸다. 예전에는 요소 사각형이 화면을
 * 통째로 덮어 **경계가 화면 밖에 있었지만**, 이제는 글이 없는 쪽에 도로가 살아
 * 있어 경계가 화면 안에 들어온다 — 그만큼 더 길게 풀어야 선으로 안 읽힌다.
 */
const QUIET_SOFT = 0.19;
/**
 * 가장 조용한 곳에 남는 밝기. 0 이면 글자 뒤가 새까만 창이 되어 그것대로 판이다.
 * 점밀도를 1.6배로 올리면서 0.26 → 0.1 로 내렸다 — **바닥이 아니라 곱이 밝기를
 * 정하므로**, 점이 늘면 같은 바닥에서도 글자 뒤가 그만큼 시끄러워진다.
 */
const QUIET_FLOOR = 0.1;
/**
 * `data-quiet="panel"` 의 바닥. **계측기가 서는 자리는 도로가 더 깊이 잠긴다.**
 *
 * 글은 도로 위에 얹히지만 계측기는 **다른 장비의 화면**이다 — 그 안까지 도로가
 * 비쳐 들면 수치 위로 점이 지나간다(실제로 `7/7` 위에 주황 점이 얹혔다).
 * 대신 판을 깔지 않는다: 불투명면은 도로를 직각으로 자르지만, 바닥을 내리면
 * 같은 자리가 **171px 에 걸쳐 서서히** 잠겨 경계가 선으로 남지 않는다.
 */
const QUIET_DEEP = 0.015;
/**
 * 계측기 둘레에서 감쇠가 풀리는 거리. 글보다 짧다.
 *
 * 계측기는 화면의 4분의 1을 쓰는 큰 사각형이라 글과 같은 171px 를 두르면 화면의
 * 절반이 함께 잠긴다 — 실측으로 연구 패널의 그린 점이 19,900 → 4,600 으로 떨어졌다.
 * 바닥이 깊은 만큼 짧게 풀어도 기울기는 글 쪽과 비슷하다
 * (최대 기울기 ≈ 1.5·(1−바닥)/거리: 글 0.0079/px · 계측기 0.0101/px).
 */
const QUIET_SOFT_PANEL = 0.146;
/** 한 프레임에 볼 `data-quiet` 요소 수 상한. */
const QUIET_MAX = 10;
/**
 * 요소 하나가 쓰는 글줄 상자 수 상한. 넘으면 세로로 가까운 것끼리 뭉친다 —
 * 논문 목록처럼 줄이 40개인 구역도 8덩이로 접히되, **가로 폭은 글줄의 것**이라
 * 화면 폭 사각형으로 되돌아가지는 않는다.
 */
const QUIET_INK_MAX = 8;
/**
 * 글줄 상자를 다시 재는 주기(s). 레이아웃이 안 바뀌어도 주기적으로 보는 이유는
 * sticky 요소가 스크롤에 따라 부모 안에서 움직이기 때문이다. 한 프레임에 한
 * 요소만 다시 잰다 — 여러 요소를 같은 프레임에 재면 그 프레임만 튄다.
 */
const QUIET_INK_TTL = 0.5;

/**
 * 조용한 요소 하나. `box` 는 **요소 기준 상대 좌표**의 글줄 상자
 * `[x, y, w, h]` 묶음이라, 프레임마다 요소 rect 하나만 읽어 더하면 된다.
 */
interface QuietEl {
  el: Element;
  /** 이 요소가 도로를 잠그는 바닥(`QUIET_FLOOR` 또는 `QUIET_DEEP`) */
  floor: number;
  /** 감쇠가 풀리는 거리(화면 짧은 변 대비) */
  soft: number;
  /** 마지막으로 글줄을 잰 때의 요소 크기 — 달라지면 다시 잰다 */
  bw: number;
  bh: number;
  /** 마지막으로 잰 시각(s) */
  at: number;
  /** [x, y, w, h] × n (요소 기준) */
  box: Float64Array;
  n: number;
  /** 첫 화면의 글 상자인가 — 글자가 점이 되는 만큼 감쇠가 풀린다 */
  ink: boolean;
}

/** 글줄 상자 수집용 스크래치. 요소 하나를 잴 때만 쓰고 바로 비운다. */
const inkScratch = new Float64Array(QUIET_INK_MAX * 4);

/**
 * 요소 안에서 **글이 실제로 앉은 자리**를 최대 `QUIET_INK_MAX` 덩이로 모은다.
 *
 * `Range.getClientRects()` 는 글줄마다 상자를 하나씩 준다(캔버스·이미지 같은
 * 치환 요소는 그 자체로 한 상자). 세로로 겹치는 것끼리 한 줄로 합치고, 줄이
 * 상한을 넘으면 **세로로 가장 가까운 두 줄**부터 뭉친다 — 뭉쳐도 가로 폭은
 * 글줄의 것이라 화면 폭 사각형으로 돌아가지 않는다.
 *
 * 글이 없으면(0 상자) 요소 사각형 하나를 그대로 쓴다.
 */
function inkBoxes(el: Element, q: QuietEl, r: DOMRect): void {
  const s = inkScratch;
  let n = 0;
  let rects: DOMRectList | null = null;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    rects = range.getClientRects();
    range.detach();
  } catch {
    rects = null;
  }
  if (rects) {
    for (let i = 0; i < rects.length; i++) {
      const t = rects[i]!;
      if (t.width <= 0.5 || t.height <= 0.5) continue;
      // 요소 밖으로 삐져나온 것(sticky·absolute 자식)은 요소 안으로 자른다.
      let l = t.left < r.left ? r.left : t.left;
      let rr = t.right > r.right ? r.right : t.right;
      let tp = t.top < r.top ? r.top : t.top;
      let bt = t.bottom > r.bottom ? r.bottom : t.bottom;
      if (rr - l <= 0.5 || bt - tp <= 0.5) continue;
      l -= r.left;
      rr -= r.left;
      tp -= r.top;
      bt -= r.top;
      // 세로로 겹치는 줄을 찾아 합친다.
      let hit = -1;
      for (let b = 0; b < n; b++) {
        const by = s[b * 4 + 1]!;
        const bb = by + s[b * 4 + 3]!;
        if (tp < bb && bt > by) {
          hit = b;
          break;
        }
      }
      if (hit >= 0) {
        const j = hit * 4;
        const x0 = Math.min(s[j]!, l);
        const y0 = Math.min(s[j + 1]!, tp);
        s[j] = x0;
        s[j + 1] = y0;
        s[j + 2] = Math.max(s[j]! + s[j + 2]!, rr) - x0;
        s[j + 3] = Math.max(s[j + 1]! + s[j + 3]!, bt) - y0;
        continue;
      }
      if (n < QUIET_INK_MAX) {
        const j = n * 4;
        s[j] = l;
        s[j + 1] = tp;
        s[j + 2] = rr - l;
        s[j + 3] = bt - tp;
        n++;
        continue;
      }
      // 자리가 없다 — 세로로 가장 가까운 두 줄을 뭉쳐 한 칸 낸다.
      let best = 0;
      let bestGap = Infinity;
      for (let b = 0; b + 1 < n; b++) {
        for (let c = b + 1; c < n; c++) {
          const g = Math.abs(s[c * 4 + 1]! - s[b * 4 + 1]!);
          if (g < bestGap) {
            bestGap = g;
            best = b * QUIET_INK_MAX + c;
          }
        }
      }
      const bi = ((best / QUIET_INK_MAX) | 0) * 4;
      const ci = (best % QUIET_INK_MAX) * 4;
      const x0 = Math.min(s[bi]!, s[ci]!);
      const y0 = Math.min(s[bi + 1]!, s[ci + 1]!);
      const x1 = Math.max(s[bi]! + s[bi + 2]!, s[ci]! + s[ci + 2]!);
      const y1 = Math.max(s[bi + 1]! + s[bi + 3]!, s[ci + 1]! + s[ci + 3]!);
      s[bi] = x0;
      s[bi + 1] = y0;
      s[bi + 2] = x1 - x0;
      s[bi + 3] = y1 - y0;
      // 뭉쳐서 빈 칸(ci)에 마지막 줄을 당겨 오고, 그 자리에 새 줄을 넣는다.
      const last = (n - 1) * 4;
      if (ci !== last) for (let k = 0; k < 4; k++) s[ci + k] = s[last + k]!;
      s[last] = l;
      s[last + 1] = tp;
      s[last + 2] = rr - l;
      s[last + 3] = bt - tp;
    }
  }
  if (n === 0) {
    s[0] = 0;
    s[1] = 0;
    s[2] = r.width;
    s[3] = r.height;
    n = 1;
  }
  q.box.set(s.subarray(0, n * 4));
  q.n = n;
  q.bw = r.width;
  q.bh = r.height;
}

/* ------------------------------------------------------------------ *
 * 첫 화면의 글자 = 스캔 반사점
 *
 * 여는 화면의 글자는 **점군의 일부**다. 스크롤을 내리면 글자가 점으로 풀려
 * 도로로 흘러들어 앞차들의 차체 점군에 자리 잡고, 그 뒤로는 그냥 차다.
 * 되올리면 점이 다시 글자로 모인다 — 시간이 아니라 **스크롤이 재생 헤드**다.
 *
 * 세 가지를 지킨다.
 *   ① 재생 헤드는 이미 있는 `hp`(히어로 퇴장 진행도) 하나뿐이다. 새 시간축 없음.
 *   ② 한 점의 도착 시점은 **그 글자가 화면 위끝을 벗어나는 순간**이다. 글이
 *      잘려 나가는 대신 풀린다 — 화면 크기·언어가 달라도 저절로 맞는다.
 *   ③ 도착한 점은 `drawCar` 가 찍었을 픽셀과 **같다**. 그래야 hp = 1 에서
 *      평범한 차 그리기로 넘어갈 때 아무 일도 일어나지 않는다.
 * ------------------------------------------------------------------ */

/**
 * 글자 점 상한(무리 합계). 모바일은 예산도 화면도 작다.
 *
 * 상한을 정하는 것은 예산이 아니라 **차가 받아 줄 수 있는 자리**다. 1280×860 에서
 * 앞차 대열이 약 930점, 옆 차로의 창 안 차들이 약 1,020점을 받는다 — 2,400점을
 * 구웠더니 675점이 자리를 못 얻고 흩어졌고, 그러면 "글자가 차가 된다"가 아니라
 * "글자의 4분의 1이 사라진다"가 된다.
 */
const GLYPH_MAX = 8000;
const GLYPH_MAX_MOBILE = 5000;
/**
 * 우리 차로 대열이 받는 몫. 워드마크(MAIA)가 여기로 가고 나머지 글은 옆 차로다.
 * 대열은 5대뿐이라 몫을 더 주면 받을 자리가 없어 그대로 흩어져 사라진다.
 */
const GLYPH_LANE_SHARE = 0.45;
/**
 * 표본 간격(px). `크기/30` 을 아래 범위로 자른 값이다 — 범위가 좁아 사실상
 * **첫 화면 전체가 같은 격자로 스캔된 한 장**이고, 점은 글자가 차지한 면적에
 * 비례해 저절로 배분된다(워드마크 900점 · 나머지 글 1,100점).
 *
 * 처음에는 간격을 크기에 그대로 비례시켰다(작은 글 3.4px · 워드마크 6.4px).
 * 화면에서 가장 큰 글자가 점을 290개밖에 못 받아 성긴 반면 본문이 1,650개를
 * 먹었다 — 교수님이 지목한 것은 워드마크인데 정작 워드마크가 가장 덜 풀렸다.
 * 아래끝(3.2px)은 16px 본문 한 글자에 점 6개가 남는 선이다: 더 벌리면 한 줄이
 * 풀리는 것이 아니라 점 몇 개가 흩어지는 것으로 보인다.
 */
const GLYPH_STEP = 2.7;
const GLYPH_STEP_MIN = 1.75;
/** 획으로 치는 픽셀 피복률 문턱. 이보다 옅으면 안티에일리어싱 가장자리다. */
const GLYPH_INK = 0.3;
/**
 * **치환 구간의 길이(스크롤 px)** — 점이 **글자 픽셀 위에 그대로 서 있는** 구간.
 *
 * 이 구간이 없으면 글자가 옅어지는 것과 점이 날아가는 것이 동시에 일어나서,
 * 화면 어디에도 "글자 모양이 점으로 서 있는 순간"이 없다 — 글자가 점이 된 것이
 * 아니라 **글자 옆에서 점이 나온 것**으로 보인다(교수님 지적). 구간의 끝에서는
 * 화면에 **점으로 찍힌 첫 화면**이 서 있고 DOM 글자는 정확히 0 이다.
 * 점마다의 시차는 여기에 없다 — 글이 통째로 점이 된다.
 *
 * **비율이 아니라 px 다.** 휠 한 칸이 100px 남짓이니 150px 이면 한두 칸이다.
 * 비율로 두면 여는 화면 길이를 바꿀 때마다 체감 속도가 같이 변한다.
 */
const GLYPH_HOLD_PX = 250;
/**
 * 치환이 시작되는 스크롤(px). 첫 화면이 **붙어 있는** 동안 도는 연출이라 글자
 * 위치와 무관하다 — 손가락을 한 번 굴리면 바로 시작한다.
 */
const GLYPH_START_PX = 16;
/**
 * 재생 헤드가 스크롤을 뒤따르는 시간상수(s). 휠 한 칸(브라우저가 100~200ms 에
 * 걸쳐 보내는 계단)을 서른 프레임 남짓에 편다. 도로가 아니라 **글자 연출만**
 * 이 완충을 쓴다 — "스크롤이 곧 주행"은 도로의 규칙이다.
 */
const HP_TAU = 0.17;
/**
 * 스크롤 입력이 **도로로** 들어오는 시간상수(s). 휠 한 칸의 계단을 편다.
 * `camZ` 의 자체 감쇠(`DAMP`, τ≈0.17s)와 겹쳐 도로는 τ≈0.33s 로 따라가고,
 * 글자 재생 헤드도 여기에 `HP_TAU` 를 더해 같은 자리에 온다 — **한 시계**다.
 */
const SCROLL_TAU = 0.16;
/**
 * 터치는 브라우저가 관성으로 이미 매끄럽게 굴린다 — 그 위에 같은 완충을 얹으면
 * 손가락을 뗀 뒤 도로가 한 번 더 미끄러져 무겁게 느껴진다. 짧게 잡는다.
 */
const SCROLL_TAU_TOUCH = 0.09;

/** 도착 상한. hp = 1 에서는 **전부** 자리 잡아 있어야 한다. */
const GLYPH_END = 0.97;
/**
 * 글자 점의 화면 크기(px). **공중에서는 끝까지 이 크기다.**
 * 작고 많아야 점이 면으로 읽힌다 — 2px 짜리 사각형이 성기게 떠 있으면 블록이다.
 */
const GLYPH_PS = 1;
/** 비행 경로가 도로 쪽으로 처지는 정도(화면 높이 대비, 중간에서 최대). */
const GLYPH_SAG = 0.04;
/**
 * **풀어지는 구간의 길이(스크롤 px).** 치환이 끝난 점-글자가 제자리에서 흐트러진다.
 * 여기까지는 아직 아무도 떠나지 않는다.
 */
const GLYPH_LOOSEN_PX = 150;
/**
 * **조립 구간의 길이(스크롤 px).** 점마다 **출발 시각이 이 구간 전체에 흩뿌려진다**.
 *
 * 한때는 비행 마지막 32%에 다 같이 수렴시켰다. "도착 전 유령 없음"은 지켜졌지만
 * 보통 스크롤 속도에서 그 100px 를 한 번에 지나쳐 **차가 되는 과정이 아예 빠졌다**
 * (교수님: "여기서 차량이 되는 과정이 아예 빠져 있어"). 출발을 흩뿌리면 어느
 * 프레임을 잘라도 글자 자리에 남은 점 · 공중의 줄기 · 앉은 점이 함께 보인다.
 */
const GLYPH_ASM_PX = 1120;
/**
 * **한 점**이 글자에서 차까지 가는 거리(스크롤 px).
 *
 * 80px 이었을 때는 **휠 한 칸(≈100px)에 점이 출발에서 도착까지 순간이동**했다 —
 * 흐르는 것이 아니라 튀었다. 값을 정한 것은 **프레임당 이동량**이다: 글자에서
 * 차까지가 화면에서 900px 쯤 되므로, 420px 짜리 비행이면 스크롤 1px 에 2.1px 씩
 * 움직인다. 휠 한 칸이 재생 헤드 완충(`HP_TAU`)을 거쳐 서른 프레임에 퍼지면
 * 프레임당 7px — 눈이 선을 잇는 범위다. 출발 흩뿌림(`GLYPH_ASM_PX − 이 값`)은
 * 700px 이라 줄기는 여전히 끊기지 않는다.
 */
const GLYPH_FLY_ONE_PX = 420;
/**
 * 모바일의 구간 배율. 데스크톱 기준(치환 250 · 풀어짐 100 · 조립 500 → 도착 866px)
 * 은 한 화면이 844px 인 전화에서 한 화면을 넘는다. 터치 한 번이 400~600px 이니
 * 0.7배면 도착이 611px — 손가락 한두 번이다.
 */
const GLYPH_MOBILE_K = 0.7;
/** 앉는 순간의 번쩍임 — 비행 길이 대비. 0.15 ≈ 스크롤 45px */
const GLYPH_FLASH = 0.15;
/**
 * 번쩍임의 밝기 이득. 색은 **글자의 잉크 버킷 그대로** 쓴다 — `--fg` 버킷(11)로
 * 올리면 후광(halo)이 붙어 3px 짜리 흰 덩어리가 되고, 조립 중인 차가 차가 아니라
 * 하얗게 끓는 덩어리로 보인다(실측 스크린샷).
 */
const GLYPH_FLASH_GAIN = 0.2;
/** 이만큼 잦아들면 차체 색으로 넘어간다. */
const GLYPH_FLASH_SWAP = 0.5;
/** 조립 순서에 주는 흔들림 — 완벽한 평면 스윕은 기계적으로 보인다. */
const GLYPH_ORD_JITTER = 0.06;
/**
 * 한 자리에 겹쳐 내려앉을 수 있는 점의 수. 차 한 대의 템플릿 점이 ≈300 이라
 * 10대로도 3,000자리뿐인데 글자 점은 만 단위다 — 여러 겹으로 받아야 첫 화면의
 * 글이 성긴 격자가 아니라 **면**으로 읽힌다. 여분은 닿기 직전에 스러진다.
 */
const GLYPH_DUP_MAX = 6;
/** 수렴 전 드리프트(px) — 글자가 **자기 자리에서** 풀어지는 정도. 가로·세로. */
const GLYPH_DRIFT_X = 45;
const GLYPH_DRIFT_Y = 70;
/**
 * 글자 점이 켜지는 구간(**치환 구간 대비** 비율). 치환보다 조금 빨리 끝난다 —
 * DOM 글자가 마지막으로 옅어지는 동안 점은 이미 다 켜져 있어야, 글자가 꺼지는
 * 순간 자리에 남는 것이 온전한 점-글자다.
 */
const GLYPH_IN = 0.6;
/** 자리를 못 얻은 점이 스러지는 진행도(e). */
const GLYPH_LOST = 0.55;
/**
 * 옆 차로에서 글자를 받을 수 있는 거리 창(m).
 *
 * 옆 차로는 **링**이라 차가 카메라를 지나가면 뒤쪽 끝으로 되돌아간다. 창 없이
 * 가까운 차에 글자를 주면, 그 차가 연출 도중에 카메라를 지나면서 **554점이
 * 한 프레임에 다른 차로 옮겨 붙었다**(실측). 한 화면을 내려가는 동안 카메라가
 * 정체류보다 4m 남짓 앞서므로, 앞뒤로 그만큼 여유를 두면 창을 벗어날 수 없다.
 * 우리 차로의 대열에는 이 문제가 없다 — 따라가는 대열이라 순서가 안 바뀐다.
 */
const GLYPH_DZ_MIN = 14;
const GLYPH_DZ_MAX = 95;

/** 글자에서 뜯어낸 점군. 좌표는 **문서 좌표**다 — 글은 스크롤과 함께 올라간다. */
interface Glyphs {
  n: number;
  /**
   * **붙어 있는 첫 화면 상자 기준 좌표(px).** 문서 좌표가 아니다 — 여는 화면은
   * sticky 라 스크롤해도 화면에서 움직이지 않는다. 그리기 직전에 그 상자의
   * 화면 위치(`st.inkLeft`·`st.inkTop`)를 더하면 화면 좌표가 된다.
   */
  dx: Float32Array;
  dy: Float32Array;
  /** 알파(획 피복률에서) */
  a: Float32Array;
  /** 잉크 버킷 */
  b: Uint8Array;
  /** 드리프트 방향·세기 −1…1. 조립 순서의 흔들림도 여기서 나온다. */
  dr: Float32Array;
  /** 직전 프레임에 찍은 화면 자리 — **프레임당 이동량**을 재는 계측용. NaN = 없음 */
  lastX: Float32Array;
  lastY: Float32Array;
  /** 그때의 프레임 번호. **연속한 두 프레임**일 때만 이동량으로 친다 — 알파
   *  문턱에서 깜빡여 몇 프레임 건너뛴 점을 "튄 것"으로 세면 안 된다. */
  lastF: Float32Array;
  /** 우리 차로 대열이 받을 구간 [시작, 개수] */
  laneOff: number;
  laneN: number;
  /** 옆 차로가 받을 구간 */
  nextOff: number;
  nextN: number;
  /** 실제로 쓰인 잉크 색 — 팔레트의 잉크 버킷을 이 색으로 채운다. */
  colors: RGB[];
  /* --- 전 글자 공통 일정(hp). 점마다 다른 것은 **조립 순서** 하나뿐이다. --- */
  /** 치환이 시작되는 hp */
  t0: number;
  /** 1 / 치환 길이 */
  subK: number;
  /** 풀어지기가 시작되는 hp(= 치환 끝) */
  loose0: number;
  /** 1 / 풀어지기 길이 */
  looseK: number;
  /** 조립이 시작되는 hp(= 가장 먼저 떠나는 점) */
  asm0: number;
  /** 출발이 흩뿌려지는 폭 — 순서 1 인 점은 `asm0 + asmSpread` 에 떠난다 */
  asmSpread: number;
  /** 1 / 한 점의 비행 길이 */
  flyK: number;
  /** 마지막 점이 앉는 hp */
  done: number;
}

/** `rgb(240, 240, 242)` · `rgb(240 240 242 / .5)` 에서 앞의 세 수만 본다. */
function parseRgb(v: string): RGB | null {
  const m = /(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 고르게 솎는다(Bresenham) — 앞뒤가 치우치지 않아야 글자 모양이 남는다. */
function thinRows(rows: number[][], keep: number): number[][] {
  const n = rows.length;
  if (keep <= 0) return [];
  if (n <= keep) return rows;
  const out: number[][] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += keep;
    if (acc >= n) {
      acc -= n;
      out.push(rows[i]!);
    }
  }
  return out;
}

/**
 * `[data-ink]` 안의 글자를 한 글자씩 표본해 점으로 만든다. **프레임 밖의 일이다** —
 * 글자당 rect 한 번 + 오프스크린 `fillText` 한 번이라 300자면 한 프레임이 길어진다.
 * 한 번 굽고 나면 프레임에서는 배열만 읽는다.
 *
 * 글자 상자는 `Range` 로 잰다. 줄바꿈·`text-wrap: balance`·flex 마디·한글이
 * 섞여 있어도 **브라우저가 실제로 앉힌 자리**가 그대로 나온다. 오프스크린에
 * 다시 그리는 글꼴도 그 요소의 computed font 라, 굵기·자간이 저절로 맞는다.
 *
 * @param vh   `hp` 를 만드는 기준 높이(= innerHeight × 0.85)
 * @param cap  점 상한
 */
function bakeGlyphs(
  vh: number,
  cap: number,
  mobile: boolean,
  rootLeft: number,
  rootTop: number,
): Glyphs | null {
  const els = [...document.querySelectorAll<HTMLElement>("[data-ink]")];
  if (!els.length) return null;

  // 무리 순서를 고정한다 — 앞에 오는 글이 앞에 오는 차를 받는다.
  const order = ["lane", "next"];
  els.sort(
    (a, b) =>
      order.indexOf(a.dataset.ink ?? "next") -
      order.indexOf(b.dataset.ink ?? "next"),
  );

  let maxFs = 0;
  for (const el of els)
    maxFs = Math.max(maxFs, Number.parseFloat(getComputedStyle(el).fontSize));
  if (!(maxFs > 0)) return null;

  const side = Math.min(1024, Math.max(64, Math.ceil(maxFs * 2.7)));
  const off = document.createElement("canvas");
  off.width = side;
  off.height = side;
  const g = off.getContext("2d", { willReadFrequently: true });
  if (!g) return null;

  /* 모바일도 같은 간격으로 표본한다. 화면이 작아 글자도 작으므로 점 수는 저절로
     3분의 1이 된다(약 4,000점) — 30fps 예산 안이고, 성기게 벌리면 글자가 풀리는
     것이 아니라 점 몇 개가 흩어지는 것으로 보인다(1.7배에서 74점까지 떨어졌었다). */
  const stepK = 1;

  /** 무리별 수집함 — [문서x, 문서y, 알파, 버킷] */
  const bag: Record<string, number[][]> = { lane: [], next: [] };
  /** 잉크 색 — 나온 순서대로 최대 `INK_SLOTS` 가지. */
  const colors: RGB[] = [];
  /** 글자 요소들. **읽기가 다 끝난 뒤에** 한꺼번에 일정을 써 준다. */
  const sched: HTMLElement[] = [];

  for (const el of els) {
    const group = el.dataset.ink === "lane" ? "lane" : "next";
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || cs.visibility === "hidden")
      continue;

    const fs = Number.parseFloat(cs.fontSize);
    const step =
      Math.max(GLYPH_STEP_MIN, Math.min(GLYPH_STEP, fs / 30)) * stepK;
    const padX = Math.ceil(fs * 0.45) + 2;
    const padY = Math.ceil(fs * 0.55) + 2;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    g.textBaseline = "alphabetic";
    // 표본하는 것은 **알파 채널**(획의 피복률)이라 색은 무엇이든 된다. 그래도
    // 그 글자가 실제로 쓰는 색을 그대로 쓴다 — 훅에 색을 적어 두지 않는다.
    g.fillStyle = cs.color;

    // 이 요소의 잉크 버킷 — 같은 색이면 같은 버킷을 쓴다.
    const rgb = parseRgb(cs.color) ?? NEUTRAL;
    let slot = colors.findIndex(
      (c) =>
        Math.abs(c[0] - rgb[0]) +
          Math.abs(c[1] - rgb[1]) +
          Math.abs(c[2] - rgb[2]) <
        12,
    );
    if (slot < 0) {
      if (colors.length < INK_SLOTS) {
        colors.push(rgb);
        slot = colors.length - 1;
      } else {
        slot = INK_SLOTS - 1;
      }
    }
    const bucket = INK_B0 + slot;

    // 일정은 전 요소가 하나다(아래 §한 번에). 여기서는 요소만 모아 둔다.
    sched.push(el);

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const dst = bag[group]!;
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === " " || ch === "\n" || ch === "\t" || ch === " ") continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || r.width <= 0 || r.height <= 0) continue;

        const m = g.measureText(ch);
        // 인라인 상자의 half-leading 모델 — 글줄 높이 안에 글꼴 상자를 가운데 둔다.
        const baseline =
          (r.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) /
            2 +
          m.fontBoundingBoxAscent;

        const bw = Math.min(side, Math.ceil(r.width) + padX * 2);
        const bh = Math.min(side, Math.ceil(r.height) + padY * 2);
        g.clearRect(0, 0, bw, bh);
        g.fillText(ch, padX, padY + baseline);
        const data = g.getImageData(0, 0, bw, bh).data;

        // 표본 격자는 **문서 좌표**에 맞춘다 — 글자마다 위상이 달라지면 격자가 깨진다.
        const x0 = r.left - padX;
        const y0 = r.top - padY;
        const ox = Math.ceil(x0 / step) * step - x0;
        const oy = Math.ceil(y0 / step) * step - y0;
        for (let py = oy; py < bh; py += step) {
          const row = (py | 0) * bw;
          for (let px = ox; px < bw; px += step) {
            const cov = data[((row + (px | 0)) << 2) + 3]! / 255;
            if (cov < GLYPH_INK) continue;
            dst.push([
              x0 + px - rootLeft,
              y0 + py - rootTop,
              Math.min(1, 0.74 + cov * 0.34),
              bucket,
            ]);
          }
        }
      }
    }
  }

  /* --- 한 번에 -------------------------------------------------------
     **다섯 요소의 일정이 하나다.** 요소마다 자기 글자가 화면을 벗어나는 때에
     맞춰 차례로 풀게 했더니 "글자가 순차적으로 바뀌어 어색하다"는 말을 들었다.
     지금은 전부 같은 hp 에 치환을 시작해 같은 hp 에 끝내고, 같은 hp 에 도착한다.
     화면 전체의 글이 **한 덩어리로** 점이 되었다가 위에서부터 풀린다.

     일정은 **글자 위치와 무관하다.** 예전에는 "워드마크 위끝이 화면 위끝에 닿는
     순간"을 치환의 끝으로 삼았는데, 그러면 ① 글자가 **위로 올라가다** 점이 되고
     ② 세로가 짧은 창에서는 그 순간이 너무 일러(1377×468 에서 96px) 치환 구간을
     앞에 둘 자리가 없어 일정이 눌렸다. 지금은 첫 화면이 sticky 로 **붙어 있어**
     글자가 움직이지 않으므로 스크롤 px 만으로 정한다.

     길이는 **비율이 아니라 스크롤 px** 다(`GLYPH_START_PX`·`GLYPH_HOLD_PX`·
     `GLYPH_FLY_PX`). 비율로 잡으면 창 크기마다 체감 속도가 달라진다. */
  const kPx = mobile ? GLYPH_MOBILE_K : 1;
  const holdPx = GLYPH_HOLD_PX * kPx;
  const flyPx = GLYPH_FLY_ONE_PX * kPx;
  const startHp = GLYPH_START_PX / vh;
  const loosePx = GLYPH_START_PX + holdPx;
  const asmPx = loosePx + GLYPH_LOOSEN_PX * kPx;
  // 출발은 조립 구간에 흩뿌리되, 마지막 점의 비행까지 그 안에 들어가야 한다.
  const spreadPx = Math.max(10, GLYPH_ASM_PX * kPx - flyPx);
  const donePx = asmPx + GLYPH_ASM_PX * kPx;

  /* DOM 글자가 꺼지는 구간 = **치환 구간 그 자체**다. 글자가 옅어지는 만큼 같은
     자리의 점이 켜지고, 구간 끝에서 글자는 0 · 점은 만개한다 — 그 순간 화면에
     서 있는 것이 **점으로 찍힌 글자**다. 둘을 따로 두면 안 된다.
     읽기가 전부 끝난 다음에 쓴다. CSS 에는 나눗셈이 아니라 곱셈으로 넘긴다 —
     calc() 의 분모는 수여야 한다. */
  const inkK = vh / holdPx;
  for (const el of sched) {
    el.style.setProperty("--ink-at", startHp.toFixed(4));
    el.style.setProperty("--ink-k", inkK.toFixed(3));
  }

  /* 상한을 넘으면 고르게 솎는다. 무리마다 따로 솎아야 한 무리가 다른 무리의
     몫까지 먹지 않는다 — 워드마크가 커지면 옆 차로 글이 통째로 사라진다. */
  const laneCap = Math.round(cap * GLYPH_LANE_SHARE);
  const lane = thinRows(bag.lane!, laneCap);
  const next = thinRows(bag.next!, cap - laneCap);
  const all = lane.concat(next);
  const n = all.length;
  if (n === 0) return null;

  const rnd = mulberry32(0x91c5);
  const out: Glyphs = {
    n,
    dx: new Float32Array(n),
    dy: new Float32Array(n),
    a: new Float32Array(n),
    b: new Uint8Array(n),
    dr: new Float32Array(n),
    lastX: new Float32Array(n).fill(Number.NaN),
    lastY: new Float32Array(n).fill(Number.NaN),
    lastF: new Float32Array(n).fill(-9),
    laneOff: 0,
    laneN: lane.length,
    nextOff: lane.length,
    nextN: next.length,
    colors,
    t0: startHp,
    subK: vh / holdPx,
    loose0: loosePx / vh,
    looseK: vh / (GLYPH_LOOSEN_PX * kPx),
    asm0: asmPx / vh,
    asmSpread: spreadPx / vh,
    flyK: vh / flyPx,
    done: Math.min(GLYPH_END, donePx / vh),
  };
  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    out.dx[i] = p[0]!;
    out.dy[i] = p[1]!;
    out.a[i] = p[2]!;
    out.b[i] = p[3]!;
    /* 일정은 **전 글자가 하나다.** 점마다 다른 것은 조립 순서뿐인데, 그 순서는
       어느 차의 어느 자리로 가느냐가 정하므로 프레임에서 계산한다(`drawCar`).
       여기서는 드리프트 방향과 순서의 흔들림만 굽는다. */
    out.dr[i] = rnd() * 2 - 1;
  }
  return out;
}

interface Column {
  /**
   * IDM 차량. 둘레 = SCENE_LEN 인 링 위를 돈다 — 씬과 주기가 같아 wrap 이 맞는다.
   *
   * **배열 순서를 신뢰하지 마라.** `step()` 은 차량이 0 을 넘어갈 때마다 배열을
   * 회전시켜 x 오름차순을 회복한다(idm.ts `rotateToOrigin`). 그래서 인덱스로
   * 차종·합류차·제어 AV 를 지목하면 한 바퀴 돌 때마다 다른 차를 가리킨다 —
   * 실제로 제어 AV 3대가 시간이 갈수록 6대로 불어났다. **`veh.id` 로 지목한다.**
   */
  veh: Vehicle[];
  /** 차로 중심 x(m) */
  x: number;
  /** +1 = 우리와 같은 방향, −1 = 마주 오는 방향 */
  dir: 1 | -1;
  /** 차종(SHAPES 인덱스). **`veh.id` 로 색인한다** — 배열 순서가 아니다. */
  shape: Uint8Array;
  /** 차로 안 좌우 치우침(m). 역시 `veh.id` 색인. */
  jog: Float32Array;
}

interface Ped {
  /** 월드 z(SCENE_LEN wrap) */
  z: number;
  x: number;
  /** 보행 속도(m/s). 부호가 진행 방향. */
  v: number;
  /** 키 배율 */
  h: number;
  /** 걸음 위상(rad) */
  ph: number;
  /** 서 있는 사람(정류장·신호 대기) — 0 이면 제자리 */
  idle: number;
}

interface Fleet {
  /** 자차(0) + 앞차들. 직선 도로. */
  vehicles: Vehicle[];
  shape: Uint8Array;
  jog: Float32Array;
  /** 옆 차로 + 마주 오는 차로 */
  cols: Column[];
  peds: Ped[];
  /** 시뮬 시각(s) — 주행거리 / 기준속도로만 흐른다. 스크롤이 멈추면 멈춘다. */
  t: number;
  accum: number;
  /** 자차가 기준 등속 궤적보다 뒤처진 거리(m). 도로 속도에 그대로 반영한다. */
  lag: number;
  /** 04막 — 우리 차로로 합류하는 옆 차로 차량(cols[0] 인덱스). −1 = 없음. */
  mergeIdx: number;
  /** 합류 진행도 0→1. 횡방향 위치만 움직인다(종방향은 IDM 이 그대로 푼다). */
  mergeK: number;
  /** 운전자 노이즈용 난수원. 결정적이라 새로고침해도 같은 교통이 나온다. */
  rng: () => number;
  /** 03막 — 배차되어 갓길에 정차하는 차량 */
  taxi: Taxi;
  /** 04막 — 뒷차가 간격을 내주는 세기 0→1 */
  yield: number;
}

/** 차종 추첨 — 세단이 다수, 승합이 소수. 도심 차종 구성에 맞춘다. */
const pickShape = (r: number): number => (r < 0.62 ? 0 : r < 0.88 ? 1 : 2);

/**
 * 운전자 한 사람. 같은 프리셋에서 출발하되 차두시간·정지간격을 흩뜨린다.
 * **간격 불규칙성의 출처가 여기다** — 위치 난수가 아니라 사람의 차이다.
 *
 * `want` 는 **희망속도**다. 프리셋의 기본값(30 m/s = 108 km/h)은 고속도로 값이라
 * 반드시 이 장면의 속도로 덮어써야 한다. 한 번 빠뜨렸더니 정체류로 배치한 대열이
 * 교란을 받은 뒤 108 km/h 를 향해 가속해 버렸고, 자차를 따라가는 카메라가
 * 도로보다 빨리 달아나 03막의 픽업 연출이 100m 밖으로 밀려났다(실측).
 */
const driver = (
  base: IDMParams,
  rnd: () => number,
  want: number,
  /**
   * 정지간격 배율의 범위. **사람과 ACC 는 다르다** — 사람은 정지했을 때 앞차와
   * 띄우는 거리가 사람마다 크게 다르지만(0.5~2.5배), ACC 는 설정된 간격을 그대로
   * 지킨다. 플래툰에 사람 폭을 그대로 줬더니 차간이 14~21m 로 벌어져, 선두가
   * 급제동해도 두 대 뒤에서 교란이 흡수되어 버렸다(02막의 연쇄가 거기서 끊겼다).
   */
  s0Lo = 0.5,
  s0Hi = 2.5,
  /** 차두시간 편차(±비율). 기본 ±5%. 배경 앞 대열은 ±12% — 아래 주석 참조. */
  tSpread = 0.05,
): IDMParams => ({
  ...base,
  /* **차두시간 T 는 거의 흔들지 않는다.** T 는 간격만 정하는 값이 아니라
     스트링 안정성을 정하는 값이다 — ±32% 로 흔들었더니 T 가 큰 차들이 교란을
     흡수해 버려서 파가 후미에 닿기도 전에 잦아들었다(실측: 후미 감속 0.0 km/h).
     연구실 TR-C 논문이 상용 ACC 에서 측정한 증폭은 T ≈ 1.7s 의 성질이고,
     그 값에서 멀어지면 재현되지 않는 다른 차를 시뮬레이션하는 것이 된다.

     간격의 불규칙성은 **정지간격 s0 에서 뽑는다.** s0 는 평형 간격에는 그대로
     들어가지만 안정성에는 영향이 없다 — 정확히 필요한 성질이다.
     (실제로도 사람마다 크게 다른 쪽은 정지했을 때 앞차와 띄우는 거리다.)

     **희망속도 v0 는 전원이 같다.** 한때 ±6% 흔들었는데, 열린 대열(링이 아닌
     플래툰)에서는 선두가 자기 v0 로 자유주행하고 뒤차의 v0 가 그보다 낮으면
     차간이 **끝없이 벌어진다.** 페이지를 한참 열어 두면 선두가 40m 앞에 가 있어
     급제동을 걸어도 뒷차가 반응할 이유가 없었다 — 02막의 연쇄가 통째로 사라졌다
     (실측으로 잡았다: gap=[14 12 15 **40**]). 같은 도로를 달리는 차들의 희망속도는
     애초에 같다고 보는 편이 맞다 — 다른 것은 차두시간과 정지간격이다. */
  T: base.T * (1 - tSpread + rnd() * 2 * tSpread),
  s0: base.s0 * (s0Lo + rnd() * (s0Hi - s0Lo)),
  v0: want,
});

/** IDM 평형 차두거리 — 이 값으로 배치해야 출발부터 과도응답이 없다. */
const equil = (p: IDMParams, v: number, len: number): number =>
  p.s0 + v * p.T + len;

/** 링 위의 한 줄. 간격은 운전자 차이에서 나오고, 배치도 그 평형에 맞춘다. */
function seedColumn(
  count: number,
  x: number,
  dir: 1 | -1,
  base: IDMParams,
  v0: number,
  seed: number,
): Column {
  const rnd = mulberry32(seed);
  const shape = new Uint8Array(count);
  const jog = new Float32Array(count);
  const params: IDMParams[] = [];
  const lens: number[] = [];
  for (let i = 0; i < count; i++) {
    const sh = pickShape(rnd());
    shape[i] = sh;
    lens.push(SHAPES[sh]!.len);
    params.push(driver(base, rnd, v0));
    jog[i] = (rnd() - 0.5) * 0.5;
  }
  // 평형 차두거리의 합이 둘레와 맞아떨어지도록 한 번 정규화한다. 그래야 출발
  // 직후에 전체가 우르르 감속하는 과도응답이 생기지 않는다.
  const gaps = params.map((p, i) => equil(p, v0, lens[(i + 1) % count]!));
  const total = gaps.reduce((s, g) => s + g, 0);
  const k = SCENE_LEN / total;
  const veh: Vehicle[] = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    veh.push(makeVehicle(i, pos, v0, "human", params[i]!, 0, lens[i]!));
    pos += gaps[i]! * k;
  }
  return { veh, x, dir, shape, jog };
}

function buildFleet(): Fleet {
  const rnd = mulberry32(0x0f1ee7);
  const v0 = FLEET_V;

  /* --- 자차 + 앞차 플래툰 (직선 도로, index 0 이 자차) --- */
  const n = FLEET_N + 1;
  const shape = new Uint8Array(n);
  const jog = new Float32Array(n);
  const params: IDMParams[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    const sh = pickShape(rnd());
    shape[i] = sh;
    lens.push(SHAPES[sh]!.len);
    // 앞차들은 상용 ACC — 연구실 TR-C 논문이 실측한 스트링 불안정의 주인공이다.
    // 앞차들은 상용 ACC — 간격 편차가 사람보다 훨씬 좁다.
    /* 차두시간 ±12%: ±5% 로는 간격이 ±1m 라 대열이 자로 잰 듯 보였다. ±32% 는
       파를 흡수해 02막이 죽는다(위 driver 주석). ±12% 는 간격 17~23m 로 눈에
       고르지 않으면서 전파 판정이 유지되는 값이다(stage:check 로 확인).
       자차(i = 0)는 잡음을 섞지 않는다 — 자차의 뒤처짐이 곧 도로 속도라, 잡음이
       그대로 화면 전체의 떨림이 된다. */
    const p = driver(PRESETS.accCommercial, rnd, v0, 0.72, 1.45, 0.12);
    params.push(i === 0 ? p : { ...p, noise: FLEET_NOISE });
    jog[i] = (rnd() - 0.5) * 0.44;
  }
  const vehicles: Vehicle[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) x += equil(params[i - 1]!, v0, lens[i]!);
    vehicles.push(makeVehicle(i, x, v0, "av", params[i]!, 0, lens[i]!));
  }

  /* --- 옆 차로: 사람 운전, 정체류. stop-and-go 파동이 **저절로** 자란다. --- */
  const cols: Column[] = [
    seedColumn(NEXT_N, LANE_NEXT, 1, PRESETS.human, 3.0, 0x2a71),
    // 마주 오는 두 줄 — 중앙분리대 건너편이라 자유류다.
    seedColumn(ONC_N, LANE_ONC[0]!, -1, PRESETS.human, 5.5, 0x3b82),
    seedColumn(ONC_N, LANE_ONC[1]!, -1, PRESETS.human, 5, 0x4c93),
  ];

  /* --- 인도 위의 사람들 --- */
  const peds: Ped[] = [];
  for (let i = 0; i < PED_N; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // 사람은 고르게 흩어지지 않는다 — 둘씩 걷고, 가끔 서 있다.
    const pair = i > 0 && rnd() < 0.34;
    const z = pair ? peds[i - 1]!.z + 0.7 + rnd() * 0.8 : rnd() * SCENE_LEN;
    const idle = rnd() < 0.22 ? 0 : 1;
    peds.push({
      z,
      x: side * (WALK_X + (rnd() - 0.5) * 2.4),
      v: idle * (rnd() < 0.5 ? -1 : 1) * (1.1 + rnd() * 0.5),
      h: 0.92 + rnd() * 0.16,
      ph: rnd() * TWO_PI,
      idle,
    });
  }

  return {
    vehicles,
    shape,
    jog,
    cols,
    peds,
    t: 0,
    accum: 0,
    lag: 0,
    mergeIdx: -1,
    mergeK: 0,
    rng: mulberry32(0x7a1f),
    taxi: {
      on: 0,
      dz: 0,
      z: 0,
      lastZ: Number.NaN,
      x: LANE_NEXT,
      shape: 0,
      brake: false,
      paxDz: 0,
      paxX: PAX_WAIT_X,
      paxPh: 0,
      paxGone: 0,
    },
    yield: 0,
  };
}

/* ------------------------------------------------------------------ *
 * 스윕 — 센서가 켜지는 연출
 * ------------------------------------------------------------------ */

/**
 * 회전 주기(초). HUD 표기는 실제 센서 스펙(10Hz)이지만 화면의 빔은 의도적으로
 * 느리다 — 10Hz 스트로브는 읽히지 않을 뿐 아니라 광과민성 위험이 있다.
 */
const SWEEP_PERIOD = 7.5;
/** 빔이 지나간 뒤 밝기 감쇠 시간상수. */
const TAU = 0.85;
const TAU_CUT = TAU * 4;

/* ------------------------------------------------------------------ *
 * 스크롤 → 주행
 * ------------------------------------------------------------------ */

/**
 * **스크롤 1px 당 주행 m — 체감 속도 손잡이.**
 * 여기 한 줄만 고치면 배경이 흐르는 속도가 바뀐다.
 * 0.052 → 문서 전체(≈4,300px)에 씬 약 1.9바퀴(≈224m). 0.04~0.07 이 쓸 만한 범위다.
 */
const M_PER_PX = 0.052;

/**
 * 착지 프레임(scrollY=0)의 씬 위치(m). 스크롤 없이 도착했을 때 보이는 한 장이
 * 사이트의 첫인상이라 임의의 지점에 두지 않는다 — 갠트리가 머리 위를 지나기
 * 직전, 노면표시가 전방에 깔리는 구간으로 고정했다.
 */
const Z0 = 10;

/**
 * 목표 camZ 추종 계수(60fps 1프레임 기준). 프레임률 독립으로 보정해서 쓴다 —
 * 30fps 모바일에서 다르게 느껴지면 안 된다. τ = 1/(0.10·60) ≈ 0.17s.
 */
const DAMP = 0.1;
/** 이보다 가까우면 목표에 딱 붙인다. 무한히 수렴만 하면 "정지"가 없다. */
const SNAP = 0.005;
/** 빔 게인을 살리는 기준 속도(m/s). */
const VEL_REF = 3;

/** 계측용으로 캔버스에 붙는 현재 카메라 상태(스크린샷 검증에서 읽는다). */
export interface RoadProbe {
  /** 문서 스크롤 진행도 0→1 */
  p: number;
  /** 주행거리(m) */
  z: number;
  /** 카메라 높이(m) */
  camY: number;
  /** 소실점의 화면 세로 위치(px) */
  horizon: number;
  /** 초점거리(px) */
  f: number;
  /** 커서가 만든 지향 — [조향 −1…1, 피치 −1…1, 롤(px/px), 주점 가로(px)] */
  aim: [number, number, number, number];
  /**
   * 이번 프레임에 실제로 구운 조용한 상자들 — [화면 x, y, w, h, 감쇠거리(px), 바닥] × n.
   *
   * 요소의 border box 가 아니라 **글줄 상자**라 검사기가 "감쇠가 닿지 않는 자리"를
   * 정확히 고를 수 있다. 동작 줄이기에서 스크롤해도 세계가 얼어 있는지를 재려면
   * 이 값이 필요하다 — 화면 폭짜리 구역의 rect 로 가늠하면 화면 전체가 후보에서
   * 빠져 검사가 공전한다(실제로 12,960칸 중 0칸이 남았다).
   */
  quietBoxes: number[];
  /** 카메라 상승 진행도 0→1 */
  rise: number;
  /** 차량 등장 진행도 0→1 */
  fleet: number;
  /** 이번 프레임에 화면에 그려진 차량 수 */
  cars: number;
  /** 차체 상자가 서로 파고든 쌍의 수 — 0 이어야 한다 */
  overlap: number;
  /** 가장 깊이 파고든 정도(m) */
  overlapDepth: number;
  /** 이번 프레임에 화면에 그려진 보행자 수 */
  peds: number;
  /** 막별 진행도 0→1 */
  acts: number[];
  /** 자차 앞 차간거리(m) — ACC 플래툰. 교란이 전파되려면 너무 벌어지면 안 된다 */
  gaps: number[];
  /** 옆 차로(사람 운전) 차간거리(m) — 간격이 실제로 불규칙한지 재는 창구 */
  gapsHuman: number[];
  /** 플래툰 각 차의 가속도(m/s²) — 제동 연쇄가 실제로 뒤로 전파되는지 본다 */
  accel: number[];
  /** 플래툰 각 차의 속도(km/h) */
  speed: number[];
  /** 옆 차로(정체류) 속도 표준편차(m/s) — 02막이 주장하는 stop-and-go 의 실측값 */
  waveSpread: number;
  /** 옆 차로 최저·최고 속도(km/h) */
  waveBand: [number, number];
  /** 02막 교란의 머리 — [파동이 닿은 차량(선두 1 … 자차 n), 전파 거리 m] */
  wave: [number, number];
  /** 03막 배차 차량 — [연출중, 차 거리 m, 차 횡위치 m, 승객 거리 m, 탑승완료] */
  pickup: number[];
  /** 04막에서 합류 중인 차량(cols[0] 인덱스)과 그 진행도 */
  merge: number;
  mergeK: number;
  /**
   * 첫 화면 글자 → 차체 점 연출. 스크린샷만으로는 "안 움직인다"와 "미세하게
   * 움직인다"를 가를 수 없어 따로 낸다.
   */
  morph: {
    /** 구운 글자 점 수 */
    n: number;
    /** 평균 **이산** 진행도 0(글자 자리) → 1(차체). 치환 구간에서는 0 이다. */
    e: number;
    /** 평균 구간 진행도(치환+이산). 치환이 도는 중인지 보는 창구 */
    raw: number;
    /** 이번 프레임에 찍은 글자 점의 평균 화면 이동거리(px). 치환 중에는 0 */
    move: number;
    /** 화면 위끝 밖으로 밀려 안 그려진 글자 점 수 */
    clipTop: number;
    /** 이번 프레임에 찍은 글자 점 중 **목표 차 상자 안**에 든 비율 0…1 (유령 윤곽) */
    ghost: number;
    /** 차체 색으로 갈아탄 글자 점의 비율 0…1 */
    swapped: number;
    /** `hp` 의 자(px) — 여는 화면의 실제 길이 */
    span: number;
    /** 전 글자 공통 일정(스크롤 px) — [치환 시작, 치환 끝, 조립 시작, 도착] */
    t: [number, number, number, number];
    /** 그린 글자 점의 상태 비율 — 글자 자리 · 공중 · 앉음 (합 1) */
    stay: number;
    air: number;
    land: number;
    /** 공중에 있는 글자 점의 **프레임당 화면 이동량**(px) — 평균 / 최대 */
    stepAvg: number;
    stepMax: number;
    /** 한 프레임에 12px 넘게 튄 점의 수 */
    stepBig: number;
    /** 완충된 재생 헤드 0…1 */
    hp: number;
    /** 이번 프레임에 차에 자리 잡은 점 */
    seated: number;
    /** 자리를 못 얻어 흩어지는 점 */
    lost: number;
    /** 무리별 글자 점 수 [우리 차로, 옆 차로] */
    group: [number, number];
    /** 차마다 받은 점 — 우리 차로(앞차 1…5) · 옆 차로(id 순) */
    lane: number[];
    next: number[];
  };
  /** 이번 프레임에 실제로 찍은 점 수 */
  pts: number;
  /** 씬 총 점 수(정적 + 근거리) */
  total: number;
}

interface LoopState {
  /** 절대 주행거리(m). 스크롤 목표를 감쇠 추종한다. */
  camZ: number;
  /** 직전 프레임의 camZ — 속도(빔 게인·서스펜션) 계산용 */
  prevZ: number;
  /** 직전 프레임의 스크롤 주행거리(m) — 시뮬 시간을 흘리는 데 쓴다 */
  prevScrollZ: number;
  /** 무대에 서 있는 동안 스스로 달린 거리(m). 스크롤 주행거리에 더해진다. */
  selfZ: number;
  phase: number;
  beamX: number; // NaN = 직전 프레임에 빔이 가시 섹터 밖
  started: boolean;
  /** 첫 프레임에는 스크롤 위치를 그대로 물려받는다(새로고침 복원 대응) */
  init: boolean;
  /** 캔버스가 비었다(리사이즈 등) — 정지 중이라도 한 장 다시 그린다 */
  dirty: boolean;
  /** 마지막으로 실제 그린 상태 — 완전 정지 시 프레임을 통째로 건너뛴다 */
  drawnZ: number;
  drawnBoost: number;
  drawnRise: number;
  drawnFleet: number;
  /** 마지막으로 그린 조향. 커서가 움직였으면 카메라가 멈춰 있어도 그림이 다르다. */
  drawnSteer: number;
  drawnPitch: number;
  /** 마지막으로 그린 히어로 퇴장 진행도 — 글자가 풀리는 중이면 그림이 다르다 */
  drawnH: number;
  /** 글자 점을 다시 구워야 한다(리사이즈·글꼴 도착) */
  glyphStale: boolean;
  /** 글꼴이 도착한 뒤 한 번 더 구웠는가 — 굽는 시점이 이르면 대체 글꼴 모양이 굳는다 */
  glyphFonts: boolean;
  /** 마지막으로 구운 때의 뷰포트 — 폭·높이가 달라지면 글자 자리가 달라진다 */
  glyphW: number;
  glyphH: number;
  /** `hp` 의 자(px) — 여는 화면의 실제 길이. 달라지면 글자 일정을 다시 굽는다 */
  hpSpan: number;
  glyphSpan: number;
  /** 붙어 있는 첫 화면 상자의 화면 위치 — 글자 점 좌표의 원점. NaN = 아직 모름 */
  inkLeft: number;
  inkTop: number;
  /** 완충된 재생 헤드. 음수 = 아직 모름(첫 프레임에 목표로 붙인다) */
  hpS: number;
  /** 완충된 스크롤 위치(px). 도로가 쓰는 모든 값이 여기서 나온다. 음수 = 아직 모름 */
  scrollS: number;
  /** 그린 프레임 번호 — 계측 전용 */
  frameN: number;
  /** 마지막으로 CSS 변수에 흘려보낸 값 — 안 바뀌면 DOM 을 건드리지 않는다 */
  cssH: number;
  cssP: number;
  cssV: number;
  /** 막별 진행도(`--a0`…`--a3`)의 직전 값 */
  cssA: Float64Array;
  /** 근거리 대역 — 직전 프레임의 [시작, 길이](카메라가 오르면 선형 재사상한다) */
  relZ0: Float64Array;
  relSpan: Float64Array;
  /** 문서 스크롤 가능 높이(px) — 매 프레임 재는 대신 주기적으로 갱신한다 */
  docRange: number;
  docAt: number;
  /** 연구 무대의 기준 요소와 그 안의 네 막 */
  phaseEl: Element | null;
  actEls: Element[];
  /**
   * 가로 덱. 있으면 막의 재생 헤드가 세로 스크롤이 아니라 **가로 넘김**이다.
   * 없으면(예전 세로 무대) 지금까지대로 막의 화면 위치로 잰다.
   */
  deckEl: HTMLElement | null;
  phaseAt: number;
  /** 본문이 앉는 자리 — 여기서 점이 성겨진다. 글줄 상자는 요소 기준으로 캐시한다 */
  quiet: QuietEl[];
  /** 이번 프레임에 글줄을 다시 잰 요소가 있는가 — 한 프레임에 하나만 잰다 */
  inkAt: number;
  /** 이번 프레임에 구운 상자들(검사기용). `roadProbe.quietBoxes` 로 나간다 */
  quietBoxes: number[];
  /**
   * 01막 증폭률의 재료. 기준 속도는 **교란이 시작되는 그 순간** 잡는다 —
   * 고정 상수나 특정 진행도에서 잡으면 직전 파동이 지나가는 중일 수 있다.
   */
  ampLeadBase: number;
  ampRearBase: number;
  ampLead: number;
  ampRear: number;
  /** 직전 프레임에 교란이 걸려 있었는가 — 시작 순간(상승 에지)을 잡는다 */
  brakePrev: boolean;
  /** 교란이 닿은 가장 뒤 차량 번호(0 = 자차). 파동의 머리다. */
  waveFront: number;
  /** 교란이 전파된 거리(m) — 선두에서 파동 머리까지 */
  waveReach: number;
  /** 교란 재무장 — 연구 구간을 벗어났다 돌아오면 다시 한 번 밟는다 */
  waveArmed: boolean;
  waveT: number;
}

/* ------------------------------------------------------------------ *
 * 훅
 * ------------------------------------------------------------------ */

export interface PointCloudOptions {
  /** 화면 밖이면 rAF 를 멈출 대상. 고정 배경이므로 보통 캔버스 자신이다. */
  target?: RefObject<Element | null>;
  /** true 면 스캔이 이미 끝난 정지 프레임 1장만 그린다. */
  reducedMotion?: boolean;
}

/**
 * 캔버스에 LiDAR 점군 도로를 그린다. **스크롤이 주행을 만든다.**
 *
 * React state 를 일절 쓰지 않는다 — 전부 ref + 캔버스 직접 그리기.
 * 스크롤도 scroll 이벤트가 아니라 rAF 안에서 `window.scrollY` 로 읽는다.
 * 성능 예산: 데스크톱 ≈ 12,000점 / 모바일 ≈ 3,200점, DPR 상한 2, 모바일 30fps.
 */
export function usePointCloud(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { target, reducedMotion = false }: PointCloudOptions = {},
): void {
  const sceneRef = useRef<Scene | null>(null);
  const relRef = useRef<RelLayer | null>(null);
  const carRef = useRef<CarViews[] | null>(null);
  const pedRef = useRef<PedTemplate | null>(null);
  /** 막별 진행도 0→1 과 그 원본 위치 `t`. 프레임마다 덮어쓴다 — 할당은 한 번뿐이다. */
  const actRef = useRef<Float64Array>(new Float64Array(ACTS));
  const actTRef = useRef<Float64Array>(new Float64Array(ACTS));
  /** 막 **안에서의** 연출 진행도. 세로 무대에서는 actT 와 같고, 덱에서는 주행거리로 흐른다. */
  const actURef = useRef<Float64Array>(new Float64Array(ACTS));
  /** 무대 여부를 빼고 **패널 위치만** 본 값. CSS(`--a0`…)와 카메라 혼합비가 쓴다. */
  const actRawRef = useRef<Float64Array>(new Float64Array(ACTS));
  /** 연출이 예약한 자리(배차 차량·합류차) — 최대 2개. 프레임마다 덮어쓴다. */
  const resRef = useRef<Float64Array>(new Float64Array(4 * 4));
  const fleetRef = useRef<Fleet | null>(null);
  const palRef = useRef<Palette | null>(null);
  /** 첫 화면 글자에서 뜯어낸 점군. 없는 페이지(홈 말고)에서는 계속 null 이다. */
  const glyphRef = useRef<Glyphs | null>(null);
  /**
   * 글자 점을 받을 차들 — 차마다 [글자 점 시작, 개수]. 프레임마다 덮어쓴다.
   * 옆 차로는 링이라 배열이 회전하므로 **`veh.id` 로 색인한다**.
   */
  const slotRef = useRef({
    laneOff: new Int32Array(FLEET_N + 1),
    laneN: new Int32Array(FLEET_N + 1),
    nextOff: new Int32Array(NEXT_N),
    nextN: new Int32Array(NEXT_N),
    /** 옆 차로를 가까운 순서로 본 id 목록. 연출이 도는 동안에는 얼려 둔다. */
    order: new Int32Array(NEXT_N),
    ordered: false,
    /** 자리를 못 얻어 흩어질 점의 구간 [시작, 끝) × 2무리 */
    lost: new Int32Array(4),
    /** 나눗셈 스크래치 — 그 차의 LOD · 배정량 */
    lods: new Int32Array(Math.max(FLEET_N + 1, NEXT_N)),
    take: new Int32Array(Math.max(FLEET_N + 1, NEXT_N)),
    /** 글자를 받기로 **정해 둔** 차 — 가까운 순서. 연출이 도는 동안 얼려 둔다. */
    laneIds: new Int32Array(FLEET_N + 1),
    laneK: 0,
    nextIds: new Int32Array(NEXT_N),
    nextK: 0,
  });
  const stateRef = useRef<LoopState>({
    camZ: 0,
    prevZ: 0,
    prevScrollZ: 0,
    phase: -1,
    beamX: Number.NaN,
    started: false,
    init: false,
    dirty: true,
    drawnZ: Number.NaN,
    drawnBoost: Number.NaN,
    drawnRise: Number.NaN,
    drawnFleet: Number.NaN,
    drawnSteer: Number.NaN,
    drawnPitch: Number.NaN,
    drawnH: Number.NaN,
    glyphStale: true,
    glyphFonts: false,
    glyphW: -1,
    glyphH: -1,
    hpSpan: 1,
    glyphSpan: -1,
    inkLeft: Number.NaN,
    inkTop: Number.NaN,
    hpS: -1,
    scrollS: -1,
    frameN: 0,
    cssH: Number.NaN,
    cssP: Number.NaN,
    cssV: -1,
    cssA: new Float64Array(ACTS).fill(-1),
    relZ0: Float64Array.from(REL_BANDS.map((_, b) => relLo(b, 2))),
    relSpan: Float64Array.from(
      REL_BANDS.map((_, b) => Math.max(0.5, relHi(b, 2) - relLo(b, 2))),
    ),
    docRange: 0,
    docAt: -1,
    selfZ: 0,
    phaseEl: null,
    actEls: [],
    deckEl: null,
    quiet: [],
    inkAt: -1,
    quietBoxes: [],
    ampLeadBase: Number.NaN,
    ampRearBase: Number.NaN,
    ampLead: Number.NaN,
    ampRear: Number.NaN,
    brakePrev: false,
    waveFront: Number.NaN,
    waveReach: 0,
    phaseAt: -1,
    waveArmed: true,
    waveT: Number.NaN,
  });
  const bufRef = useRef<{
    vsx: Int32Array;
    vsy: Int32Array;
    vps: Int32Array;
    vbin: Int32Array;
    ssx: Int32Array;
    ssy: Int32Array;
    sps: Int32Array;
    binCount: Int32Array;
    binEnd: Int32Array;
    /** 카울(대시보드) 실루엣의 화면 세로 위치 — 열 단위 룩업 */
    cowl: Float32Array;
    /** 화면 격자별 감쇠 계수(1 = 그대로, QUIET_FLOOR = 가장 조용) */
    quiet: Float32Array;
    /** 그린 차량의 점유 상자 — 겹침 검사 */
    boxZ: Float32Array;
    boxX: Float32Array;
    boxL: Float32Array;
    boxW: Float32Array;
  } | null>(null);

  // 모바일 판정은 마운트 시 한 번. 점 예산·fps 상한을 결정한다.
  const mobileRef = useRef<boolean | null>(null);
  if (mobileRef.current === null) {
    mobileRef.current =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 900px), (pointer: coarse)").matches
        : false;
  }
  const mobile = mobileRef.current;

  /**
   * 지향. `t*` 는 리스너가 적는 목표, 나머지는 프레임이 뒤따라간 값이다.
   * `x`·`y` 는 화면 비율(0…1)이라 DPR·리사이즈와 무관하고, `k` 는 커서가 창 안에
   * 있는 정도 — 나가면 0 으로 풀려 차가 차로 한가운데로, 시선이 수평으로 돌아온다.
   */
  const aimRef = useRef({ tx: 0.5, ty: 0.5, tk: 0, x: 0.5, y: 0.5, k: 0 });

  /** 대역별 [시작, 길이] 스크래치 — 프레임마다 새로 할당하지 않는다. */
  const lo1 = useRef(new Float64Array(REL_BANDS.length)).current;
  const sp1 = useRef(new Float64Array(REL_BANDS.length)).current;

  const drawRef = useRef<(dt: number, elapsed: number) => void>(() => {});
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const elapsedRef = useRef(0);
  /** 정지 프레임 다시 그리기 예약 id. 0 = 예약 없음. */
  const stillRafRef = useRef(0);

  /* ------------------------------------------------------------------ *
   * 정지 프레임 다시 그리기 (동작 줄이기 전용)
   *
   * 동작 줄이기에서 `useRafLoop` 은 콜백을 **딱 한 번** 부르고 멈춘다. 그래서
   * 도로가 한 장으로 굳는데, `data-quiet` 감쇠는 화면 좌표로 굽는 것이라
   * 스크롤하면 글과 어긋난다 — 본문이 만점군 위에 그대로 얹힌다.
   *
   * **세계를 움직이는 것이 아니라 마스크를 따라오게 하는 것이다.** 이 경로로
   * 다시 그려도 카메라 z·차량·스윕·막은 전부 얼어 있다(`still` 분기가 전부
   * 잠근다). 달라지는 것은 글이 앉은 자리의 감쇠뿐이고, 그건 연출이 아니라
   * 가독성 장치다.
   *
   * 리스너는 **예약만 한다** — 레이아웃을 읽지 않는다. 스크롤 이벤트가 아무리
   * 많이 와도 rAF 하나로 뭉쳐져 한 프레임에 한 장만 그려진다.
   * ------------------------------------------------------------------ */
  const redrawStill = (): void => {
    if (stillRafRef.current) return;
    stillRafRef.current = requestAnimationFrame(() => {
      stillRafRef.current = 0;
      if (!reducedRef.current) return;
      // 조용해질 자리가 달라졌다 — "정지 프레임은 통째로 건너뛴다" 판정을 연다.
      stateRef.current.dirty = true;
      /* 시각은 실제로 흘려보낸다. dt 는 0 이라 세계는 한 틱도 나아가지 않지만,
         글줄 상자 재측정 주기(`QUIET_INK_TTL`)와 문서 높이 갱신이 `elapsed` 의
         **차이**로 돌아가기 때문에 0 으로 고정하면 그것들이 영영 안 돈다. */
      elapsedRef.current = performance.now() / 1000;
      drawRef.current(0, elapsedRef.current);
    });
  };

  const view = useCanvas2D(canvasRef, {
    maxDpr: 2,
    alpha: false,
    onResize: (v: Canvas2DView) => {
      // 버퍼를 다시 잡으면 화면이 비므로 정지 상태에서도 한 장 다시 그려야 한다.
      stateRef.current.dirty = true;
      stateRef.current.docAt = -1;
      // 재조판되면 글자가 앉은 자리가 통째로 달라진다 — 다시 굽는다.
      stateRef.current.glyphStale = true;
      if (reducedRef.current && v.ctx) redrawStill();
    },
  });

  const draw = (dt: number, elapsed: number): void => {
    const v = view.current;
    const ctx = v.ctx;
    if (!ctx) return;

    const W = v.width;
    const H = v.height;
    if (W < 4 || H < 4) return;

    elapsedRef.current = elapsed;

    /* 예산은 두 단계다(`hi = budget > 5000`). 모바일 쪽 값은 2016년식 폰을
       기준으로 잡은 것이라 지금 기기에서는 지나치게 성겼다 — 데스크톱이 29,337점일
       때 모바일은 4,400점이어서 **도로가 거의 안 보였다**(히어로 밝은픽셀 1.8% 대
       7.3%). 이 사이트의 전제가 배경인데 전화에서는 그 전제가 사라져 있었다.
       모바일 층의 개수·간격을 따로 올려 약 12,000점으로 맞췄다. 30fps 상한이
       걸려 있어 프레임 예산은 데스크톱의 두 배다. */
    const budget = mobile ? 2500 : 9000;
    const scene = sceneRef.current ?? (sceneRef.current = buildScene(budget));
    const rel = relRef.current ?? (relRef.current = buildRelLayer(budget));
    const cars = carRef.current ?? (carRef.current = buildCars());
    const ped = pedRef.current ?? (pedRef.current = buildPed());
    const fleet = fleetRef.current ?? (fleetRef.current = buildFleet());

    /* 차로 안의 느린 횡방향 흔들림(`WANDER_*`). 두 주기의 사인을 겹쳐 6~15초에
       ±수 cm 를 오간다. 시뮬 시각(`fleet.t`)을 쓰므로 스크롤이 멈추면 같이 멈춘다.
       **그리기·겹침 상자·V2V 링크·합류 목표가 전부 이 값을 쓴다** — 한 곳만 고정
       오프셋을 쓰면 링크가 차 옆구리를 가리킨다. */
    const wander = (seed: number, amp: number): number => {
      const ph = seed * 2.399963;
      const w1 = 0.45 + 0.09 * (seed % 5);
      const w2 = 0.17 + 0.04 * (seed % 3);
      return amp * (0.7 * Math.sin(fleet.t * w1 + ph) + 0.3 * Math.sin(fleet.t * w2 + ph * 1.7));
    };
    /** 우리 차로 k 번째. 자차(0)는 흔들지 않는다 — 카메라가 그 차다. */
    const laneOf = (k: number): number =>
      LANE_X + fleet.jog[k]! + (k === 0 ? 0 : wander(k, WANDER_ACC));
    /** 옆 차로·마주 오는 차로(사람 운전). `id` 로 색인한다 — 링은 배열이 돈다. */
    const colLane = (ci: number, col: Column, id: number): number =>
      col.x + col.jog[id]! + wander(11 + ci * 17 + id, WANDER_HUMAN);
    const pal = palRef.current ?? (palRef.current = buildPalette());
    const actK = actRef.current;
    const actT = actTRef.current;
    const actU = actURef.current;
    const actRaw = actRawRef.current;
    const resZBuf = resRef.current.subarray(0, 4);
    const resXBuf = resRef.current.subarray(4, 8);
    const resLBuf = resRef.current.subarray(8, 12);
    const resWBuf = resRef.current.subarray(12, 16);
    const n = scene.n;
    /** 화면에 동시에 설 수 있는 차량·사람의 상한. 실제로는 LOD 가 훨씬 먼저 자른다. */
    const carMax = Math.max(...cars.map((c) => Math.max(c.rear.n, c.front.n)));
    const actors = FLEET_N + 1 + NEXT_N + ONC_N * 2;
    const cap =
      n + rel.n + actors * carMax + PED_N * ped.n + ANNO_CAP + GLYPH_MAX;

    let buf = bufRef.current;
    if (!buf || buf.vsx.length < cap) {
      buf = {
        vsx: new Int32Array(cap),
        vsy: new Int32Array(cap),
        vps: new Int32Array(cap),
        vbin: new Int32Array(cap),
        ssx: new Int32Array(cap),
        ssy: new Int32Array(cap),
        sps: new Int32Array(cap),
        binCount: new Int32Array(BINS),
        binEnd: new Int32Array(BINS),
        cowl: new Float32Array(COWL_COLS + 1),
        boxZ: new Float32Array(64),
        boxX: new Float32Array(64),
        boxL: new Float32Array(64),
        boxW: new Float32Array(64),
        quiet: new Float32Array(QW * QH),
      };
      bufRef.current = buf;
    }

    const st = stateRef.current;
    const still = reducedRef.current;

    /* --- 커서 = 센서의 지향 (뒤따라가기) -------------------------------- */
    const aim = aimRef.current;
    {
      const kTau = dt > 0 ? 1 - Math.exp(-dt / STEER_TAU) : 1;
      aim.x += (aim.tx - aim.x) * kTau;
      aim.y += (aim.ty - aim.y) * kTau;
      aim.k += ((still ? 0 : aim.tk) - aim.k) * kTau;
      /* 지수 감쇠는 목표에 **영원히 닿지 않는다.** 그대로 두면 아래의 정지 판정이
         매 프레임 1e-9 만큼 어긋나 영원히 다시 그린다 — 커서를 한 번 움직인 뒤로
         페이지가 계속 60fps 를 태운다. 충분히 가까워지면 붙인다.
         **새 축을 더하면 여기와 아래 정지 판정 양쪽에 반드시 같이 넣는다.** */
      if (Math.abs(aim.tx - aim.x) < 2e-4) aim.x = aim.tx;
      if (Math.abs(aim.ty - aim.y) < 2e-4) aim.y = aim.ty;
      const tk = still ? 0 : aim.tk;
      if (Math.abs(tk - aim.k) < 2e-4) aim.k = tk;
    }
    /** 조향 −1(왼쪽)…+1(오른쪽). 커서가 없으면 정확히 0 이다. */
    const steer = (aim.x * 2 - 1) * aim.k;
    /**
     * 피치 −1(아래를 본다)…+1(위를 본다). 위쪽은 하늘만 늘어나므로 절반만 쓴다.
     * 커서가 없으면 정확히 0 — 정지 판정이 다시 서려면 이 값이 **정확히** 0 이어야 한다.
     */
    const aimUp = (0.5 - aim.y) * 2 * aim.k;
    const pitch = aimUp > 0 ? aimUp * STEER_PITCH_UP : aimUp;

    /* --- 스크롤 읽기 --------------------------------------------------
       스크롤은 오직 여기, rAF 안에서만 읽는다. scroll 리스너도 setState 도 없다.
       문서 전체가 주행 구간이다 — 히어로부터 푸터의 주소까지.             */
    const scrollRaw = still ? 0 : window.scrollY || window.pageYOffset || 0;
    /* **스크롤 입력에 완충을 건다.** 휠 한 칸은 브라우저가 계단으로 보내는데, 그
       계단을 도로가 그대로 받으면 화면 대부분(도로)이 뚝뚝 끊긴다("휠 내릴 때마다
       뚝뚝 끊기는 느낌" — 교수님). 스크롤 하이재킹이 아니다: 문서는 브라우저가
       평소대로 굴리고 **도로가 그 값을 시간상수로 뒤따를 뿐**이라, 접근성도
       네이티브 스크롤도 그대로다.

       "스크롤이 멈추면 도로도 멈춘다"는 지켜진다 — 멈춘 뒤 τ 몇 배 안에 0.5px
       안으로 들어오면 **스냅**해서 정지 프레임 건너뛰기가 다시 선다. */
    if (still || st.scrollS < 0) st.scrollS = scrollRaw;
    else {
      const scrollTau = mobile ? SCROLL_TAU_TOUCH : SCROLL_TAU;
      st.scrollS += (scrollRaw - st.scrollS) * (dt > 0 ? 1 - Math.exp(-dt / scrollTau) : 1);
      if (Math.abs(scrollRaw - st.scrollS) < 0.5) st.scrollS = scrollRaw;
    }
    const scrollY = st.scrollS;
    /** 실제 스크롤이 완충된 값보다 앞서 간 거리(px). rect 를 이만큼 되돌린다. */
    const scrollLag = scrollRaw - scrollY;

    // 문서 높이는 매 프레임 재지 않는다(레이아웃 강제). 0.3초마다 갱신하면 충분하다.
    if (st.docAt < 0 || elapsed - st.docAt > 0.3) {
      st.docAt = elapsed;
      st.docRange = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
    }
    const p = clamp01(scrollY / st.docRange);

    /* --- 연구 무대 진행도 ---------------------------------------------
       문서 비율이 아니라 **연구 섹션의 실제 뷰포트 위치**로 잡는다. 언어·콘텐츠
       길이가 달라도 "연구가 시작되는 순간"에 정확히 걸린다.

       두 값을 뽑는다. `approach` 는 무대가 다가오는 진행도(차들이 등장한다),
       `stageP` 는 무대 **안에서의** 진행도(4개 주제가 차례로 펼쳐진다).
       레이아웃 강제를 피하려고 getBoundingClientRect 는 프레임당 **한 번**만
       부르고, 4개 막은 이 하나의 값에서 산술로 나눈다(각 막의 높이가 같다). */
    if (
      (!st.phaseEl || !st.quiet.length) &&
      (st.phaseAt < 0 || elapsed - st.phaseAt > 1)
    ) {
      st.phaseAt = elapsed;
      st.phaseEl = document.querySelector("[data-road-stage]");
      st.actEls = st.phaseEl
        ? [...st.phaseEl.querySelectorAll("[data-act]")]
        : [];
      st.deckEl = st.phaseEl
        ? st.phaseEl.querySelector<HTMLElement>("[data-deck]")
        : null;
      st.quiet = [...document.querySelectorAll("[data-quiet]")].map((el) => ({
        el,
        floor:
          el.getAttribute("data-quiet") === "panel" ? QUIET_DEEP : QUIET_FLOOR,
        soft:
          el.getAttribute("data-quiet") === "panel"
            ? QUIET_SOFT_PANEL
            : QUIET_SOFT,
        /* 첫 화면의 글 상자. 글이 점으로 바뀌는 만큼 감쇠가 **풀린다** — 붙어 있는
           상자라 글이 사라진 뒤에도 자리는 그대로여서, 안 풀면 도로 왼쪽이 연출
           내내 어둡다. 글자 점의 화면 좌표도 이 상자에서 나온다. */
        ink: el.getAttribute("data-quiet") === "ink",
        bw: Number.NaN,
        bh: Number.NaN,
        at: -1,
        box: new Float64Array(QUIET_INK_MAX * 4),
        n: 0,
      }));
    }

    /* 각 막의 진행도는 **그 막의 DOM 요소에서 직접** 잰다. 무대 높이를 4등분하는
       산술로는 글과 배경이 어긋난다 — 머리말·꼬리말·sticky 오프셋이 끼어 있어서
       "네 번째 글이 화면에 붙어 있는데 배경은 벌써 세 번째" 같은 일이 생긴다.
       `t` 는 그 막이 화면 30% 선(글이 붙는 자리)을 지나는 진행도다: 0 = 막이 막
       올라선 순간, 1 = 다음 막에 자리를 넘기는 순간. 위아래로 넘어갈 수 있다.

       rect 읽기는 프레임당 여기 한 곳뿐이고, CSS 변수 쓰기보다 **앞**에 있다 —
       읽기·쓰기가 번갈아 일어나면 프레임마다 강제 리플로가 생긴다.            */
    let approach = 0;
    /** 무대 상단의 문서 y(px). 0 이하면 무대가 없는 페이지다. */
    let stageDocY = 0;
    /** 덱의 가로 스크롤 위치(px). 세로 무대면 0 — 아래에서 주행거리에 더해진다. */
    let deckX = 0;
    /** 덱 모드의 시점 진행도. 세로 무대면 음수로 남아 무시된다. */
    let deckRise = -1;
    const line = H * 0.3;
    for (let i = 0; i < ACTS; i++) actT[i] = Number.NEGATIVE_INFINITY;
    if (st.phaseEl) {
      const r = st.phaseEl.getBoundingClientRect();
      /* 무대 상단의 **문서 좌표** — 여는 화면의 길이가 곧 이 값이다(아래 hp).
         rect 는 실제 스크롤 기준이라, 도로가 쓰는 값은 완충된 시계로 되돌린다
         (`scrollLag` 만큼 아래에 있었던 셈). */
      stageDocY = r.top + scrollRaw;
      // 무대 상단이 뷰포트 바닥에 닿으면 0, 뷰포트 상단까지 올라오면 1
      approach = clamp01((H - (r.top + scrollLag)) / Math.max(1, H));
      const deck = st.deckEl;
      if (deck) {
        /* 가로 덱 — 재생 헤드가 **넘김**이다. `t` 는 그 패널이 제자리에서 얼마나
           밀려났는가다: 0 = 무대 정중앙, ±1 = 이웃에게 자리를 넘긴 상태.

           rect 가 아니라 scrollLeft/offsetLeft 로 잰다. 트랙 안쪽 여백이나 스냅
           패딩이 끼어들어도 **이웃 패널과의 차이**는 그대로라 값이 흔들리지 않는다. */
        deckX = deck.scrollLeft;
        const p0 = st.actEls[0] as HTMLElement | undefined;
        const p1 = st.actEls[1] as HTMLElement | undefined;
        const stride = Math.max(
          1,
          p0 && p1 ? p1.offsetLeft - p0.offsetLeft : deck.clientWidth,
        );
        const x0 = p0 ? p0.offsetLeft : 0;
        for (let i = 0; i < st.actEls.length && i < ACTS; i++) {
          actT[i] =
            (deckX - ((st.actEls[i] as HTMLElement).offsetLeft - x0)) / stride;
        }
        /* 시점은 덱이 화면에 **얼마나 들어와 있는가**가 정한다 — 가로 넘김과는
           무관해야 "옆으로 넘겼더니 카메라가 내려앉는" 일이 없다.

           스크롤 위치가 아니라 **가시량**으로 잡는 이유: 들어오는 길과 나가는 길이
           저절로 같은 길이가 된다. 예전에는 세로 여유 상자의 위끝으로 올라오고
           아래끝으로 내려가는 것을 쟀는데, 상자가 덱보다 두 배 길어 내려오는 구간이
           올라가는 구간보다 짧았다 — 카메라가 오를 때는 떠오르고 내려올 때는
           **떨어지듯** 내려왔다(실측: 상승 525px 대 하강 450px, 최대 변화율 1.15배).
           sticky 로 붙어 있든 아니든(좁은 화면) 같은 식이 그대로 통한다. */
        const dr = deck.getBoundingClientRect();
        const seen = Math.min(dr.bottom, H) - Math.max(dr.top, 0);
        deckRise = smooth(clamp01(seen / Math.max(1, Math.min(dr.height, H))));
      } else {
        for (let i = 0; i < st.actEls.length && i < ACTS; i++) {
          const ar = st.actEls[i]!.getBoundingClientRect();
          actT[i] = (line - (ar.top + scrollLag)) / Math.max(1, ar.height);
        }
      }
    } else if (still) {
      approach = 1;
    }

    /* --- 히어로 카피 퇴장 진행도 --------------------------------------
       **여는 화면의 실제 길이에 묶는다.** 한때 `0.85 × 창높이` 로 고정했는데,
       그러면 여는 화면을 늘려도 연출은 그대로 첫 화면 안에서 끝나 버린다 —
       글자가 점이 되어 차로 가는 데 스크롤 몇 번을 쓰게 하려면 이 자가 늘어나야
       한다. 무대 상단의 **문서 좌표**를 자로 쓰면, 여는 화면을 CSS 로 늘린 만큼
       연출도 같이 늘어난다(마크업이 척도를 정하고 훅은 따라간다).

       빼는 0.15H 는 무대가 화면에 들어서기 전에 hp 가 1 이 되게 하는 여유다 —
       연출이 무대 진입과 겹치면 두 가지가 동시에 일어난다.

       무대가 없는 페이지(연구·논문…)에는 여는 화면도 없다. 예전 자로 폴백한다.
       rect 는 위에서 이미 한 번 읽었다 — 여기서 DOM 을 다시 읽지 않는다. */
    st.hpSpan =
      stageDocY > 0
        ? Math.max(1, stageDocY - H * 0.15)
        : Math.max(1, window.innerHeight * 0.85);
    /* **재생 헤드에는 시간 완충이 있다.** 스크롤 이벤트는 휠 한 칸을 100~200ms 에
       걸쳐 계단으로 보내는데, 그 계단을 그대로 진행도로 쓰면 글자 점이 프레임마다
       툭툭 건너뛴다. 목표는 스크롤에서 읽고 실제 값은 시간상수로 뒤따른다.

       **도로(`camZ`)에는 걸지 않는다.** "스크롤이 곧 주행"은 도로의 규칙이고,
       여기서 무르게 하는 것은 **글자의 재생 헤드뿐**이다.

       지수 감쇠는 목표에 영원히 닿지 않으므로 충분히 가까워지면 붙인다 — 안 그러면
       "정지 프레임은 통째로 건너뛴다" 판정이 영영 서지 않는다(§커서 = 센서의 지향
       과 같은 이유). */
    const hpTarget = clamp01(scrollY / st.hpSpan);
    if (still || st.hpS < 0) st.hpS = hpTarget;
    else {
      st.hpS += (hpTarget - st.hpS) * (dt > 0 ? 1 - Math.exp(-dt / HP_TAU) : 1);
      if (Math.abs(hpTarget - st.hpS) < 1e-4) st.hpS = hpTarget;
    }
    const hp = st.hpS;

    /* --- 조용한 영역 굽기 -------------------------------------------
       `data-quiet` 요소 **안의 글줄이 앉은 자리**에서 점의 알파를 떨어뜨린다.
       상자마다 점을 검사하면 비싸므로 거친 격자에 미리 구워 두고 점은 한 번만
       조회한다. 감쇠는 상자 **밖으로** 부드럽게 풀린다 — 변이 드러나지 않게.

       읽기는 전부 여기서 끝낸다. 아래의 CSS 커스텀 프로퍼티 쓰기보다 **앞**이라
       읽기·쓰기가 번갈아 일어나지 않는다(그러면 프레임마다 강제 리플로가 난다).

       **동작 줄이기에서도 굽는다.** 전에는 여기를 통째로 건너뛰었고(정지 프레임은
       한 장만 그리니 조용해질 자리를 알 수 없다고 보았다), 그 결과 동작 줄이기를
       켠 사람만 본문이 만점군 위에 얹혀 거의 못 읽었다 — 실측으로 논문 제목 자리
       픽셀의 1%가 대비 1.06:1(글자보다 배경이 밝다) 이었다. 접근성 설정을 켰더니
       읽기가 더 어려워지는 것은 그 설정의 목적에 정면으로 어긋난다.

       **이것은 "배경이 움직이는 것"이 아니다.** 세계(카메라 z·차량·스윕·막)는
       그대로 얼어 있다 — 스크롤해도 점 하나 자리를 옮기지 않는다. 스크롤을 따라
       갱신되는 것은 **글이 앉은 자리의 감쇠 마스크뿐**이고, 그건 연출이 아니라
       가독성 장치다(애니메이션이 도는 쪽에서 쓰는 것과 같은 장치이기도 하다).
       다시 굽는 계기는 rAF 루프가 아니라 **스크롤 리스너 → rAF 한 번**이다
       (아래 §정지 프레임 다시 그리기). */
    /**
     * 첫 화면의 글이 **자리를 비운 정도** 0→1.
     *
     * DOM 글자가 꺼지는 시점(치환)이 아니라 **점이 날아가는 정도**를 쓴다. 치환이
     * 끝나도 점-글자는 그 자리에 그대로 서 있으므로, 그때 감쇠를 놓아 버리면
     * 점-글자가 밝아진 도로 위에 얹혀 읽히지 않는다. 점이 떠나는 만큼 도로가
     * 돌아온다 — 글이 가렸던 자리가 글과 함께 열린다.
     */
    const gIn = glyphRef.current;
    /* 조립의 **뒷절반**에서 푼다. 앞절반에는 아직 점-글자가 그 자리에 두껍게
       남아 있어서, 먼저 풀면 밝아진 도로 위에 흰 점이 얹혀 둘 다 안 읽힌다. */
    const inkGone =
      still || !gIn
        ? 0
        : smooth(
            clamp01(
              (hp - (gIn.loose0 + (gIn.done - gIn.loose0) * 0.55)) /
                Math.max(1e-4, (gIn.done - gIn.loose0) * 0.45),
            ),
          );
    {
      const q = buf.quiet;
      q.fill(1);
      st.quietBoxes.length = 0;
      if (st.quiet.length) {
        const shortSide = Math.min(W, H);
        /* 화면 밖 판정에 쓰는 넉넉한 여유 — 실제 감쇠 거리는 요소마다 다르다. */
        const softMax = shortSide * Math.max(QUIET_SOFT, QUIET_SOFT_PANEL);
        const cw = W / QW;
        const ch = H / QH;
        let seen = 0;
        for (const qe of st.quiet) {
          if (seen >= QUIET_MAX) break;
          const r = qe.el.getBoundingClientRect();
          if (r.bottom < -softMax || r.top > H + softMax || r.width <= 0)
            continue;
          // 가로 덱에서 옆으로 밀려난 패널은 화면 밖이다 — 세로만 보면 헛돈다.
          if (r.right < -softMax || r.left > W + softMax) continue;
          seen++;
          if (qe.ink) {
            /* 붙어 있는 첫 화면 상자의 화면 위치. 글자 점은 이 상자 기준으로
               구워 두었으므로 여기만 더하면 화면 좌표가 된다 — rect 는 여기서
               한 번 읽는 것이 전부다(프레임에 DOM 읽기를 더하지 않는다). */
            st.inkLeft = r.left;
            st.inkTop = r.top;
          }
          /* 글줄을 다시 재는 때: 아직 안 쟀거나, 요소 크기가 달라졌거나(재조판),
             sticky 자식이 움직일 만큼 시간이 지났을 때. **한 프레임에 한 요소만** —
             여러 요소를 한꺼번에 재면 그 프레임만 길어진다. */
          if (
            qe.n === 0 ||
            (st.inkAt !== elapsed &&
              (Math.abs(r.width - qe.bw) > 0.5 ||
                Math.abs(r.height - qe.bh) > 0.5 ||
                elapsed - qe.at > QUIET_INK_TTL))
          ) {
            st.inkAt = elapsed;
            qe.at = elapsed;
            inkBoxes(qe.el, qe, r);
          }
          const box = qe.box;
          /* 글이 점으로 바뀐 만큼 감쇠를 **놓아 준다.** 첫 화면은 붙어 있어 글이
             사라진 뒤에도 상자가 그 자리에 남는다 — 안 놓으면 연출 내내 도로
             왼쪽이 어둡고, 글자에서 온 점들이 어두운 자리로 내려앉는다. */
          const floor = qe.ink ? qe.floor + (1 - qe.floor) * inkGone : qe.floor;
          const span = 1 - floor;
          const soft = shortSide * qe.soft;
          const inv = 1 / soft;
          for (let bi = 0; bi < qe.n; bi++) {
            const bx = r.left + box[bi * 4]!;
            const by = r.top + box[bi * 4 + 1]!;
            const bR = bx + box[bi * 4 + 2]!;
            const bB = by + box[bi * 4 + 3]!;
            if (bB < -soft || by > H + soft || bR < -soft || bx > W + soft)
              continue;
            st.quietBoxes.push(bx, by, bR - bx, bB - by, soft, floor);
            // 감쇠가 0 이 되는 바깥 경계까지만 격자를 훑는다.
            const c0 = Math.max(0, ((bx - soft) / cw) | 0);
            const c1 = Math.min(QW - 1, ((bR + soft) / cw) | 0);
            const r0 = Math.max(0, ((by - soft) / ch) | 0);
            const r1 = Math.min(QH - 1, ((bB + soft) / ch) | 0);
            for (let gy = r0; gy <= r1; gy++) {
              const py = (gy + 0.5) * ch;
              const dy = py < by ? by - py : py > bB ? py - bB : 0;
              if (dy >= soft) continue;
              for (let gx = c0; gx <= c1; gx++) {
                const px = (gx + 0.5) * cw;
                const dx = px < bx ? bx - px : px > bR ? px - bR : 0;
                const d = dx > dy ? dx : dy;
                if (d >= soft) continue;
                // 안쪽에서 가장 조용하고, soft 만큼 바깥에서 완전히 풀린다.
                const k = floor + span * smooth(d * inv);
                const i = gy * QW + gx;
                if (k < q[i]!) q[i] = k;
              }
            }
          }
        }
      }
    }

    /* --- 첫 화면의 글자 굽기 ------------------------------------------
       **DOM 읽기는 여기서 끝난다.** 아래로는 CSS 변수 쓰기뿐이라 읽기·쓰기가
       번갈아 일어나지 않는다. 굽는 것은 리사이즈·글꼴 도착 때뿐이고, 그 프레임
       하나만 길어진다(300자 남짓).

       동작 줄이기에서는 아예 굽지 않는다 — `hp` 가 0 이라 글자는 제자리에 서
       있고, 연출이 돌지 않으므로 점군도 필요 없다. */
    // 첫 화면 상자의 자리를 아직 못 읽었으면 굽지 않는다 — 좌표의 원점이 없다.
    if (
      (st.glyphStale || Math.abs(st.hpSpan - st.glyphSpan) > 2) &&
      !still &&
      Number.isFinite(st.inkTop)
    ) {
      st.glyphStale = false;
      st.glyphW = W;
      st.glyphH = H;
      // 일정은 `hp` 의 자에 걸려 있다 — 자가 달라지면(무대 위치가 잡히는 첫
      // 프레임·재조판) 구간 길이가 통째로 달라지므로 다시 굽는다.
      st.glyphSpan = st.hpSpan;
      const baked = bakeGlyphs(
        st.hpSpan,
        mobile ? GLYPH_MAX_MOBILE : GLYPH_MAX,
        mobile,
        st.inkLeft,
        st.inkTop,
      );
      glyphRef.current = baked;
      if (baked && baked.colors.length) setGlyphColors(pal, baked.colors);
      slotRef.current.ordered = false;
      st.dirty = true;
    }

    /* 차량 등장 — 무대가 다가오면서 한 대씩. 한 번 등장한 뒤로는 계속 함께 달린다
       (푸터까지 도로가 이어지는데 차만 사라지면 그게 더 이상하다). */
    const fleetK = still ? 1 : smooth(clamp01((approach - 0.02) / 0.8));

    /** 첫 화면의 글자가 아직 차로 가는 중인가. */
    const glyphOn = !still && glyphRef.current !== null && hp < 1;

    /* --- 빈 도로 -------------------------------------------------------
       **글자가 닿기 전에는 도로에 차가 한 대도 없다.** 글자를 받은 차는 글자의
       도착이 알파를 정하지만(아래 `aCar`), 글자를 안 받은 차·보행자까지 `fleetK`
       로 먼저 나타나면 "빈 도로였다가 글자가 차가 되는" 장면이 성립하지 않는다.
       그 차들도 글자 도착 구간(e 0.7→1)에 함께 선다.

       `fleetK` 와는 **큰 쪽**을 쓴다. 도착 뒤로는 1 이라 어차피 `fleetK` 를 덮고,
       hp = 1 에서는 둘 다 1 이라 인계가 보이지 않는다. */
    const gl0 = glyphRef.current;
    /** 잉크가 켜지는 정도 0→1 — 치환 구간의 앞부분에서 다 켜진다. */
    const sub =
      gl0 && !still ? clamp01(((hp - gl0.t0) * gl0.subK) / GLYPH_IN) : 0;
    /** 점-글자가 제자리에서 풀어진 정도 0→1. */
    const loosen = gl0 && !still ? clamp01((hp - gl0.loose0) * gl0.looseK) : 0;
    /** 조립이 끝나 가는 정도 — 마지막 15% 에서 나머지 배역이 선다. */
    const tail = gl0 ? Math.max(1e-4, (gl0.done - gl0.asm0) * 0.15) : 1;
    const roadK =
      glyphOn && gl0 ? smooth(clamp01((hp - (gl0.done - tail)) / tail)) : 1;
    /** 배역이 실제로 보이는 정도 — 글자 도착이 무대 접근보다 먼저 선다. */
    const fleetG = glyphOn ? Math.max(fleetK, roadK) : fleetK;

    /**
     * **시점은 연구 무대에서만 올라간다.**
     *
     * 사다리꼴이다 — 첫 막이 다가오면 오르고(대시캠 1.3m → 루프탑 8.5m), 네 막이
     * 펼쳐지는 동안 머물고, 마지막 막이 자리를 뜨면 다시 내려온다. 무대를 벗어나면
     * 정확히 0 — 소식·함께하기·푸터는 처음과 같은 블랙박스 시점으로 돌아간다.
     * 예전에는 한 번 오르면 끝까지 올라간 채였다: 그게 "계속 시점이 올라간다"의 정체.
     *
     * 오르내리는 구간을 한 막 길이에 가깝게 잡는다. 짧게 잡으면 카메라가 **떨어진다**.
     */
    const riseK = still
      ? 0
      : deckRise >= 0
        ? deckRise
        : /* 선행 0.62 — 첫 막이 화면 아래끝에 닿을 때(actT₀ = −0.7)가 아니라 그 뒤부터
             오른다. 0.85 였을 때는 **스크롤 0 에서 이미 rise 0.09** 였다: 첫 화면이
             대시캠이 아니라 어중간하게 떠 있는 시점으로 시작했다(검사기가 잡았다).
             여는 화면이 정확히 한 화면이라 그 앞에 여유가 없다. */
          smooth(clamp01((actT[0]! + RISE_LEAD) / RISE_LEAD)) *
          (1 - smooth(clamp01((actT[ACTS - 1]! - 0.78) / 0.72)));
    const stageOn = riseK;

    /* --- 4개 막 --------------------------------------------------------
       막 사이는 서로 겹쳐 교차시킨다. 딱 끊으면 연출이 슬라이드쇼가 된다. */
    for (let i = 0; i < ACTS; i++) {
      const t = actT[i]!;
      const raw = still
        ? 0
        : /* 덱: 제자리에 선 패널이 만개하고 양옆으로 교차 감쇠한다. 두 패널이 동시에
             만개할 수는 없다 — |t| 와 |t−1| 의 합은 언제나 1 이상이기 때문이다. */
          deckRise >= 0
          ? smooth(clamp01(1 - Math.abs(t)))
          : t < -ACT_LEAD || t > 1 + ACT_TAIL
            ? 0
            : t < ACT_IN
              ? smooth((t + ACT_LEAD) / (ACT_LEAD + ACT_IN))
              : t > ACT_OUT
                ? 1 - smooth((t - ACT_OUT) / (1 + ACT_TAIL - ACT_OUT))
                : 1;
      actRaw[i] = raw;
      /* **막의 연출은 무대에 서 있을 때만 존재한다.**
         덱에서는 스크롤 0 에서도 첫 패널이 제자리에 있어 raw 가 1 이다. 그대로
         쓰면 히어로 한복판에 01막의 속도 막대가 통째로 서 버린다 — 실제로 섰고,
         도로 위에 웬 초록 막대가 꽂힌 것처럼 보였다. 무대 진입도(`riseK`)를 곱해
         무대 밖에서는 정확히 0 으로 만든다. 세로 무대에서는 막이 화면을 지나야
         raw 가 올라가므로 곱할 필요가 없다. */
      actK[i] = deckRise >= 0 ? raw * riseK : raw;
    }

    /** 03·04막 존재감 — 배역(호출 승객·합류 차량)을 고르고 놓는 기준이 된다. */
    const a2On = actK[ACT_SERVICE]!;
    const a3On = actK[ACT_CDA]!;

    /* 진행도를 CSS 커스텀 프로퍼티로 흘려보낸다 — **rAF 와 CSS 를 잇는 유일한 통로**다.
       히어로 타이포가 `--h` 하나로 순서대로 빠지고, 연구 무대의 4개 주제는
       `--a0`…`--a3` 로 배경의 막과 **정확히 같은 시계**에 뜨고 진다.

       `<html>` 에 쓴다. 도로 캔버스는 고정 배경이고 글은 문서 흐름 안에 있어
       둘이 형제라 — 한쪽 요소에만 쓰면 다른 쪽이 상속으로 읽을 수 없다.
       값이 안 바뀌면 아예 쓰지 않으므로 정지 중에는 스타일 무효화가 0 이다. */
    const varsEl = document.documentElement;
    if (!still) {
      if (!(Math.abs(hp - st.cssH) < 4e-4)) {
        st.cssH = hp;
        varsEl.style.setProperty("--h", hp.toFixed(4));
      }
      if (!(Math.abs(p - st.cssP) < 4e-4)) {
        st.cssP = p;
        varsEl.style.setProperty("--p", p.toFixed(4));
      }
      // `--v` 는 **시점**이다(0 대시캠 · 1 루프탑). 스크림이 이 값을 따라가야
      // 카메라가 내려온 뒤 — 푸터의 주소 위 — 에 다시 지면이 조용해진다.
      if (!(Math.abs(riseK - st.cssV) < 4e-4)) {
        st.cssV = riseK;
        varsEl.style.setProperty("--v", riseK.toFixed(4));
      }
      /* CSS 에는 **무대 여부를 뺀** 값을 보낸다. 지금 어느 패널에 서 있는지를
         가리키는 값이라, 무대에 다 오르기 전이라고 패널이 흐려지면 안 된다. */
      for (let i = 0; i < ACTS; i++) {
        const a = actRaw[i]!;
        if (Math.abs(a - st.cssA[i]!) < 4e-3) continue;
        st.cssA[i] = a;
        varsEl.style.setProperty(`--a${i}`, a.toFixed(3));
      }
    }

    /* --- 카메라 · 투영 파라미터 -------------------------------------
       ① 블랙박스: 낮고(1.3m) 수평에 가깝고 광각.
       ② 루프탑 LiDAR: 12m 까지 완만히 상승하고 시선이 내려간다.           */
    /* 막별 카메라를 진행도로 섞는다. 막 사이가 겹쳐 교차하므로 가중평균이면
       전환이 저절로 부드러워진다 — 별도의 보간 로직이 필요 없다. */
    let wsum = 0;
    let aY = 0;
    let aHor = 0;
    let aBack = 0;
    let aPan = 0;
    let aFov = 0;
    for (let i = 0; i < ACTS; i++) {
      // 어느 막의 **구도**인지는 패널 위치만으로 정해진다. 무대 진입도는 아래에서
      // 따로 곱한다 — 여기까지 곱하면 `stageK` 가 riseK² 이 되어 카메라가 늦게 뜬다.
      const w = actRaw[i]!;
      if (w <= 0) continue;
      const c = ACT_CAM[i]!;
      wsum += w;
      aY += c.y * w;
      aHor += c.horizon * w;
      aBack += c.back * w;
      aPan += c.pan * w;
      aFov += c.fov * w;
    }
    /**
     * 막 카메라의 비중. 두 조건이 **모두** 서야 1 이 된다 —
     * 무대 안에 있고(`riseK`), 그 안에서 어떤 막이 서 있어야(`wsum`) 한다.
     * 막과 막 사이는 서로 겹쳐 교차하므로 무대 한가운데서 이 값이 꺼지지 않는다.
     */
    const stageK = Math.min(1, wsum) * riseK;
    const inv = wsum > 1e-4 ? 1 / wsum : 0;
    /* **시점은 `riseK` 하나만 따른다.** `stageK` 는 `min(1, wsum)·riseK` 라, 막이
       화면의 30% 선에 다가서야 오르는 `wsum`(ACT_LEAD 0.26 + ACT_IN 0.12 ≈ 330px)
       에 상승이 통째로 갇혀 있었다 — 실측으로 camY 가 스크롤 200px 만에
       1.8m → 8.4m 로 솟았고, 그래서 **연구가 다른 화면으로 잘려 들어오는 것**으로
       보였다(교수님 지적). 막이 아직 아무도 안 섰을 때는 첫 막의 구도를 목표로
       삼는다 — 그래야 `riseK` 가 도는 내내 갈 곳이 있다.
       `back`·`panK` 는 그대로 `stageK` 다: 자차가 보이는 것과 좌우 팬은 **그 막의**
       구도이지 시점 상승이 아니다. */
    const mixY = wsum > 1e-4 ? aY * inv : ACT_CAM[0]!.y;
    const mixHor = wsum > 1e-4 ? aHor * inv : ACT_CAM[0]!.horizon;
    const mixFov = wsum > 1e-4 ? aFov * inv : ACT_CAM[0]!.fov;
    const camYBase = CAM_Y_DASH + (mixY - CAM_Y_DASH) * riseK;
    const horizon = HORIZON_DASH + (mixHor - HORIZON_DASH) * riseK;
    const fovK = 0.7 + (mixFov - 0.7) * riseK;
    const panK = aPan * inv * stageK;

    // 소실점을 오른쪽으로 밀어 왼쪽에 타이포 공간을 연다(넓은 화면에서만).
    // 대시캠은 정면을 보므로 기본 이동량은 작다 — 약한 요(yaw) 정도로만 읽힌다.
    const shift = W <= 700 ? 0 : W >= 1100 ? 1 : (W - 700) / 400;
    /* 조향에 딸린 요(px). 오른쪽으로 꺾으면 장면이 왼쪽으로 흐른다. */
    const cx = W * (0.5 + (0.042 + panK) * shift) - W * STEER_YAW * steer;
    // 세로로 긴 화면(모바일)에서는 소실점을 조금 더 올려 빈 하늘을 줄인다.
    const tall = Math.min(1, Math.max(0, (H / W - 1.3) / 1));
    /* 센서 피치(px). 소실점을 세로로 옮긴다 — `ACT_CAM.horizon` 이 쓰는 것과 **같은
       손잡이**다. 고개를 들면(pitch > 0) 소실점이 내려가 먼 곳이 열리고, 숙이면
       올라가 노면이 화면을 채운다. 커서가 없으면 정확히 0 이라 구도가 그대로다. */
    const cy = H * (horizon - 0.05 * tall) + H * STEER_PITCH * pitch;
    /** 차체 롤(화면 가로 1px 당 세로 px). 카울에는 걸지 않는다 — §커서 = 센서의 지향. */
    const roll = STEER_ROLL * steer;
    // 초점거리 — 대시캠은 광각(1280×860 에서 수평 화각 ≈ 93°). 좁은 화면에서
    // 과광각이 되지 않게 폭으로도 막는다.
    const f = Math.min(H * fovK, W * (1.3 + 0.6 * stageK));

    /* --- 스크롤 → 주행거리 ------------------------------------------ */
    /* **무대에 서 있는 동안에는 도로가 스스로 달린다.**

       이 사이트의 규칙은 "스크롤이 멈추면 도로도 멈춘다"이고, 그 규칙은 글을 읽는
       동안 배경이 들썩이지 않게 하려고 있다. 연구 무대는 글을 읽는 자리가 아니라
       **멈춰 서서 보는 자리**다 — 옆으로 한 칸 넘겨 놓고 가만히 보는데 도로가 얼어
       있으면 파동도, 승객도, 합류도 영영 일어나지 않는다. 게다가 같은 화면 안의
       시뮬레이션은 이미 자기 시계로 돌고 있어서, 배경만 정지해 있는 편이 오히려
       어긋난다. 무대를 벗어나면(`riseK` → 0) 규칙대로 다시 스크롤에 묶인다.

       속도는 장면 속도(FLEET_V)와 같다 — 자차가 대열과 **같은 속도로** 달린다.
       그래서 시뮬 시각이 실시간과 1:1 로 흐르고, 한 막(ACT_RUN)이 약 11초가 된다.

       켜지는 문턱은 `riseK` 보다 **늦다.** 시점이 오르는 내내 비례해서 굴리면,
       무대로 들어가는 도중에 스크롤을 멈췄을 때 도로가 어중간한 속도로 기어간다 —
       "멈췄는데 왜 움직이지"가 된다. 무대가 거의 다 선 다음에야 붙는다. */
    const driveK = deckRise >= 0 ? smooth(clamp01((riseK - 0.55) / 0.4)) : 0;
    if (!still) st.selfZ += FLEET_V * dt * driveK;
    const scrollZ = scrollY * M_PER_PX + st.selfZ;

    /* --- 막 안의 재생 헤드 -------------------------------------------
       덱에서는 주행거리가 연출의 시계다. ACT_RUN 을 지날 때마다 그 막이 처음부터
       다시 흐른다 — 머무는 동안 되풀이해서 보게 된다. 한 바퀴가 끝나면 배역(제어
       AV·택시·합류차)도 같이 놓아 준다. 진행도만 0 으로 돌리면 배역은 끝 상태에
       남아 다음 바퀴 첫 프레임에 차가 순간이동한다.                          */
    const dsRun = scrollZ - st.prevScrollZ;
    if (!still && deckRise >= 0) {
      for (let i = 0; i < ACTS; i++) {
        /* 무대를 벗어나면 처음으로 되돌린다. 그래야 다시 들어왔을 때 그 막이
         **처음부터** 흐른다 — 안 되돌리면 도착하자마자 중간부터 재생된다. */
        if (actK[i]! < 0.01 || deckRise < 0.05) {
          actU[i] = 0;
          continue;
        }
        if (dsRun <= 0) continue;
        let u = actU[i]! + dsRun / ACT_RUN;
        if (u >= 1) {
          u -= 1;
          if (i === ACT_MIX)
            for (const veh of fleet.cols[0]!.veh) delete veh.fs;
          if (i === ACT_SERVICE) fleet.taxi.on = 0;
          if (i === ACT_CDA) fleet.mergeIdx = -1;
        }
        actU[i] = u;
      }
    } else if (still) {
      /* 정지 프레임에는 막의 재생 헤드가 없다. `actK` 가 이미 0 이라 연출은 서지
         않지만, 스크롤로 다시 그릴 때 `actT` 를 그대로 흘려보내면 배역(택시·합류차)
         상태가 **스크롤을 따라 변한다** — 세계가 얼어 있어야 한다는 전제가 깨진다. */
      actU.fill(0);
    } else {
      for (let i = 0; i < ACTS; i++) actU[i] = actT[i]!;
    }

    /* --- 앞차들(IDM) -------------------------------------------------
       시뮬 시각은 **주행거리 / 기준속도** 로만 흐른다. 스크롤이 멈추면 dt=0 이
       되어 차량도 정확히 멈춘다 — 상시 운동 금지(도로와 같은 규칙).        */
    const vehicles = fleet.vehicles;
    const ego = vehicles[0]!;
    if (still) {
      if (!st.started) fleet.t = 0;
    } else {
      const ds = scrollZ - st.prevScrollZ;
      if (ds > 0 && fleetG > 0.001) {
        fleet.accum += ds / FLEET_V;
        let subs = 0;
        while (fleet.accum >= SIM_DT && subs < SIM_MAX_SUB) {
          // 교란: 연구 구간에 들어서면 선두가 한 번 밟는다. 상용 ACC 는 이 교란을
          // 뒤로 갈수록 증폭시킨다 — 연구실 TR-C 논문이 실측으로 보인 그 거동이다.
          if (Number.isNaN(st.waveT) && st.waveArmed && fleetK > 0.55) {
            st.waveT = fleet.t + WAVE_AT;
            st.waveArmed = false;
          }
          const wt = st.waveT;
          /* 교란 타이밍 — 01막 안에서는 **막의 진행도**가 정한다.
             시뮬 시각으로만 돌리면 한 주기가 11초인데 한 막을 지나는 동안
             시뮬은 5초밖에 안 흘러서, 스크롤 속도에 따라 교란을 통째로 놓친다.
             막 안에서 두 번 밟게 해 두면 어떤 속도로 굴려도 한 번은 본다.
             무대 밖(미션·소식 구간)에서는 원래대로 주기적으로 밟는다. */
          const t1 = actU[ACT_PLATOON]!;
          /* 무대가 다가오면 주기 교란을 **끈다.** 안 끄면 01막이 시작될 때
             이전 파동이 아직 대열을 지나가는 중이라, 교란 직전 기준 속도를
             재려는 순간 선두가 이미 멈춰 있다(실측: 기준이 0 km/h 로 잡혔다). */
          const braking =
            actK[ACT_PLATOON]! > 0.01
              ? t1 > 0.06 && t1 < 0.62
              : approach > 0.35
                ? false
                : !Number.isNaN(wt) &&
                  (fleet.t - wt) % WAVE_PERIOD >= 0 &&
                  (fleet.t - wt) % WAVE_PERIOD < PLATOON.perturb.duration &&
                  fleet.t >= wt;
          const last = vehicles.length - 1;
          // 교란이 **시작되는 순간** 양 끝 차의 속도를 기준으로 잡는다.
          // 막이 시작될 때 직전 파동의 흔적을 지운다
          if (actK[ACT_PLATOON]! > 0.01 && t1 < 0.05) {
            st.waveFront = Number.NaN;
            st.waveReach = 0;
          }
          if (braking && !st.brakePrev) {
            st.ampLeadBase = vehicles[last]!.v * 3.6;
            st.ampRearBase = ego.v * 3.6;
            st.ampLead = st.ampLeadBase;
            st.ampRear = st.ampRearBase;
            st.waveFront = Number.NaN;
            st.waveReach = 0;
          }
          // 파동의 머리 = 문턱을 넘겨 감속 중인 **가장 뒤쪽** 차량.
          // useTrafficSim 이 쓰는 것과 같은 정의다(WAVE_DECEL).
          for (let i = 0; i < vehicles.length; i++) {
            if (vehicles[i]!.a > BRAKE_LAMP) continue;
            if (Number.isNaN(st.waveFront) || i < st.waveFront) {
              st.waveFront = i;
              const lead = vehicles[vehicles.length - 1]!;
              st.waveReach = lead.x - lead.length - vehicles[i]!.x;
            }
          }
          st.brakePrev = braking;
          const yieldNow = fleet.yield > 0.02 ? YIELD_ACCEL * fleet.yield : 0;
          step(vehicles, SIM_DT, {
            // 앞 대열의 가속 잡음(`FLEET_NOISE`)은 난수원이 있어야 먹는다.
            rng: fleet.rng,
            override: (_v, i) =>
              braking && i === last
                ? ACT_BRAKE
                : // 04막 — 합류차에게 간격을 내주는 차. 먼저 늦추고, 그 뒤에 합류가 일어난다.
                  yieldNow && i === MERGE_PARTNER
                  ? yieldNow
                  : undefined,
          });
          /* 옆 차로 · 마주 오는 차로 — 링 경계로 푼다.
             **난수원을 반드시 넘긴다** — IDM 의 운전자 노이즈(`params.noise`)는
             `rng` 가 있을 때만 먹는다. 이걸 빠뜨렸더니 옆 차로 일곱 대가 속도
             표준편차 0.01 m/s 로 자로 잰 듯 굴러갔다(실측). 사람이 그렇게 운전하지 않는다.

             그리고 한 대가 주기적으로 밟는다. 사람 운전 대열은 그 교란을 뒤로
             갈수록 **증폭**시킨다(검증표 기준 3.92배) — stop-and-go 파동이 뒤로
             밀려오는 것이 02막이 보여주려는 바로 그 현상이고, 교란 없이 평형만
             굴리면 아무 일도 일어나지 않는다. */
          const jamPhase = fleet.t % JAM_PERIOD;
          for (let ci = 0; ci < fleet.cols.length; ci++) {
            const col = fleet.cols[ci]!;
            step(col.veh, SIM_DT, {
              circumference: SCENE_LEN,
              rng: fleet.rng,
              override:
                ci === 0 && jamPhase < JAM_DURATION
                  ? (_v, i) => (i === JAM_AT ? JAM_ACCEL : undefined)
                  : undefined,
            });
          }
          // 인도 위의 사람들 — 걷고, 씬 길이에서 되접는다.
          for (let i = 0; i < fleet.peds.length; i++) {
            const q = fleet.peds[i]!;
            if (!q.idle) continue;
            q.z += q.v * SIM_DT;
            if (q.z < 0) q.z += SCENE_LEN;
            else if (q.z >= SCENE_LEN) q.z -= SCENE_LEN;
            // 보폭 ≈ 0.75m — 속도에 맞춰 위상이 돈다(제자리걸음이 안 생긴다).
            q.ph += (Math.abs(q.v) / 0.75) * TWO_PI * SIM_DT;
          }
          fleet.t += SIM_DT;
          fleet.accum -= SIM_DT;
          subs++;
        }
        if (subs >= SIM_MAX_SUB) fleet.accum = 0;
        // 자차가 기준 등속 궤적보다 뒤처진 만큼 도로도 느려진다 — 파가 자차에
        // 닿는 순간 배경이 함께 늦춰져야 앞차와 노면이 따로 놀지 않는다.
        fleet.lag = FLEET_V * fleet.t - ego.x;
      }
      if (fleetK <= 0.001) st.waveArmed = true;
      st.prevScrollZ = scrollZ;
    }

    const targetZ = scrollZ - fleet.lag;

    if (!st.init) {
      // 새로고침으로 스크롤 중간에 착지했을 수 있다 — 미끄러져 오지 말고 그 자리에서.
      st.camZ = targetZ;
      st.prevZ = targetZ;
      st.prevScrollZ = scrollZ;
      st.init = true;
    } else if (!still) {
      const delta = targetZ - st.camZ;
      if (delta < SNAP && delta > -SNAP) {
        st.camZ = targetZ; // 관성의 끝 — 여기서 완전히 멈춘다
      } else {
        // 프레임률 독립 감쇠. 30fps 에서도 60fps 와 같은 시간상수로 미끄러진다.
        st.camZ += delta * (1 - Math.pow(1 - DAMP, dt * 60));
      }
    }

    const vel = dt > 0 ? (st.camZ - st.prevZ) / dt : 0;
    st.prevZ = st.camZ;

    // 연구 구간에서는 카메라가 오르면서 **뒤로도 빠진다** — 자차가 화면 앞쪽에 들어와
    // "내 차도 이 흐름 안에 있다"가 읽힌다. 추격 카메라와 같은 구도다.
    const back = aBack * inv * stageK;
    // 렌더에는 씬 길이로 되접은 값을 쓴다(곡선 함수는 SCENE_LEN 주기라 동일하다).
    const zAbs = st.camZ + Z0 - back;
    const camZ = zAbs - Math.floor(zAbs / SCENE_LEN) * SCENE_LEN;
    /* 자차의 횡위치 — 여기서 조향이 실제로 좌표가 된다. 화면 효과가 아니라
       카메라가 옆으로 옮겨 앉는 것이라, 가까운 것은 크게 먼 것은 조금 움직인다. */
    const camX = curveX(camZ) + LANE_X + steer * STEER_X;

    /* --- 막별 연출 스크립트 --------------------------------------------
       "누가 차를 부르는가", "누가 합류하는가" 는 막이 시작될 때 **한 번** 고른다.
       프레임마다 다시 고르면 대상이 깜빡거린다. 막을 벗어나면 놓아 준다.

       진행은 스크롤이 아니라 **막 자신의 진행도**(`actT`)를 따른다. 그래야 스크롤을
       빨리 굴리든 천천히 굴리든 연출이 처음부터 끝까지 한 번은 재생된다.        */

    /* ── 01막: 절반쯤에서 몇 대가 제어 AV 로 바뀐다 ── */
    const u2 = actU[ACT_MIX]!;
    if (actK[ACT_MIX]! > 0.05 && u2 > 0.5) {
      const col = fleet.cols[0]!;
      // 균등 분포로 세 대 — 연구실 검증표에서 1~2대만으로 파동이 −95% 감쇠했다.
      for (const veh of col.veh) {
        if (AV_IDS.includes(veh.id) && !veh.fs) veh.fs = FS_DEFAULT;
      }
    } else if (actK[ACT_MIX]! <= 0.01) {
      for (const veh of fleet.cols[0]!.veh) delete veh.fs;
    }

    /* ── 03막: 호출 → 정차 → 탑승 → 출발 ──
       거리는 전부 카메라 기준이다. 60m 앞에서 다가와 24m 에 서고, 우리가 그 옆을
       천천히 지나는 동안 승객이 걸어와 타고, 차가 떠난다.                     */
    const u3 = actU[ACT_SERVICE]!;
    const taxi = fleet.taxi;
    /** 한 막을 지나는 동안의 주행거리(m). 막은 한 화면이라 창 높이가 정한다. */
    const actRun = H * M_PER_PX;
    if (actK[ACT_SERVICE]! > 0.05 && !taxi.on) {
      taxi.on = 1;
      taxi.shape = 0;
      taxi.paxGone = 0;
      taxi.paxPh = 0;
      /* 도로 위 한 자리에 세운다 — 이 뒤로는 도로가 흐른 만큼만 움직인다.
         기준은 **자차**(`zAbs + back`)다. 02→03 전환 중에는 카메라가 자차보다 22m
         뒤에 있어서, 카메라 앞 거리로 세우면 카메라가 자차 자리로 따라붙는 순간
         택시가 코앞에 온다(실측: 정차 거리 17m 가 0.4m 로). */
      taxi.z = zAbs + back + TAXI_SPAWN_K * actRun;
      taxi.lastZ = st.camZ;
    } else if (actK[ACT_SERVICE]! <= 0.01) {
      taxi.on = 0;
      taxi.lastZ = Number.NaN;
    }
    if (taxi.on) {
      const u = clamp01(u3);
      /* 도로가 이번 프레임에 흐른 거리. 스크롤을 되올리면 음수 — 그러면 차도
         되감긴다(연출 전체가 스크롤에 가역이다). */
      const adv = Number.isNaN(taxi.lastZ) ? 0 : st.camZ - taxi.lastZ;
      taxi.lastZ = st.camZ;
      /* 도로 대비 속도비: 느리게 다가와(0.75) 서고(0), 승객이 타면 정상 속도(1)로.
         정차 지점은 우리보다 앞이라(한 막의 0.8 주행거리 앞에서 출발해 0.3 에
         선다) 장면 내내 우리 앞에 있고, 출발하면 정상보다 조금 빠르게 멀어진다.
         막이 끝나 놓아줄 때는 이미 20m 넘게 앞이라 막 전환의 페이드에 묻힌다. */
      const r =
        u < 0.3
          ? TAXI_R_IN * (1 - smooth(u / 0.3))
          : u < 0.62
            ? 0
            : TAXI_R_OUT * smooth((u - 0.62) / 0.23);
      taxi.z += r * adv;
      taxi.dz = taxi.z - zAbs;
      // 차로 → 갓길 → 차로. 빠져나오는 것은 우리가 지나치는 순간에 시작한다.
      const out = smooth(clamp01((u - 0.16) / 0.22));
      const back2 = smooth(clamp01((u - 0.64) / 0.16));
      taxi.x = LANE_NEXT + (TAXI_STOP_X - LANE_NEXT) * (out - back2);
      taxi.brake = u > 0.17 && u < 0.34;
      // 승객은 차 바로 앞 인도에서 기다리다 걸어 나온다.
      taxi.paxDz = taxi.dz + (u < 0.62 ? 2.6 : 0);
      const walk = smooth(clamp01((u - 0.4) / 0.16));
      taxi.paxX = PAX_WAIT_X + (PAX_BOARD_X - PAX_WAIT_X) * walk;
      if (walk > 0 && walk < 1) taxi.paxPh += dt * 7;
      taxi.paxGone = u > 0.58 ? 1 : 0;
    }

    /* ── 04막: 합류차를 고르고, 뒷차가 간격을 내준다 ── */
    if (actK[ACT_CDA]! > 0.05 && fleet.mergeIdx < 0) {
      const col = fleet.cols[0]!;
      let best = -1;
      let bestD = Infinity;
      for (const veh of col.veh) {
        const ring = veh.x - veh.length;
        const wz = ring - Math.floor(ring / SCENE_LEN) * SCENE_LEN;
        let d = wz - camZ;
        if (d < 0) d += SCENE_LEN;
        if (d < 16 || d > 48) continue;
        if (d < bestD) {
          bestD = d;
          best = veh.id;
        }
      }
      if (best >= 0) fleet.mergeIdx = best; // **id** 다 — 배열 인덱스가 아니다
    } else if (actK[ACT_CDA]! <= 0.01 && fleet.mergeIdx >= 0) {
      fleet.mergeIdx = -1;
    }
    // 간격을 먼저 내주고(0→0.35) 그 다음에 들어온다(0.25→1) — 순서가 중요하다.
    fleet.mergeK =
      fleet.mergeIdx < 0 ? 0 : clamp01((actU[ACT_CDA]! - 0.25) / 0.5);
    fleet.yield =
      fleet.mergeIdx < 0
        ? 0
        : clamp01(actU[ACT_CDA]! / 0.3) *
          (1 - clamp01((actU[ACT_CDA]! - 0.62) / 0.2));
    const moveK = still ? 0 : Math.min(1, Math.abs(vel) / VEL_REF);
    // 노면 종단 + 서스펜션 상하동 — 움직일 때만. 멈추면 진동도 멈춘다.
    // 대시캠은 낮아서 같은 진폭도 훨씬 크게 느껴진다 — 상승하면 서서히 없앤다.
    const camY =
      camYBase +
      curveY(camZ) +
      0.025 * (1 - riseK) * moveK * Math.sin(elapsed * 3.4);

    /**
     * 근거리 클립은 **화면 바닥에 해당하는 깊이**로 잡는다. 대시캠에서는 2m,
     * 12m 상공에서는 17m 가 화면 아래끝이다 — 같은 상수로는 둘 다 맞출 수 없다.
     * 페이드는 그 바로 아래에서 끝나므로 노면은 화면 끝까지 꽉 찬다.
     */
    // 높이는 **노면 위 높이**(camYBase)로 잰다. 종단 선형이 섞인 절대 높이를 쓰면
    // 언덕을 오르내릴 때마다 근거리 대역이 숨쉬듯 늘었다 줄었다 한다.
    const dzBottom = (camYBase * f) / Math.max(1, H - cy);
    const near = Math.max(0.35, 0.5 * dzBottom);
    const nearFade = near + 0.45 * dzBottom;
    const nearSpan = nearFade - near;
    /** 조용한 영역 격자 조회용 — 화면 좌표 → 격자 칸. */
    const qxk = QW / W;
    const qyk = QH / H;
    const quiet = buf.quiet;

    /** 물체용 근거리 클립 — 노면보다 훨씬 가깝게 붙어도 그대로 그린다. */
    const nearSoft = Math.max(0.6, near * 0.22);

    /* --- 스윕 빔: 방위각 θ → 화면 x (sx = cx + f·tan θ 이므로 정확히 대응) --- */
    const thMax = Math.atan((Math.max(cx, W - cx) + 60) / f);
    const introEnd = (thMax * SWEEP_PERIOD) / Math.PI;

    let bLo = 0;
    let bHi = -1; // bHi < bLo → 이 프레임에는 히트 없음
    let kBoost = 0;

    if (still) {
      // 정지 프레임: 스캔이 이미 끝난 상태로 바로 보여준다.
      if (!st.started) {
        scene.seen.fill(1);
        scene.lastHit.fill(-1);
        st.started = true;
      }
    } else {
      if (st.phase < 0) st.phase = (Math.PI - thMax) / TWO_PI; // θ = -thMax 에서 시작
      st.phase = (st.phase + dt / SWEEP_PERIOD) % 1;
      const th = -Math.PI + st.phase * TWO_PI;
      const beamNow =
        th > -thMax && th < thMax ? cx + Math.tan(th) * f : Number.NaN;
      const beamPrev = st.beamX;
      if (!Number.isNaN(beamNow)) {
        bLo = Number.isNaN(beamPrev) ? beamNow - 30 : beamPrev;
        bHi = beamNow;
      }
      st.beamX = beamNow;
      // 부팅 스윕은 강하게 번쩍이고, 그 뒤로는 **주행 중에만** 빔이 보인다.
      // 멈추면 게인이 정확히 0 이 되어 잔광까지 사라진다 — 상시 운동 금지.
      const introK = Math.max(0, 1 - elapsed / (introEnd + 0.9));
      /* 지향이 움직이는 동안 스캐너가 그 각도를 다시 훑는다. 직전 프레임과의 차이를
         쓰므로, 지향이 목표에 스냅하면 저절로 정확히 0 이 된다(§커서 = 센서의 지향). */
      const aimVel = Number.isNaN(st.drawnSteer)
        ? 0
        : Math.abs(steer - st.drawnSteer) + Math.abs(pitch - st.drawnPitch);
      kBoost =
        2.6 * introK + 0.8 * moveK + 0.7 * Math.min(1, aimVel * STEER_BEAM);
    }

    // 첫 스윕이 끝난 뒤에도 아직 안 훑인 점(그때 화면 밖이었던 점)을 부드럽게 채운다.
    const introFade = still
      ? 1
      : Math.min(1, Math.max(0, (elapsed - introEnd - 0.15) / 0.9));

    /* --- 완전 정지 프레임은 통째로 건너뛴다 ---------------------------
       카메라가 멈췄고 빔 게인이 0 이면 직전 프레임과 픽셀이 같다. 페이지를
       읽는 동안 60fps 로 같은 그림을 다시 칠할 이유가 없다.                */
    if (
      !st.dirty &&
      stageOn <= 0.02 &&
      // 조용한 영역은 스크롤과 함께 움직인다 — 스크롤이 멈춰야 같은 그림이 된다
      st.camZ === st.drawnZ &&
      /* 지향이 그대로여야 같은 그림이다. **축을 더하면 여기에도 더한다** —
         빠뜨리면 그 입력이 조용히 무시된다(실제로 그런 적이 있다). */
      steer === st.drawnSteer &&
      pitch === st.drawnPitch &&
      /* 글자가 풀리는 중이면 스크롤이 조금만 움직여도 그림이 다르다. `hp` 는
         지수 감쇠가 아니라 스크롤의 직접 함수라 멈추면 정확히 같은 값이 된다. */
      hp === st.drawnH &&
      kBoost === 0 &&
      st.drawnBoost === 0 &&
      st.camZ === st.drawnZ &&
      riseK === st.drawnRise &&
      fleetG === st.drawnFleet &&
      introFade >= 1
    ) {
      return;
    }

    /* --- 카울(대시보드) 그늘 ------------------------------------------
       블랙박스 영상의 아래쪽은 늘 무언가에 막혀 있다. 그 어두워짐 하나가
       "나는 지금 차 안에 있다"를 읽히게 한다.

       **선을 긋지 않는다.** 실루엣을 한 줄로 그리면 배경과 섞이지 않는 단색 띠가
       생긴다(실측으로 확인됨). 대신 이 경계 아래로 점의 알파를 화면 200px 남짓에
       걸쳐 0 까지 떨어뜨린다 — 포그와 같은 방식의 감쇠라 배경에 녹아든다.
       카울은 자차에 붙어 있으므로 카메라 기준 높이로 잡는다(종단 선형·서스펜션에
       흔들리지 않는다). 카메라가 올라가면(연구 구간) 사라진다.              */
    const cowlK = 1 - smooth(clamp01(riseK / 0.35));
    const cowl = buf.cowl;
    if (cowlK > 0.01) {
      for (let c = 0; c <= COWL_COLS; c++) cowl[c] = H + 40;
      for (let i = 0; i <= COWL_SAMPLES; i++) {
        const u = -COWL_HALF + (i / COWL_SAMPLES) * COWL_HALF * 2;
        const cz = COWL_Z + COWL_BOW * u * u;
        const inv = f / cz;
        const sx = cx + u * inv;
        const sy = cy + COWL_DROP * inv;
        const c = Math.round((sx / W) * COWL_COLS);
        if (c < 0 || c > COWL_COLS) continue;
        if (sy < cowl[c]!) cowl[c] = sy;
      }
      // 표본 사이가 비면 이웃에서 채운다(화각이 넓으면 가장자리가 성기다).
      for (let c = 1; c <= COWL_COLS; c++)
        if (cowl[c]! > cowl[c - 1]! + 200) cowl[c] = cowl[c - 1]!;
      for (let c = COWL_COLS - 1; c >= 0; c--)
        if (cowl[c]! > cowl[c + 1]! + 200) cowl[c] = cowl[c + 1]!;
      // 페이드 중에는 경계를 화면 밖으로 밀어낸다 — 갑자기 걷히지 않게.
      if (cowlK < 1)
        for (let c = 0; c <= COWL_COLS; c++)
          cowl[c] = cowl[c]! + (1 - cowlK) * H;
    }
    const cowlOn = cowlK > 0.01;
    const colK = COWL_COLS / W;
    /** 경계 아래로 알파가 0 까지 떨어지는 거리(px). 화면 높이의 1/4. */
    const invCowlSoft = 1 / (H * COWL_SOFT);

    /* --- 투영 + bin 분류 --------------------------------------------- */
    const { xw, yw, zw, bucket, baseA, sw, lastHit, seen } = scene;
    const { vsx, vsy, vps, vbin, ssx, ssy, sps, binCount, binEnd } = buf;
    binCount.fill(0);

    let vc = 0;

    /** 한 점을 투영해 bin 에 넣는다. 화면 밖·너무 어두우면 버린다. */
    const emit = (
      x: number,
      y: number,
      dz: number,
      b: number,
      alpha: number,
      size: number,
      /**
       * true = **물체**다(차량·보행자·계측선). 노면이 아니라서 두 가지가 달라진다:
       * 포그를 선형으로만 먹이고, **근거리 페이드를 받지 않는다.**
       * 근거리 페이드는 노면이 화면 아래끝에서 뚝 끊기지 않게 하려는 장치인데,
       * 물체에까지 걸리면 어두운 면(도장)부터 지워져 **속이 빈 윤곽**만 남는다
       * (루프탑 시점에서 앞차가 고리처럼 보이던 원인이 이것이었다).
       */
      soft = false,
    ): void => {
      if (dz < (soft ? nearSoft : near)) return;
      let fog = 1 - dz * INV_FAR;
      if (fog <= 0.02) return;
      if (!soft) fog *= fog;

      const inv = f / dz;
      const sx = cx + (x - camX) * inv;
      if (sx < -8 || sx > W + 8) return;
      /* 차체 롤. 작은 각이라 회전 대신 전단(shear)으로 낸다 — 2° 에서 둘의 차이는
         0.06% 로 1px 도 안 된다. **카울은 여기를 거치지 않아 그대로 있고**, 그
         고정된 보닛에 대고 세계가 기운다. */
      const sy = cy + (camY - y) * inv + (sx - cx) * roll;
      if (sy < -8 || sy > H + 8) return;
      let shade = 1;
      if (cowlOn) {
        let c = (sx * colK) | 0;
        if (c < 0) c = 0;
        else if (c > COWL_COLS) c = COWL_COLS;
        const over = (sy - cowl[c]!) * invCowlSoft;
        if (over > 0) {
          if (over >= 1) return;
          shade = 1 - over;
        }
      }
      // 본문이 앉은 자리에서는 점이 성겨진다 (판도 테두리도 없다)
      {
        let qx = (sx * qxk) | 0;
        if (qx < 0) qx = 0;
        else if (qx >= QW) qx = QW - 1;
        let qy = (sy * qyk) | 0;
        if (qy < 0) qy = 0;
        else if (qy >= QH) qy = QH - 1;
        shade *= quiet[qy * QW + qx]!;
      }

      let a = alpha * fog * shade;
      if (!soft && dz < nearFade) {
        const t = (dz - near) / nearSpan;
        a *= t * t;
      }
      if (a < 0.05) return;
      if (a > 1) a = 1;

      let ak = (a * ALPHA_STEPS) | 0;
      if (ak > ALPHA_STEPS - 1) ak = ALPHA_STEPS - 1;

      /* 점 크기 상한. 노면은 5px 에서 자른다 — 더 키우면 화면 아래쪽이 색면이 된다.
         물체(차량·보행자)는 9px 까지 허용한다: 표본 간격 0.13m 가 10m 거리에서
         약 10px 인데 사각형이 5px 면 그 사이가 벌어져 **속이 빈 격자**로 보인다.
         실제 LiDAR 도 가까울수록 점이 면을 이룬다. */
      let ps = (size * inv + 0.5) | 0;
      const psMax = soft ? 9 : 5;
      if (ps < 1) ps = 1;
      else if (ps > psMax) ps = psMax;

      const bin = b * ALPHA_STEPS + ak;
      vsx[vc] = sx | 0;
      vsy[vc] = sy | 0;
      vps[vc] = ps;
      vbin[vc] = bin;
      binCount[bin]++;
      vc++;
    };

    /** 글자 점이 글자 자리에서 옮겨 간 거리의 합·개수 — `roadProbe` 로만 나간다. */
    let moveSum = 0;
    let moveN = 0;
    /** 화면 **위끝 밖**으로 밀려 안 그려진 글자 점 — 비행이 잘리는지 보는 창구. */
    let clipTop = 0;
    /** 목표 차 상자 안에 들어온 글자 점 · 차체 색으로 갈아탄 글자 점. */
    let ghostN = 0;
    let swapN = 0;
    /** 조립의 세 상태 — 글자 자리에 남음 · 공중 · 앉음. 셋이 동시에 0 이 아니어야
        "점이 흘러가 차를 만든다"가 화면에 있다. */
    let stillN = 0;
    let airN = 0;
    let landN = 0;
    /** 지금 그리는 차의 화면 폭(px) — 유령 계측의 자. `drawCar` 가 채운다. */
    let gCarPx = 0;
    /** 프레임 번호 — 이동량을 **연속한 두 프레임**에서만 재려고 센다. */
    const frameN = ++st.frameN;
    /** 프레임당 화면 이동량(px) — 평균·최대. 부드러움을 수로 재는 창구. */
    let stepSum = 0;
    let stepN = 0;
    let stepMax = 0;
    /** 한 프레임에 12px 넘게 튄 점의 수 — 몇 개나 튀는가. */
    let stepBig = 0;

    /** bin 에 넣는 마지막 한 걸음 — `emit` 의 꼬리와 같다. 글자 점 전용. */
    const putInk = (
      sx: number,
      sy: number,
      b: number,
      a: number,
      ps: number,
    ): void => {
      let ak = (a * ALPHA_STEPS) | 0;
      if (ak > ALPHA_STEPS - 1) ak = ALPHA_STEPS - 1;
      const bin = b * ALPHA_STEPS + ak;
      vsx[vc] = sx | 0;
      vsy[vc] = sy | 0;
      vps[vc] = ps;
      vbin[vc] = bin;
      binCount[bin]++;
      vc++;
    };

    /**
     * 글자 점 하나를 **조립 중인 차체 점**으로 찍는다.
     *
     * 점마다 출발 시각이 다르다(`o`). 어느 순간에도 세 가지가 동시에 보여야 한다:
     * 아직 글자 자리에 남은 점, 공중을 흐르는 점, 차에 앉아 굳은 점. 그게 "점이
     * 흘러가 차를 만드는" 장면이다 — 다 같이 마지막 구간에 수렴시켰더니 보통
     * 스크롤 속도에서는 그 구간을 한 번에 지나쳐 **차가 그냥 나타났다**.
     *
     * 다 앉고 번쩍임까지 끝난 점은 `emit` 에 그대로 넘긴다 — 값이 같아야 할
     * 자리는 같은 식으로 내야 인계(hp = 1)에서 픽셀이 안 튄다.
     */
    const glyphEmit = (
      x: number,
      y: number,
      dz: number,
      b: number,
      alpha: number,
      size: number,
      /** 글자 점 인덱스 */
      i: number,
      /** 조립 순서 0(먼저) … 1(나중). 차 순서 × 차 안의 뒤→앞 순서. */
      o: number,
      /** true = LOD 밖의 자리다. 앉은 뒤 꺼져야 인계에 남지 않는다. */
      spare = false,
    ): void => {
      if (dz < nearSoft) return;
      const gl = glyphRef.current;
      if (!gl) return;

      /** 0 = 이제 떠난다, 1 = 자리에 앉았다, 그 위는 착지 번쩍임. */
      const cExt = (hp - (gl.asm0 + o * gl.asmSpread)) * gl.flyK;
      const lx = st.inkLeft + gl.dx[i]!;
      const ly = st.inkTop + gl.dy[i]!;
      const inv = f / dz;
      const tx = cx + (x - camX) * inv;
      const ty = cy + (camY - y) * inv + (tx - cx) * roll;

      if (cExt >= 1 + GLYPH_FLASH) {
        // 굳었다. 이제 그냥 차체 점이다.
        if (spare) return;
        moveSum += Math.abs(tx - lx) + Math.abs(ty - ly);
        moveN++;
        landN++;
        swapN++;
        emit(x, y, dz, b, alpha, size, true);
        return;
      }

      const c = cExt <= 0 ? 0 : cExt >= 1 ? 1 : smooth(cExt);
      if (c <= 0) stillN++;
      else if (c < 1) airN++;
      else landN++;

      /* 떠나기 전에는 **자기 자리에서** 풀어진다 — 가로로 조금 벌어지고 아래로
         처진다. 목표 쪽으로 가는 것이 아니라 글자가 흐트러지는 것이다.
         글자 자리는 화면에 고정이다(여는 화면이 sticky 라 스크롤해도 안 움직인다). */
      const drift = loosen * (1 - c);
      const dr = gl.dr[i]!;
      const bx = lx + dr * GLYPH_DRIFT_X * drift;
      const by =
        ly + (0.45 + 0.55 * (dr < 0 ? -dr : dr)) * GLYPH_DRIFT_Y * drift;
      const sx = bx + (tx - bx) * c;
      if (sx < -8 || sx > W + 8) return;
      // 아래로 처지는 호. 직선으로 이으면 글자에서 차까지가 **하늘을 가로지르는
      // 선**이라 도로와 무관해 보인다 — 점이 도로 위로 내려앉아야 한다.
      const sy = by + (ty - by) * c + GLYPH_SAG * H * 4 * c * (1 - c);
      if (sy < -8) {
        clipTop++;
        return;
      }
      if (sy > H + 8) return;

      let fog = 1 - dz * INV_FAR;
      if (fog < 0) fog = 0;
      fog = 1 + (fog - 1) * c;

      let shade = 1;
      if (cowlOn) {
        let col = (sx * colK) | 0;
        if (col < 0) col = 0;
        else if (col > COWL_COLS) col = COWL_COLS;
        const over = (sy - cowl[col]!) * invCowlSoft;
        if (over > 0) shade = over >= 1 ? 0 : 1 - over;
      }
      {
        let qx = (sx * qxk) | 0;
        if (qx < 0) qx = 0;
        else if (qx >= QW) qx = QW - 1;
        let qy = (sy * qyk) | 0;
        if (qy < 0) qy = 0;
        else if (qy >= QH) qy = QH - 1;
        shade *= quiet[qy * QW + qx]!;
      }
      shade = 1 + (shade - 1) * c;

      // 켜지는 것은 **치환 구간의 시계**다. 날아갈 때 켜면 글자가 꺼진 자리에
      // 아무것도 없는 순간이 생긴다.
      const la = gl.a[i]! * sub;
      let a = (la + (alpha - la) * c) * fog * shade;
      /* 앉는 순간 **재귀반사처럼 한 번 튄다**(≈12px 스크롤). 점이 차가 되는 그
         순간을 눈이 집을 수 있어야 한다. 번쩍임이 끝나면 위의 `emit` 경로로
         넘어가므로 인계에 흔적이 남지 않는다. */
      const flash = cExt > 1 ? 1 - smooth((cExt - 1) / GLYPH_FLASH) : 0;
      if (flash > 0) a *= 1 + GLYPH_FLASH_GAIN * flash;
      /* LOD 밖의 자리는 앉자마자 꺼진다. 그래야 인계에서 `drawCar` 가 찍는 lod
         개의 점과 **정확히 같은 집합**이 남는다. */
      /* 여분(한 자리에 겹쳐 내려앉는 점·LOD 밖 자리)은 **닿기 직전에 스러진다.**
         그래야 넓게 퍼진 무리가 차로 **압축**되는 것으로 읽히고, 마지막에 같은
         자리에 겹쳐 쌓여 밝은 덩어리가 되지 않는다. */
      if (spare) a *= 1 - smooth(clamp01((cExt - 0.72) / 0.28));
      if (a < 0.05) return;
      if (a > 1) a = 1;

      /* **공중에서는 크기가 자라지 않는다.** 예전에는 `size·inv` 로 보간해서,
         카메라에 가까운 차로 가는 점이 비행 중반에 벌써 4~6px 짜리 회색 사각형이
         됐다 — 스캔한 점이 아니라 블록이 떠다니는 것으로 보였다. 공중의 점은
         1px 이고, 차체 점 크기가 되는 것은 **앉은 뒤**다(그 경로는 `emit`). */
      let ps = c >= 1 ? ((size * inv + 0.5) | 0) : GLYPH_PS;
      if (ps < 1) ps = 1;
      else if (ps > 9) ps = 9;

      /* 계측(검사기 전용): 옮겨 간 거리 · 목표 차 상자 안에 든 점 · 차체 색으로
         갈아탄 점. 공중에 있는 동안 뒤 둘이 0 이어야 한다. */
      moveSum += Math.abs(sx - lx) + Math.abs(sy - ly);
      moveN++;
      // 프레임당 이동량 — 부드러움의 자다. 점이 튀면 여기가 커진다.
      const px0 = gl.lastX[i]!;
      if (px0 === px0 && gl.lastF[i] === frameN - 1) {
        const d = Math.abs(sx - px0) + Math.abs(sy - gl.lastY[i]!);
        stepSum += d;
        stepN++;
        if (d > stepMax) stepMax = d;
        if (d > 12) stepBig++;
      }
      gl.lastX[i] = sx;
      gl.lastY[i] = sy;
      gl.lastF[i] = frameN;
      const near = gCarPx * 0.2 + 1;
      if (Math.abs(sx - tx) < near && Math.abs(sy - ty) < near) ghostN++;
      /* 색은 **앉는 순간에만** 갈아탄다. 공중의 점은 글자 색(흰색)이다 — 날아가는
         도중에 차체 색이 되면 그것도 "이미 차가 있다"로 읽힌다. */
      let bin = gl.b[i]!;
      if (c >= 1 && flash <= GLYPH_FLASH_SWAP) {
        swapN++;
        bin = b;
      }
      putInk(sx, sy, bin, a, ps);
    };

    /* ① 정적 씬 — 원경 구조물 + 먼 노면. 스윕 빔이 여기를 훑는다. */
    for (let i = 0; i < n; i++) {
      let dz = zw[i] - camZ;
      if (dz < 0) dz += SCENE_LEN;
      if (dz < near) continue;

      let fog = 1 - dz * INV_FAR;
      if (fog <= 0.02) continue;
      fog *= fog;

      const inv = f / dz;
      const sx = cx + (xw[i] - camX) * inv;
      if (sx < -8 || sx > W + 8) continue;
      const sy = cy + (camY - yw[i]) * inv;
      if (sy < -8 || sy > H + 8) continue;
      let shade = 1;
      if (cowlOn) {
        let c = (sx * colK) | 0;
        if (c < 0) c = 0;
        else if (c > COWL_COLS) c = COWL_COLS;
        const over = (sy - cowl[c]!) * invCowlSoft;
        if (over > 0) {
          if (over >= 1) continue;
          shade = 1 - over;
        }
      }
      {
        let qx = (sx * qxk) | 0;
        if (qx < 0) qx = 0;
        else if (qx >= QW) qx = QW - 1;
        let qy = (sy * qyk) | 0;
        if (qy < 0) qy = 0;
        else if (qy >= QH) qy = QH - 1;
        shade *= quiet[qy * QW + qx]!;
      }

      let boost = 0;
      if (sx >= bLo && sx < bHi) {
        lastHit[i] = elapsed;
        seen[i] = 1;
        boost = kBoost;
      } else {
        const lh = lastHit[i];
        if (lh >= 0) {
          const age = elapsed - lh;
          if (age < TAU_CUT) boost = kBoost * Math.exp(-age / TAU);
        }
      }

      const gate = seen[i] ? 1 : introFade;
      if (gate <= 0) continue;

      let a = baseA[i] * fog * gate * shade * (1 + boost);
      if (dz < nearFade) {
        const t = (dz - near) / nearSpan;
        a *= t * t;
      }
      if (a < 0.05) continue;
      if (a > 1) a = 1;

      let ak = (a * ALPHA_STEPS) | 0;
      if (ak > ALPHA_STEPS - 1) ak = ALPHA_STEPS - 1;

      let ps = (sw[i] * inv + 0.5) | 0;
      if (ps < 1) ps = 1;
      else if (ps > 5) ps = 5;

      const bin = bucket[i]! * ALPHA_STEPS + ak;
      vsx[vc] = sx | 0;
      vsy[vc] = sy | 0;
      vps[vc] = ps;
      vbin[vc] = bin;
      binCount[bin]++;
      vc++;
    }

    /* ② 근거리 층 — 카메라 상대. 대역이 카메라 높이를 따라 늘어난다. */
    {
      const dCam = still || Number.isNaN(st.drawnZ) ? 0 : st.camZ - st.drawnZ;
      const rdz = rel.dz;
      const gate = introFade;
      // 대역별 [시작, 길이] 와 직전 프레임 값 — 카메라가 오르면 선형 재사상한다.
      const lo0 = st.relZ0;
      const sp0 = st.relSpan;
      for (let b = 0; b < REL_BANDS.length; b++) {
        lo1[b] = relLo(b, dzBottom);
        sp1[b] = Math.max(0.5, relHi(b, dzBottom) - lo1[b]!);
      }
      for (let i = 0; i < rel.n; i++) {
        const b = rel.band[i]!;
        const z0 = lo1[b]!;
        const span = sp1[b]!;
        // 대역 재사상(카메라 상승) + 주행(깊이가 그만큼 줄어든다)
        let d = z0 + ((rdz[i]! - lo0[b]!) * span) / sp0[b]! - dCam;
        // 대역을 벗어나면 반대쪽 끝으로 되접는다
        if (d < z0 || d >= z0 + span) {
          d -= Math.floor((d - z0) / span) * span;
          if (rel.dash[i]) {
            // 파선은 도색 구간 안으로 스냅한다 — 되접힐 때마다 깜빡이지 않게.
            const wz = camZ + d;
            const ph = wz - Math.floor(wz / DASH_PERIOD) * DASH_PERIOD;
            if (ph > DASH_ON) d += DASH_PERIOD - ph;
          }
        }
        rdz[i] = d;
        const wz = camZ + d;
        emit(
          rel.x[i]! + curveX(wz),
          rel.y[i]! + curveY(wz),
          d,
          rel.bucket[i]!,
          rel.baseA[i]! * gate,
          rel.sw[i]!,
        );
      }
      for (let b = 0; b < REL_BANDS.length; b++) {
        lo0[b] = lo1[b]!;
        sp0[b] = sp1[b]!;
      }
    }

    /* ③ 배역 — 같은 원근 투영으로 그린다. 따로 노는 2D 오버레이가 아니다. */
    let carsDrawn = 0;
    /* 그린 차량의 점유 상자(깊이·횡위치·길이·폭)를 모은다. 서로 다른 시뮬(플래툰·
       옆 차로 링·연출 차량)이 같은 공간을 쓰면 차가 겹쳐 보이는데, 화면만 봐서는
       놓치기 쉬워 매 프레임 직접 센다. `roadProbe.overlap` 으로 나간다. */
    const boxZ = buf.boxZ;
    const boxX = buf.boxX;
    const boxL = buf.boxL;
    const boxW = buf.boxW;
    let nBox = 0;
    const box = (dz: number, lane: number, len: number, wid: number): void => {
      if (nBox >= boxZ.length) return;
      boxZ[nBox] = dz;
      boxX[nBox] = lane;
      boxL[nBox] = len;
      boxW[nBox] = wid;
      nBox++;
    };

    /**
     * 차 한 대. `dz0` 은 **후면 하단 중앙**까지의 깊이다(템플릿 원점).
     * IDM 의 `veh.x` 는 앞범퍼 위치이므로 차 길이만큼 빼서 넘긴다 —
     * 예전에는 이 보정이 없어서 차체가 한 대 길이만큼 앞에 그려졌다.
     */
    const drawCar = (
      tpl: CarTemplate,
      wz: number,
      dz0: number,
      lane: number,
      wid: number,
      alpha: number,
      braking: boolean,
      /** 진행 방향. −1 이면 차가 우리를 마주 본다. */
      dir: number,
      /**
       * 이 차의 앞쪽 `gN` 개 점이 **첫 화면 글자에서 온다**(글자 점 배열의 `gOff`
       * 부터). 0 이면 평범한 차다 — 히어로 구간의 대열·옆 차로에서만 0 이 아니다.
       */
      gOff = 0,
      gN = 0,
    ): void => {
      const baseX = curveX(wz) + lane;
      const baseY = curveY(wz);
      // 차는 도로 선형을 따라 선다. 마주 오는 차는 180° 돌아 있다.
      const th = Math.atan(curveDx(wz)) + (dir < 0 ? Math.PI : 0);
      const cth = Math.cos(th);
      const sth = Math.sin(th);
      // 화면 폭(px)으로 LOD 를 정한다 — 100m 밖의 차에 300점을 찍을 이유가 없다.
      const px = (wid * f) / dz0;
      // 가까운 차는 촘촘히, 먼 차는 등화류와 윤곽만. 계수는 화면에서 정했다 —
      // 2.6 이면 10m 앞 차가 템플릿의 38%만 찍혀 껍데기가 뚫려 보였다.
      let lod = (18 + px * 5) | 0;
      if (lod > tpl.n) lod = tpl.n;

      /* 글자가 자리 잡는 중인 차는 **등장 일정이 글자에 있다.** `fleetK` 가 정한
         페이드인(`alpha`)을 그대로 쓰면, 글자는 벌써 차체에 내려앉았는데 차는
         아직 투명한 일이 생긴다(실제로 4·5번째 앞차가 그랬다). 글자가 다 닿으면
         정확히 1 이고, 그 시점에는 `alpha` 도 1 이라 넘겨받는 자리가 매끄럽다. */
      let aCar = alpha;
      let aRest = alpha;
      /** 이 차가 조립 순서에서 차지하는 구간 [ord0, ord0 + ordK]. */
      let ord0 = 0;
      let ordK = 1;
      if (gN > 0) {
        gCarPx = px;
        const gl = glyphRef.current;
        if (gl) {
          /* **차는 순서대로 쌓인다.** 무리(우리 차로 / 옆 차로) 안에서 이 차가
             받은 점의 구간이 곧 순서다 — 배정이 가까운 차부터 채워지므로 화면에서
             가장 큰 차가 가장 먼저·가장 오래 조립된다. */
          const grpNext = gOff >= gl.nextOff;
          const grpOff = grpNext ? gl.nextOff : gl.laneOff;
          const grpN = Math.max(1, grpNext ? gl.nextN : gl.laneN);
          ord0 = (gOff - grpOff) / grpN;
          ordK = gN / grpN;
          /* 이 차의 **마지막 점**이 앉는 시점. 그 전에는 빈 자리를 채우지 않는다 —
             조립 중인 차는 쌓인 점만 보여야 "쌓이는 중"으로 읽힌다. 다만 이미 제
             알파로 서 있던 차를 지워서는 안 된다. */
          const last = gl.asm0 + (ord0 + ordK) * gl.asmSpread;
          aRest = Math.max(alpha, smooth(clamp01((hp - last) * gl.flyK)));
        }
        // 앉은 점은 곧바로 **차의 최종 알파**로 굳는다. hp = 1 의 `va` 와 같은 값이다.
        aCar = 1;
      }

      /* **한 자리에 여러 점이 내려앉는다.** 차 한 대의 자리는 템플릿 점 수(≈300)
         뿐인데 글자 점은 만 단위다 — 자리에 맞춰 점을 줄이면 첫 화면이 성긴
         격자가 되고("점들이 훨씬 작고 더 많이 퍼져서 압도되면 좋겠어"), 자리를
         못 얻은 점을 버리면 글자의 대부분이 도로에 닿지 않는다. 그래서 같은
         자리로 `dup` 개가 함께 내려오고, **닿기 직전에 여분이 스러진다** — 넓게
         퍼진 무리가 차로 압축되는 것으로 읽힌다. */
      const dup = gN > 0 ? Math.ceil(gN / tpl.n) : 1;
      const used = gN > 0 ? Math.min(tpl.n, Math.ceil(gN / dup)) : 0;
      for (let m = 0; m < gN; m++) {
        const j = (m / dup) | 0;
        if (j >= tpl.n) break;
        const lx = tpl.lx[j]!;
        const lz = tpl.lz[j]!;
        /* 차 안의 순서는 **뒤에서 앞으로**(카메라에 가까운 면부터) — 스캐너가
           훑듯이 쌓인다. 그래서 조립 중인 차는 흐릿한 전체가 아니라 **반쪽이
           또렷하고 반쪽이 없는** 모습이 된다. 흔들림을 조금 섞어 기계적인 평면
           스윕이 되지 않게 한다. */
        const jit = (((m * 1103515245 + 12345) & 0xffff) / 65535 - 0.5) * GLYPH_ORD_JITTER;
        glyphEmit(
          baseX + lx * cth + lz * sth,
          baseY + tpl.ly[j]!,
          dz0 - lx * sth + lz * cth,
          braking && tpl.lamp[j] ? RAMP_BUCKETS - 1 : tpl.bucket[j]!,
          tpl.baseA[j]! * aCar,
          tpl.sw[j]!,
          gOff + m,
          ord0 + ordK * clamp01(tpl.ordz[j]! + jit),
          // 한 자리의 **첫 점만** 남는다. 나머지와 LOD 밖 자리는 닿기 전에 스러진다.
          m !== j * dup || j >= lod,
        );
      }
      // 글자를 못 받은 자리는 평범한 차체 점이다.
      for (let j = used; j < lod; j++) {
        const lx = tpl.lx[j]!;
        const lz = tpl.lz[j]!;
        emit(
          baseX + lx * cth + lz * sth,
          baseY + tpl.ly[j]!,
          dz0 - lx * sth + lz * cth,
          braking && tpl.lamp[j] ? RAMP_BUCKETS - 1 : tpl.bucket[j]!,
          tpl.baseA[j]! * aRest,
          tpl.sw[j]!,
          true,
        );
      }
      // 도로 위에 실제로 몸통을 올린 차만 센다 — 글자만 들고 있는 차는 아직
      // 차가 아니다(검사기가 "도착 전 빈 도로"를 이 값으로 잰다).
      if (aRest > 0.02) carsDrawn++;
    };

    /* --- 글자 점을 차에 나눠 준다 -------------------------------------
       **프레임마다 다시 나눈다.** 차가 멀어지면 LOD 가 줄어 받을 자리도 준다.
       나누는 순서는 고정이다(글은 문서 순서, 차는 가까운 순서) — 그래야 같은
       글자가 프레임마다 다른 차로 튀지 않는다.

       받을 자리가 모자라 남은 점은 흩어져 사라진다(§돌아오지 않은 반사). */
    const slots = slotRef.current;
    if (glyphOn) {
      const gl = glyphRef.current!;
      slots.laneN.fill(0);
      slots.nextN.fill(0);
      const lods = slots.lods;
      const take = slots.take;
      const col0 = fleet.cols[0]!;

      /**
       * 그 차가 받을 수 있는 점 수 — **템플릿 전체**다.
       *
       * LOD 만큼만 받게 했더니 데스크톱에서 자리가 1,950개뿐이라 글자 점을
       * 2,000개 넘게 구울 수 없었고, 그중 300개는 자리를 못 얻어 흩어졌다.
       * LOD 는 "멀리 있는 차에 점을 낭비하지 말자"는 예산 규칙인데, 글자가
       * 내려앉는 동안에는 그 점들이 **이미 화면에 있다**(글자 자리에) — 아낄
       * 것이 없다. 자리를 못 얻어 사라지는 것보다 촘촘한 차가 낫다.
       * LOD 밖의 점은 도착 직전(e 0.9→1)에 꺼져 인계가 매끄럽다(`drawCar`).
       */
      const seatsOf = (tpl: CarTemplate): number => tpl.n * GLYPH_DUP_MAX;
      /** 대열 k번째 차의 후면 깊이(m). `drawCar` 에 넘기는 값과 같다. */
      const laneDz = (k: number): number => {
        const veh = vehicles[k];
        return veh ? veh.x - veh.length - ego.x + back : Number.NaN;
      };
      /** 옆 차로 id 의 후면 깊이(m). */
      const nextDz = (id: number): number => {
        const veh = col0.veh.find((v) => v.id === id);
        if (!veh) return Number.NaN;
        const ring = veh.x - veh.length;
        const wz = ring - Math.floor(ring / SCENE_LEN) * SCENE_LEN;
        let dz0 = wz - camZ;
        if (dz0 < 0) dz0 += SCENE_LEN;
        return dz0;
      };

      /* **받을 차는 연출이 시작될 때 정해 두고 얼린다.** 매 프레임 다시 고르면
         한 대가 창을 드나들 때마다 배정이 통째로 한 칸씩 밀려, 날아가던 글자가
         다른 차로 옮겨 붙는다(실측: 한 프레임에 554점). 다시 고르는 때는 연출
         밖(맨 위로 되올라갔을 때)뿐이다. */
      /* 다시 고르는 때: 연출 **밖**이다 — 맨 위로 되올라갔거나(hp≈0), 이미 전부
         자리를 잡았거나(hp ≥ GLYPH_END). 다 잡은 뒤에는 어느 점이 어느 차의
         몇 번째 자리인지가 그림에 남지 않으므로(차는 어차피 LOD 만큼 찍는다)
         이때 다시 골라도 화면은 한 픽셀도 달라지지 않는다. */
      if (!slots.ordered || hp <= 0.02 || hp >= GLYPH_END) {
        slots.laneK = 0;
        for (let i = 1; i <= FLEET_N; i++) {
          const dz0 = laneDz(i);
          if (!(dz0 >= near) || dz0 > FAR) continue;
          slots.laneIds[slots.laneK++] = i;
        }
        const rank: [number, number][] = [];
        for (const veh of col0.veh) {
          const dz0 = nextDz(veh.id);
          if (!(dz0 >= GLYPH_DZ_MIN) || dz0 > GLYPH_DZ_MAX) continue;
          rank.push([veh.id, dz0]);
        }
        rank.sort((a, b) => a[1] - b[1]);
        slots.nextK = Math.min(NEXT_N, rank.length);
        for (let i = 0; i < slots.nextK; i++) slots.nextIds[i] = rank[i]![0];
        slots.ordered = true;
      }

      /* 한 무리를 차들에 **가까운 차부터 가득** 나눈다.
         한때 고르게 돌렸다. 그때는 점이 다 같이 한 순간에 수렴해서, 한 차에 몰리면
         그 자리에 덩어리 하나가 생겼기 때문이다. 지금은 차례로 **쌓이므로** 반대다
         — 화면에서 가장 큰 차가 MAIA 로 통째로 만들어지는 편이 강렬하고, 남는
         점이 다음 차로 넘어가는 것이 "다 만들고 다음 차"로 읽힌다. */
      const share = (
        ids: Int32Array,
        k: number,
        from: number,
        to: number,
        off: Int32Array,
        cnt: Int32Array,
      ): number => {
        if (k <= 0 || to <= from) return from;
        let left = to - from;
        for (let i = 0; i < k; i++) {
          const t = Math.min(lods[i]!, left);
          take[i] = t;
          left -= t;
        }
        // 자리는 **차 순서대로 이어서** 준다 — 한 차가 받는 점이 붙어 있어야
        // 템플릿 점 0…n 에 그대로 대응한다.
        let cur = from;
        for (let i = 0; i < k; i++) {
          off[ids[i]!] = cur;
          cnt[ids[i]!] = take[i]!;
          cur += take[i]!;
        }
        return cur;
      };

      /* ① 우리 차로의 앞차 대열 — 가까운 차가 앞에 온다(k 가 곧 순서다). */
      for (let i = 0; i < slots.laneK; i++) {
        const k = slots.laneIds[i]!;
        const dz0 = laneDz(k);
        const sh = cars[fleet.shape[k]!]!;
        lods[i] = dz0 >= near && dz0 <= FAR ? seatsOf(sh.rear) : 0;
      }
      const laneEnd = gl.laneOff + gl.laneN;
      slots.lost[0] = share(
        slots.laneIds,
        slots.laneK,
        gl.laneOff,
        laneEnd,
        slots.laneOff,
        slots.laneN,
      );
      slots.lost[1] = laneEnd;

      /* ② 옆 차로 — 창 안에 있는 차만, 얼린 순서대로. */
      for (let i = 0; i < slots.nextK; i++) {
        const id = slots.nextIds[i]!;
        const dz0 = nextDz(id);
        const sh = cars[col0.shape[id]!]!;
        lods[i] = dz0 >= near && dz0 <= FAR ? seatsOf(sh.rear) : 0;
      }
      const nextEnd = gl.nextOff + gl.nextN;
      slots.lost[2] = share(
        slots.nextIds,
        slots.nextK,
        gl.nextOff,
        nextEnd,
        slots.nextOff,
        slots.nextN,
      );
      slots.lost[3] = nextEnd;
    } else {
      slots.laneN.fill(0);
      slots.nextN.fill(0);
      slots.lost[0] = slots.lost[1] = slots.lost[2] = slots.lost[3] = 0;
    }

    /* ③a 자차 + 앞차 플래툰 (우리 차로) ------------------------------- */
    // 자차는 카메라가 충분히 뒤로 빠진 뒤에만 보인다(대시캠 구간에서는 내가 그 차다).
    const egoA = smooth(clamp01((riseK - 0.22) / 0.35));
    const egoX = ego.x;
    /* 글자를 들고 있는 차는 **아직 등장 전이라도** 그린다. 글자 점은 그 차의
       차체 점 자리로 가는 것이지 차의 알파를 따르지 않는데(치환 구간에는 아직
       글자 위에 있다), 차를 통째로 걸러내면 그 점들이 하나도 안 그려진다 —
       실제로 여는 화면에서 M 만 점이 되고 A·I·A 는 나타나지 않았다. */
    if (fleetG > 0.004 || egoA > 0.02 || glyphOn) {
      for (let k = vehicles.length - 1; k >= 0; k--) {
        const veh = vehicles[k]!;
        // 후면 기준 깊이 — 앞범퍼(veh.x)에서 차 길이를 뺀다.
        const dz0 = veh.x - veh.length - egoX + back;
        if (dz0 < near || dz0 > FAR) continue;
        // 멀리 있는 차부터 한 대씩 나타난다 — 선두가 먼저, 바로 앞차가 마지막.
        const order = (k - 1) / FLEET_N;
        const va = k === 0 ? egoA : clamp01((fleetG - order * 0.62) / 0.2);
        if (va <= 0.02 && slots.laneN[k]! === 0) continue;
        const sh = cars[fleet.shape[k]!]!;
        const lane = laneOf(k);
        box(dz0, lane, veh.length, sh.shape.wid);
        drawCar(
          sh.rear,
          camZ + dz0,
          dz0,
          lane,
          sh.shape.wid,
          va,
          veh.a < BRAKE_LAMP,
          1,
          slots.laneOff[k]!,
          slots.laneN[k]!,
        );
      }
    }

    /* 04막 합류차가 들어갈 자리 — **뒷차가 열어 준 간격의 한가운데**.
       옆 차로 링 시뮬은 우리 차로의 플래툰을 모르기 때문에, 횡방향으로만 밀어
       넣으면 앞차나 뒷차 몸통을 뚫고 들어간다(실측: 최대 1.78m 침투).
       종방향 목표도 같이 잡아 주면 겹칠 수가 없다. */
    let mergeTargetDz = Number.NaN;
    let mergeAllow = 0;
    let mergeMz = 0;
    let mergeMx = 0;
    if (fleet.mergeIdx >= 0 && fleet.mergeK > 0) {
      const partner = vehicles[MERGE_PARTNER]!;
      const ahead = vehicles[MERGE_PARTNER + 1]!;
      const zBack = partner.x - egoX + back; // 뒷차 앞범퍼
      const zFront = ahead.x - ahead.length - egoX + back; // 앞차 뒤범퍼
      mergeTargetDz = (zBack + zFront) * 0.5;
      /* 간격이 차 한 대 + 여유만큼 열리기 전에는 들어가지 않는다.
         협조 합류의 정의가 그것이다 — 비집고 드는 것이 아니라 **열릴 때까지 기다린다.**
         덤으로 몸통이 겹칠 수가 없다. */
      const mvv = fleet.cols[0]!.veh.find((v) => v.id === fleet.mergeIdx);
      const need = (mvv ? mvv.length : 4.6) + 2.4;
      mergeAllow = clamp01((zFront - zBack - need) / 2.5);
      /* **종방향을 먼저 맞추고, 그 다음에 차로를 바꾼다.**
         두 축을 같은 속도로 움직이면 아직 간격에 못 맞춘 채 차로 위로 올라와
         플래툰 차를 스친다(실측에서 0.62m 남아 있었다). 실제 운전도 이 순서다 —
         간격에 맞춰 속도를 조절한 뒤에 핸들을 튼다. */
      mergeMz = smooth(fleet.mergeK) * mergeAllow;
      mergeMx = smooth(clamp01((fleet.mergeK - 0.35) / 0.65)) * mergeAllow;
    }

    /* **예약된 자리** — 연출이 직접 위치를 정하는 차량(03막 배차 차량, 04막 합류차)이
       차지한 공간. 옆 차로 링 시뮬은 이 차들을 모르기 때문에, 같은 자리에 있는 차를
       부드럽게 비켜 준다. 딱 끊으면 깜빡이므로 TAXI_CLEAR 만큼의 여유에서 서서히 진다.

       거리는 **차체 상자의 분리 거리**로 잰다(분리축 정리). 정규화한 거리로 재면
       실제로는 겹치는데 반투명으로만 남아 그대로 겹쳐 보인다 — 한 번 그랬다. */
    let nRes = 0;
    const resDz = resZBuf;
    const resX = resXBuf;
    const resL = resLBuf;
    const resW = resWBuf;
    const reserve = (dz: number, x: number, len: number, wid: number): void => {
      if (nRes >= resDz.length) return;
      resDz[nRes] = dz;
      resX[nRes] = x;
      resL[nRes] = len;
      resW[nRes] = wid;
      nRes++;
    };
    if (fleet.taxi.on && actK[ACT_SERVICE]! > 0.02) {
      reserve(
        fleet.taxi.dz,
        fleet.taxi.x,
        cars[fleet.taxi.shape]!.shape.len,
        cars[fleet.taxi.shape]!.shape.wid,
      );
    }
    if (
      fleet.mergeIdx >= 0 &&
      Number.isFinite(mergeTargetDz) &&
      mergeAllow > 0
    ) {
      const mv = fleet.cols[0]!.veh.find((v) => v.id === fleet.mergeIdx);
      if (mv) {
        const ring = mv.x - mv.length;
        const wz = ring - Math.floor(ring / SCENE_LEN) * SCENE_LEN;
        let d = wz - camZ;
        if (d < 0) d += SCENE_LEN;
        reserve(
          d + (mergeTargetDz - mv.length * 0.5 - d) * mergeMz,
          LANE_NEXT + (LANE_X - LANE_NEXT) * mergeMx,
          mv.length,
          cars[fleet.cols[0]!.shape[mv.id]!]!.shape.wid,
        );
      }
    }

    /** 예약된 자리와의 여유(m). 음수면 겹친다. */
    const clearance = (
      dz: number,
      x: number,
      len: number,
      wid: number,
    ): number => {
      let worst = Infinity;
      for (let i = 0; i < nRes; i++) {
        const dzGap = Math.abs(dz - resDz[i]!) - (len + resL[i]!) * 0.5;
        const dxGap = Math.abs(x - resX[i]!) - (wid + resW[i]!) * 0.5;
        const c = Math.max(dzGap, dxGap);
        if (c < worst) worst = c;
      }
      return worst;
    };

    /* ③b 옆 차로 · 마주 오는 차로 --------------------------------------
       이쪽은 링 좌표라 월드 z 로 되사상한다. 같은 방향은 링 좌표가 그대로
       주행거리이고, 마주 오는 차로는 부호를 뒤집어 우리 쪽으로 다가오게 한다. */
    if (fleetG > 0.004 || glyphOn) {
      for (let ci = 0; ci < fleet.cols.length; ci++) {
        const col = fleet.cols[ci]!;
        for (let k = 0; k < col.veh.length; k++) {
          const veh = col.veh[k]!;
          // 아직 등장 전이어도 글자를 들고 있으면 그린다(§③a 와 같은 이유).
          const gN = ci === 0 ? slots.nextN[veh.id]! : 0;
          if (fleetG <= 0.004 && gN === 0) continue;
          const ring = veh.x - veh.length;
          // 월드 z — 씬과 같은 주기(SCENE_LEN)라 되접는 지점에서 어긋나지 않는다.
          let wz = col.dir > 0 ? ring : SCENE_LEN - ring;
          wz -= Math.floor(wz / SCENE_LEN) * SCENE_LEN;
          let dz0 = wz - camZ;
          if (dz0 < 0) dz0 += SCENE_LEN;
          if (dz0 < near || dz0 > FAR) continue;
          const sh = cars[col.shape[veh.id]!]!;
          let lane = colLane(ci, col, veh.id);
          let a = fleetG;
          // 04막: 옆 차로 한 대가 협조 합류로 우리 차로에 들어온다.
          // 횡·종방향을 **같은 진행도로 함께** 옮긴다 — 옆으로만 밀면 몸통이 겹친다.
          if (
            ci === 0 &&
            veh.id === fleet.mergeIdx &&
            Number.isFinite(mergeTargetDz)
          ) {
            lane = LANE_NEXT + (LANE_X - LANE_NEXT) * mergeMx;
            dz0 += (mergeTargetDz - veh.length * 0.5 - dz0) * mergeMz;
            if (dz0 < near || dz0 > FAR) continue;
          } else if (nRes > 0) {
            const clear = clearance(dz0, lane, veh.length, sh.shape.wid);
            if (clear < 0) continue; // 겹친다 — 아예 비켜 준다
            if (clear < RESERVE_CLEAR) a *= smooth(clear / RESERVE_CLEAR);
            if (a <= 0.02) continue;
          }
          box(dz0, lane, veh.length, sh.shape.wid);
          drawCar(
            col.dir > 0 ? sh.rear : sh.front,
            camZ + dz0,
            dz0,
            lane,
            sh.shape.wid,
            a,
            col.dir > 0 && veh.a < BRAKE_LAMP,
            col.dir,
            ci === 0 ? slots.nextOff[veh.id]! : 0,
            gN,
          );
        }
      }
    }

    /* 자리를 못 얻은 글자 점 — **돌아오지 않은 반사**.
       받을 차체 점보다 글자 점이 많으면 남는다. 남은 점은 소실점 쪽으로 흘러가다
       절반쯤에서 스러진다 — 도로 밖으로 튕겨 나가는 것이 아니라 도로 안쪽으로
       빨려 드는 것이라 "글자가 도로로 들어갔다"는 읽기를 깨지 않는다. */
    if (glyphOn) {
      const gl = glyphRef.current!;
      const ax = cx;
      const ay = cy + H * 0.03;
      for (let g = 0; g < 2; g++) {
        const from = slots.lost[g * 2]!;
        const to = slots.lost[g * 2 + 1]!;
        /* 자리를 못 얻은 점은 **모이지 않는다.** 조립이 도는 동안 제자리에서
           풀어지다 스러진다 — 어디로도 가지 않으니 순서도 없다. */
        const eLost = smooth(
          clamp01((hp - gl.asm0) / Math.max(1e-4, gl.done - gl.asm0)),
        );
        // **여기서 함수를 빠져나가면 안 된다** — 프레임의 나머지가 통째로 날아간다.
        if (eLost >= GLYPH_LOST) continue;
        const fadeLost = 1 - smooth(eLost / GLYPH_LOST);
        for (let i = from; i < to; i++) {
          const e = eLost;
          const a = gl.a[i]! * sub * fadeLost;
          if (a < 0.05) continue;
          const lx = st.inkLeft + gl.dx[i]!;
          const ly = st.inkTop + gl.dy[i]!;
          const dr = gl.dr[i]!;
          const sx = lx + dr * GLYPH_DRIFT_X * e + (ax - lx) * e * 0.12;
          if (sx < -8 || sx > W + 8) continue;
          const sy = ly + GLYPH_DRIFT_Y * e + (ay - ly) * e * 0.12;
          if (sy < -8 || sy > H + 8) continue;
          putInk(sx, sy, gl.b[i]!, a, (GLYPH_PS + 0.5) | 0);
        }
      }
    }

    /* ③c 인도 위의 사람들 ----------------------------------------------
       LiDAR 에서 보행자는 세로로 선 점 덩어리다. 다리를 걸음 위상에 따라
       앞뒤로 벌려 놓으면 정지한 기둥이 아니라 **걷는 사람**으로 읽힌다. */
    let pedsDrawn = 0;
    if (fleetG > 0.004) {
      const pn = ped.n;
      for (let i = 0; i < fleet.peds.length; i++) {
        const q = fleet.peds[i]!;
        let dz0 = q.z - camZ;
        if (dz0 < 0) dz0 += SCENE_LEN;
        if (dz0 < near || dz0 > FAR) continue;
        const px = (0.5 * f) / dz0;
        if (px < 1.5) continue;
        let lod = (10 + px * 1.1) | 0;
        if (lod > pn) lod = pn;
        pedsDrawn++;
        const wx = curveX(q.z) + q.x;
        const wy = curveY(q.z) + WALK_Y;
        // 걸음 — 다리는 앞뒤로, 몸은 위아래로 아주 조금.
        const swing = q.idle ? Math.sin(q.ph) * 0.34 : 0;
        const bob = q.idle ? Math.abs(Math.cos(q.ph)) * 0.022 : 0;
        for (let j = 0; j < lod; j++) {
          const limb = ped.limb[j]!;
          emit(
            wx + ped.lx[j]! * (q.v < 0 ? -1 : 1),
            wy + bob + ped.ly[j]! * q.h,
            dz0 + ped.lz[j]! + (limb ? limb * swing * (q.v < 0 ? -1 : 1) : 0),
            ped.bucket[j]!,
            ped.baseA[j]! * fleetG,
            ped.sw[j]!,
            true,
          );
        }
      }
    }

    /* ③d 막별 연출 — 노면과 차량에 **직접** 얹는다 ---------------------
       HUD 오버레이를 띄우지 않는다. 정밀도로지도 위에 계측선을 긋는 것이
       이 사이트가 쓰는 언어다.

       네 막은 **서로 다른 종류의 그림**이다. 같은 종류(예: 전부 점선 브래킷)로
       하면 주제가 바뀐 것이 아니라 주석이 바뀐 것으로 보인다 — 실제로 그랬다.
         01 차량 옆 **속도 막대**   — 교란이 뒤로 갈수록 커지는 것(스트링 불안정)
         02 노면 **속도 리본**      — 붉은 띠가 뒤로 밀려오는 것(stop-and-go 파동)
         03 **호출 → 정차 → 탑승**  — 사람과 차가 실제로 만난다
         04 **간격 양보 + V2V 링크** — 협조 합류
    */

    /**
     * 속도(m/s) → 램프 버킷. 느릴수록 뜨겁다 — 교통공학의 관례다.
     * **아래쪽을 0 이 아니라 3(청록)에서 시작한다.** 0 에서 시작하면 순항 중인
     * 계측값이 노면 산란과 같은 짙은 남색이 되어 화면에서 사라진다(실제로 그랬다).
     * 계측은 지도 위에 얹히는 것이지 지도에 섞이는 것이 아니다.
     */
    const speedBucket = (v: number, v0: number): number => {
      const t = clamp01(1 - v / v0);
      return 3 + Math.round(t * (RAMP_BUCKETS - 4));
    };

    /** 노면에 가로로 점선을 긋는다 — 차로를 가로지르는 계측선. */
    const chalk = (
      wz: number,
      lane: number,
      half: number,
      bucketIdx: number,
      alpha: number,
      stepM = 0.12,
    ): void => {
      let dz0 = wz - camZ;
      if (dz0 < nearSoft || dz0 > FAR) return;
      const bx = curveX(wz) + lane;
      const by = curveY(wz) + 0.02;
      const cnt = Math.max(1, Math.round((half * 2) / stepM));
      for (let i = 0; i <= cnt; i++) {
        emit(
          bx - half + (i * half * 2) / cnt,
          by,
          dz0,
          bucketIdx,
          alpha,
          0.09,
          true,
        );
      }
    };

    /* ── 02막 — 차량 옆 속도 막대 ────────────────────────────────────
       각 차의 옆에 속도만큼 높은 점 기둥이 선다. 선두가 밟으면 막대가 앞에서부터
       차례로 주저앉는다 — 차간거리라는 상태량이 눈에 보이는 높이가 된다.

       **이 장면에서 막대가 뒤로 갈수록 더 깊이 주저앉지는 않는다.** 12km/h·차두
       1.7s 의 상용 ACC 는 스트링 **안정** 영역이라 교란이 뒤로 가며 잦아든다
       (실측 −4 → −0.7 → −0.3 → −0.1 m/s²). 연구실 TR-C 논문이 실측한 증폭
       1.30× 는 54km/h·12대의 성질이고, 그 설정은 /research 의 TrafficSim 이
       그대로 돌린다. 여기서 참인 것은 **전파**이고, 그것만 보여준다.          */
    const aBars = actK[ACT_PLATOON]!;
    if (aBars > 0.02) {
      for (let k = 0; k < vehicles.length; k++) {
        const veh = vehicles[k]!;
        const dz0 = veh.x - veh.length * 0.5 - egoX + back;
        /* 가까운 차의 막대는 그리지 않는다. 16m 안쪽에서는 2m 남짓한 기둥이 화면
           높이의 3분의 1을 차지해, 차에 붙은 계측이 아니라 **도로에 꽂힌 초록 선**
           으로 보인다. 막대의 뜻은 여러 개를 나란히 놓고 높이를 비교하는 데 있으므로
           멀리 늘어선 것들만 남긴다(카메라가 오르는 도중 `back` 이 짧을 때 특히). */
        if (dz0 < BAR_NEAR || dz0 > FAR) continue;
        const wz = camZ + dz0;
        const lane = laneOf(k);
        // 막대는 차 왼쪽(글이 앉는 쪽 반대편이 아니라 차로 안쪽)에 세운다.
        const bx = curveX(wz) + lane - 1.35;
        const by = curveY(wz);
        const hMax = 2.2;
        const h = hMax * clamp01(veh.v / FLEET_V);
        const bi = speedBucket(veh.v, FLEET_V);
        const n2 = Math.max(1, Math.round(h / 0.13));
        for (let i = 0; i <= n2; i++) {
          emit(bx, by + (i / n2) * h, dz0, bi, 0.8 * aBars, 0.13, true);
        }
        // 바닥 기준 틱 — 막대가 노면에 뿌리내려 있어야 높이가 읽힌다
        for (let i = -2; i <= 2; i++)
          emit(bx + i * 0.14, by + 0.02, dz0, 2, 0.6 * aBars, 0.1, true);
        // 눈금 — 순항 속도 자리. 막대가 여기까지 차 있으면 평형이다.
        emit(bx - 0.26, by + hMax, dz0, 2, 0.6 * aBars, 0.1, true);
        emit(bx + 0.26, by + hMax, dz0, 2, 0.6 * aBars, 0.1, true);
        // 제동 중인 차 아래 노면에 계측선 — 교란이 어디까지 왔는지
        if (veh.a < -0.5) {
          chalk(
            wz,
            lane,
            1.1,
            RAMP_BUCKETS - 1,
            0.8 * aBars * clamp01(-veh.a / 1.5),
          );
        }
      }
    }

    /* ── 01막 — 노면 속도 리본 ───────────────────────────────────────
       옆 차로 노면을 **그 자리의 교통 속도**로 칠한다. 차가 아니라 **파(wave)가**
       뒤로 밀려오는 것이 보인다 — 정체는 차가 뒤로 가는 게 아니라 느린 구간이
       뒤로 전파되는 현상이라는 것이 이 그림의 전부다.
       막 중반부터 몇 대가 제어 AV(FollowerStopper)로 바뀌고, 그러면 리본이
       눈에 띄게 식는다. 그것이 02막의 결론이다.                            */
    const aRibbon = actK[ACT_MIX]!;
    if (aRibbon > 0.02) {
      const col = fleet.cols[0]!;
      /* 색 눈금의 기준 속도(m/s). 대열의 **실제 자유류 속도**로 잡아야 한다 —
         평형 속도(3.0)로 잡으면 그보다 빠른 구간이 전부 눈금 끝에 붙어버려
         리본이 한 색으로 납작해진다(실측으로 그랬다). */
      const v0 = 5.5;
      // 표본 지점마다 "바로 앞 차"의 속도를 쓴다 — 그 차 뒤 노면이 그 속도다.
      const step2 = 1.6;
      for (let d = nearSoft; d < 92; d += step2) {
        const wz = camZ + d;
        const ring = wz - Math.floor(wz / SCENE_LEN) * SCENE_LEN;
        // 앞쪽으로 가장 가까운 차량을 찾는다(링 경계를 넘어 감는다)
        let bestGap = Infinity;
        let bestV = v0;
        for (let k = 0; k < col.veh.length; k++) {
          const veh = col.veh[k]!;
          let g = veh.x - veh.length - ring;
          if (g < 0) g += SCENE_LEN;
          if (g < bestGap) {
            bestGap = g;
            bestV = veh.v;
          }
        }
        if (bestGap > 26) continue; // 앞차가 멀면 자유류 — 칠하지 않는다
        const bi = speedBucket(bestV, v0);
        const hot = clamp01(1 - bestV / v0);
        // 차로 폭 절반만 칠한다 — 노면 도색이 아니라 계측이라는 표시
        for (let i = 0; i < 5; i++) {
          emit(
            curveX(wz) + col.x - 1.1 + i * 0.55,
            curveY(wz) + 0.04,
            d,
            bi,
            (0.5 + 0.45 * hot) * aRibbon,
            0.16,
            true,
          );
        }
      }
      // 제어 AV 에는 지붕 위에 표식이 선다 — 어느 차가 파동을 잡는지 보여야 한다.
      for (let k = 0; k < col.veh.length; k++) {
        const veh = col.veh[k]!;
        if (!veh.fs) continue;
        const ring = veh.x - veh.length;
        const wz = ring - Math.floor(ring / SCENE_LEN) * SCENE_LEN;
        let dz0 = wz - camZ;
        if (dz0 < 0) dz0 += SCENE_LEN;
        if (dz0 < nearSoft || dz0 > FAR) continue;
        const roof = cars[col.shape[veh.id]!]!.shape.roof;
        for (let i = 0; i < 6; i++) {
          emit(
            curveX(wz) + colLane(0, col, veh.id),
            curveY(wz) + roof + 0.2 + i * 0.14,
            dz0 + 2.2,
            RAMP_BUCKETS - 1,
            0.95 * aRibbon,
            0.1,
            true,
          );
        }
      }
    }

    /* ── 03막 — 호출 → 정차 → 탑승 → 출발 ───────────────────────────
       배경의 차와 사람이 **실제로 만나는** 유일한 막이다. 배차선이 인도까지
       뻗고, 차가 차로를 벗어나 갓길에 붙고, 사람이 걸어와 사라진다(탑승).   */
    const aPickup = actK[ACT_SERVICE]!;
    if (aPickup > 0.02 && taxi.on) {
      const u = clamp01(actU[ACT_SERVICE]!);
      const sh = cars[taxi.shape]!;
      const dzT = taxi.dz;
      if (dzT > nearSoft && dzT < FAR) {
        box(dzT, taxi.x, sh.shape.len, sh.shape.wid);
        drawCar(
          sh.rear,
          camZ + dzT,
          dzT,
          taxi.x,
          sh.shape.wid,
          aPickup,
          taxi.brake,
          1,
        );
        // 지붕 표식 — 이 차가 배차된 차다
        for (let i = 0; i < 6; i++) {
          emit(
            curveX(camZ + dzT) + taxi.x,
            curveY(camZ + dzT) + sh.shape.roof + 0.2 + i * 0.14,
            dzT + 2.2,
            RAMP_BUCKETS - 2,
            0.95 * aPickup,
            0.11,
            true,
          );
        }
      }
      const dzP = taxi.paxDz;
      if (!taxi.paxGone && dzP > nearSoft && dzP < FAR) {
        // 승객 — 인도 위 보행자와 같은 점군이지만 이 사람만 걸음이 스크립트를 따른다
        const wz = camZ + dzP;
        const wx = curveX(wz) + taxi.paxX;
        const wy = curveY(wz) + WALK_Y;
        const swing = Math.sin(taxi.paxPh) * 0.34;
        const px = (0.5 * f) / dzP;
        let lod = (12 + px * 1.2) | 0;
        if (lod > ped.n) lod = ped.n;
        for (let j = 0; j < lod; j++) {
          const limb = ped.limb[j]!;
          emit(
            wx + ped.lx[j]!,
            wy + ped.ly[j]!,
            dzP + ped.lz[j]! + (limb ? limb * swing : 0),
            ped.bucket[j]!,
            Math.min(1, ped.baseA[j]! * 1.5) * aPickup,
            ped.sw[j]! * 1.15,
            true,
          );
        }
        // 호출 표식 — 승객 머리 위 1px 계측 기둥. 타러 나서면 꺼진다.
        const pinA = aPickup * (1 - smooth(clamp01((u - 0.4) / 0.12)));
        if (pinA > 0.02) {
          const pulse = 0.55 + 0.45 * Math.sin(elapsed * 3.1);
          for (let i = 0; i < 9; i++) {
            emit(
              wx,
              wy + 1.95 + i * 0.13,
              dzP,
              RAMP_BUCKETS - 2,
              pinA * pulse,
              0.1,
              true,
            );
          }
        }
        // 배차선 — 차에서 승객까지. 도착하면 사라진다.
        const routeA = aPickup * (1 - smooth(clamp01((u - 0.34) / 0.12)));
        if (routeA > 0.02) {
          const seg = 24;
          for (let i = 0; i <= seg; i++) {
            const tt = i / seg;
            const d = dzT + (dzP - dzT) * tt;
            if (d < nearSoft || d > FAR) continue;
            const wz2 = camZ + d;
            const flow =
              0.3 +
              0.7 * Math.max(0, Math.sin((tt - elapsed * 0.6) * TWO_PI * 1.4));
            emit(
              curveX(wz2) + taxi.x + (taxi.paxX - taxi.x) * tt,
              curveY(wz2) + 0.04,
              d,
              RAMP_BUCKETS - 3,
              routeA * flow,
              0.12,
              true,
            );
          }
        }
      }
    }

    /* ── 04막 — 간격 양보 + V2V 링크 ─────────────────────────────────
       옆 차로 한 대가 우리 차로로 들어온다. 협조 자율주행의 핵심은 **뒷차가
       먼저 간격을 내준다**는 것이다 — 그래서 뒷차의 속도 막대가 먼저 줄고,
       그 사이에 링크가 맺히고, 그 다음에 차가 들어온다.                     */
    const aLink = actK[ACT_CDA]!;
    if (aLink > 0.02) {
      const link = (
        zA: number,
        xA: number,
        yA: number,
        zB: number,
        xB: number,
        yB: number,
        alpha: number,
      ): void => {
        const seg = 22;
        for (let i = 0; i <= seg; i++) {
          const tt = i / seg;
          const wz = zA + (zB - zA) * tt;
          const d = wz - camZ;
          if (d < nearSoft || d > FAR) continue;
          // 신호가 한쪽으로 흐르는 것처럼 — 밝기로만 표시한다(굵기는 일정).
          const flow =
            0.45 +
            0.55 * Math.max(0, Math.sin((tt - elapsed * 0.55) * TWO_PI * 1.5));
          emit(
            curveX(wz) + xA + (xB - xA) * tt,
            curveY(wz) + yA + (yB - yA) * tt,
            d,
            RAMP_BUCKETS - 2,
            alpha * flow,
            0.17,
            true,
          );
        }
      };
      // 플래툰 내부 링크 — 대열 전체가 연결돼 있다는 표시
      for (let k = 0; k < vehicles.length - 1; k++) {
        const me = vehicles[k]!;
        const lead = vehicles[k + 1]!;
        link(
          camZ + (me.x - egoX + back) - 0.6,
          laneOf(k),
          cars[fleet.shape[k]!]!.shape.roof + 0.18,
          camZ + (lead.x - lead.length - egoX + back) + 0.6,
          laneOf(k + 1),
          cars[fleet.shape[k + 1]!]!.shape.roof + 0.18,
          0.8 * aLink,
        );
      }
      // 합류차 ↔ 간격을 내주는 차 — 이 막의 주인공이라 가장 밝다
      if (fleet.mergeIdx >= 0 && Number.isFinite(mergeTargetDz)) {
        const col = fleet.cols[0]!;
        const veh = col.veh.find((v) => v.id === fleet.mergeIdx);
        // 주의: 여기서 `return` 하면 draw() 전체가 중단되어 프레임이 통째로 비어버린다.
        if (veh) {
          const ring = veh.x - veh.length;
          const wz = ring - Math.floor(ring / SCENE_LEN) * SCENE_LEN;
          let dz0 = wz - camZ;
          if (dz0 < 0) dz0 += SCENE_LEN;
          dz0 += (mergeTargetDz - veh.length * 0.5 - dz0) * mergeMz;
          const lane = LANE_NEXT + (LANE_X - LANE_NEXT) * mergeMx;
          const roof = cars[col.shape[veh.id]!]!.shape.roof + 0.18;
          const partner = vehicles[MERGE_PARTNER]!;
          const pz = camZ + (partner.x - egoX + back);
          link(
            camZ + dz0,
            lane,
            roof,
            pz,
            laneOf(MERGE_PARTNER),
            cars[fleet.shape[MERGE_PARTNER]!]!.shape.roof + 0.18,
            1 * aLink,
          );
          // 열린 간격을 노면에 표시한다 — "여기가 비었다"
          const ahead = vehicles[MERGE_PARTNER + 1]!;
          const z0 = camZ + (partner.x - egoX + back);
          const z1 = camZ + (ahead.x - ahead.length - egoX + back);
          const gapA = 0.8 * aLink;
          chalk(z0, LANE_X, 1.15, RAMP_BUCKETS - 4, gapA);
          chalk(z1, LANE_X, 1.15, RAMP_BUCKETS - 4, gapA);
          const seg = Math.max(1, Math.round((z1 - z0) / 1.2));
          for (let i = 1; i < seg; i++) {
            const wz2 = z0 + ((z1 - z0) * i) / seg;
            const d = wz2 - camZ;
            if (d < nearSoft || d > FAR) continue;
            emit(
              curveX(wz2) + LANE_X,
              curveY(wz2) + 0.03,
              d,
              RAMP_BUCKETS - 4,
              gapA * 0.55,
              0.09,
              true,
            );
          }
        }
      }
    }

    /* 한때 여기서 `[data-act-gauge]` 의 칸에 배경 도로의 수치를 써 넣었다.
       홈 패널을 시뮬레이션 하나로 줄이면서 그 계측판이 사라졌다 — 같은 화면의
       두 계측이 같은 이름으로 다른 수를 가리켜 읽는 사람을 혼란스럽게 했다.
       파동의 머리·전파 거리는 이제 `roadProbe.wave` 로만 나간다(검사기용). */

    // 카운팅 정렬 — bin 순서로 모아 두면 fillStyle 을 bin 당 한 번만 만지면 된다.
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += binCount[b];
      binEnd[b] = acc;
    }
    for (let k = vc - 1; k >= 0; k--) {
      const b = vbin[k];
      const p2 = --binEnd[b];
      ssx[p2] = vsx[k];
      ssy[p2] = vsy[k];
      sps[p2] = vps[k];
    }

    /* --- 그리기 ------------------------------------------------------ */
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    // 글로우는 가산 합성으로만 낸다. shadowBlur 금지(치명적으로 느리다).
    ctx.globalCompositeOperation = "lighter";

    let start = 0;
    for (let b = 0; b < BINS; b++) {
      const c = binCount[b];
      if (c === 0) continue;
      const end = start + c;

      const bucketIdx = (b / ALPHA_STEPS) | 0;
      const alphaIdx = b - bucketIdx * ALPHA_STEPS;

      // 잉크 버킷(글자)에는 후광을 씌우지 않는다 — 글자는 또렷해야 읽힌다.
      if (
        bucketIdx >= HALO_MIN_BUCKET &&
        bucketIdx < INK_B0 &&
        alphaIdx >= HALO_MIN_ALPHA
      ) {
        ctx.fillStyle = pal.halo[b];
        for (let j = start; j < end; j++) {
          const q = sps[j] + 2;
          ctx.fillRect(ssx[j] - 1, ssy[j] - 1, q, q);
        }
      }

      ctx.fillStyle = pal.core[b];
      for (let j = start; j < end; j++) {
        const q = sps[j];
        ctx.fillRect(ssx[j], ssy[j], q, q);
      }

      start = end;
    }

    ctx.globalCompositeOperation = "source-over";

    st.dirty = false;
    st.drawnZ = st.camZ;
    st.drawnBoost = kBoost;
    st.drawnRise = riseK;
    st.drawnFleet = fleetG;
    st.drawnSteer = steer;
    st.drawnPitch = pitch;
    st.drawnH = hp;

    // 계측 훅 — 검증 스크립트가 카메라 상태를 읽는다. DOM 변경이 아니라 속성이라
    // 스타일 무효화가 없다.
    const probe = canvasRef.current as
      (HTMLCanvasElement & { roadProbe?: RoadProbe }) | null;
    if (probe) {
      const rp =
        probe.roadProbe ??
        (probe.roadProbe = {
          p: 0,
          z: 0,
          camY: 0,
          horizon: 0,
          f: 0,
          aim: [0, 0, 0, 0],
          quietBoxes: [],
          rise: 0,
          fleet: 0,
          cars: 0,
          peds: 0,
          overlap: 0,
          overlapDepth: 0,
          acts: [0, 0, 0, 0],
          gaps: [],
          gapsHuman: [],
          accel: [],
          speed: [],
          waveSpread: 0,
          waveBand: [0, 0],
          wave: [0, 0],
          pickup: [0, 0, 0, 0, 0],
          merge: -1,
          mergeK: 0,
          morph: {
            n: 0,
            e: 0,
            raw: 0,
            move: 0,
            clipTop: 0,
            ghost: 0,
            swapped: 0,
            span: 0,
            t: [0, 0, 0, 0],
            stay: 0,
            air: 0,
            land: 0,
            stepAvg: 0,
            stepMax: 0,
            stepBig: 0,
            hp: 0,
            seated: 0,
            lost: 0,
            group: [0, 0],
            lane: [],
            next: [],
          },
          pts: 0,
          total: 0,
        });
      rp.p = p;
      rp.z = st.camZ;
      rp.camY = camY;
      rp.horizon = cy;
      rp.f = f;
      rp.aim[0] = steer;
      rp.aim[1] = pitch;
      rp.aim[2] = roll;
      rp.aim[3] = cx;
      rp.quietBoxes = st.quietBoxes;
      rp.rise = riseK;
      rp.fleet = fleetG;
      rp.cars = carsDrawn;
      let ov = 0;
      let worst = 0;
      for (let i = 0; i < nBox; i++) {
        for (let j = i + 1; j < nBox; j++) {
          // 차체 상자가 두 축 모두에서 겹치면 화면에서도 겹쳐 보인다.
          const dz =
            Math.abs(boxZ[i]! - boxZ[j]!) - (boxL[i]! + boxL[j]!) * 0.5;
          if (dz >= 0) continue;
          const dx =
            Math.abs(boxX[i]! - boxX[j]!) - (boxW[i]! + boxW[j]!) * 0.5;
          if (dx >= 0) continue;
          ov++;
          const depth = Math.min(-dz, -dx);
          if (depth > worst) worst = depth;
        }
      }
      rp.overlap = ov;
      rp.overlapDepth = worst;
      rp.peds = pedsDrawn;
      for (let i = 0; i < ACTS; i++) rp.acts[i] = actK[i]!;
      rp.gaps.length = 0;
      rp.accel.length = 0;
      rp.speed.length = 0;
      for (let k = 0; k < vehicles.length; k++) {
        if (k < vehicles.length - 1) {
          rp.gaps.push(
            vehicles[k + 1]!.x - vehicles[k + 1]!.length - vehicles[k]!.x,
          );
        }
        rp.accel.push(vehicles[k]!.a);
        rp.speed.push(vehicles[k]!.v * 3.6);
      }
      rp.gapsHuman.length = 0;
      {
        const cv = fleet.cols[0]!.veh;
        for (let k = 0; k < cv.length; k++) {
          const lead = cv[(k + 1) % cv.length]!;
          let g = lead.x - lead.length - cv[k]!.x;
          if (g < 0) g += SCENE_LEN;
          rp.gapsHuman.push(g);
        }
      }
      rp.waveSpread = speedSpread(fleet.cols[0]!.veh);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of fleet.cols[0]!.veh) {
        if (v.v < lo) lo = v.v;
        if (v.v > hi) hi = v.v;
      }
      rp.waveBand[0] = lo * 3.6;
      rp.waveBand[1] = hi * 3.6;
      // 선두가 1, 자차가 마지막. 아직 아무도 문턱을 못 넘었으면 0.
      rp.wave[0] = Number.isFinite(st.waveFront)
        ? vehicles.length - st.waveFront
        : 0;
      rp.wave[1] = st.waveReach;
      rp.pickup[0] = fleet.taxi.on;
      rp.pickup[1] = fleet.taxi.dz;
      rp.pickup[2] = fleet.taxi.x;
      rp.pickup[3] = fleet.taxi.paxDz;
      rp.pickup[4] = fleet.taxi.paxGone;
      rp.merge = fleet.mergeIdx;
      rp.mergeK = fleet.mergeK;
      {
        const gl = glyphRef.current;
        const mo = rp.morph;
        mo.lane.length = 0;
        mo.next.length = 0;
        let seated = 0;
        for (let k = 1; k <= FLEET_N; k++) {
          seated += slots.laneN[k]!;
          mo.lane.push(slots.laneN[k]!);
        }
        for (let k = 0; k < NEXT_N; k++) {
          seated += slots.nextN[k]!;
          mo.next.push(slots.nextN[k]!);
        }
        const drawn = Math.max(1, stillN + airN + landN);
        mo.n = gl ? gl.n : 0;
        // 실제로 그린 글자 점의 세 상태 — 조립이 흐르고 있다는 증거.
        mo.stay = stillN / drawn;
        mo.air = airN / drawn;
        mo.land = landN / drawn;
        mo.e = gl && gl.n ? landN / drawn : 0;
        mo.raw =
          gl && !still
            ? clamp01((hp - gl.t0) / Math.max(1e-4, gl.done - gl.t0))
            : 0;
        mo.move = moveN ? moveSum / moveN : 0;
        mo.stepAvg = stepN ? stepSum / stepN : 0;
        mo.stepMax = stepMax;
        mo.stepBig = stepBig;
        mo.hp = hp;
        mo.clipTop = clipTop;
        mo.ghost = moveN ? ghostN / moveN : 0;
        mo.swapped = moveN ? swapN / moveN : 0;
        mo.span = st.hpSpan;
        if (gl) {
          mo.t[0] = gl.t0 * st.hpSpan;
          mo.t[1] = gl.loose0 * st.hpSpan;
          mo.t[2] = gl.asm0 * st.hpSpan;
          mo.t[3] = gl.done * st.hpSpan;
        }
        mo.seated = seated;
        mo.lost = gl ? gl.n - seated : 0;
        mo.group[0] = gl ? gl.laneN : 0;
        mo.group[1] = gl ? gl.nextN : 0;
      }
      rp.pts = vc;
      rp.total = n + rel.n;
    }
  };

  drawRef.current = draw;

  /* 커서 추적 — 목표만 적는다. 실제 조향은 draw 가 시간상수로 따라간다.
     터치(coarse)와 동작 줄이기에서는 아예 붙지 않는다: 붙여 봐야 커서가 없고,
     붙어 있으면 마지막 탭 자리에 시선이 얼어붙는다. */
  useEffect(() => {
    if (reducedMotion) return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const aim = aimRef.current;
    const onMove = (e: PointerEvent) => {
      aim.tx = e.clientX / Math.max(1, window.innerWidth);
      aim.ty = e.clientY / Math.max(1, window.innerHeight);
      aim.tk = 1;
    };
    const onLeave = () => {
      aim.tk = 0;
      aim.tx = 0.5;
      aim.ty = 0.5;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      onLeave();
    };
  }, [reducedMotion]);

  /* 글꼴이 도착하면 글자 상자가 통째로 달라진다. 첫 프레임에 구운 것은 대체
     글꼴(system-ui)의 모양이라, 모노 글자가 있는 줄은 자리도 폭도 다르다.
     `fonts.ready` 는 한 번만 기다린다 — 그 뒤의 재조판은 `onResize` 가 잡는다. */
  useEffect(() => {
    if (reducedMotion || typeof document === "undefined" || !document.fonts)
      return;
    let alive = true;
    void document.fonts.ready.then(() => {
      if (!alive) return;
      stateRef.current.glyphStale = true;
      stateRef.current.glyphFonts = true;
    });
    return () => {
      alive = false;
    };
  }, [reducedMotion]);

  /* 동작 줄이기에서만 붙는다. 애니메이션이 도는 쪽은 rAF 가 매 프레임 `window.scrollY`
     를 직접 읽으므로 스크롤 리스너가 필요 없다 — 두 경로가 겹치면 헛돈다. */
  useEffect(() => {
    if (!reducedMotion || typeof window === "undefined") return;
    const onScroll = () => redrawStill();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // 마운트 직후 이미 스크롤된 위치일 수 있다(새로고침·앵커 착지).
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (stillRafRef.current) {
        cancelAnimationFrame(stillRafRef.current);
        stillRafRef.current = 0;
      }
    };
    // `redrawStill` 은 ref 만 읽으므로 렌더마다 새로 만들어져도 동작이 같다 —
    // 의존성에 넣지 않는 이유가 이것이다(넣으면 렌더마다 리스너를 다시 단다).
  }, [reducedMotion]);

  useRafLoop((dt, elapsed) => drawRef.current(dt, elapsed), {
    target,
    reducedMotion,
    fps: mobile ? 30 : 0,
    maxDelta: 1 / 20,
  });
}

/* ------------------------------------------------------------------ *
 * 카울(대시보드) 기하 — 자차 로컬 좌표
 * ------------------------------------------------------------------ */

/** 차단선을 담는 열 수. 64열이면 1280px 에서 20px 간격 — 곡률이 충분히 읽힌다. */
const COWL_COLS = 64;
const COWL_SAMPLES = 96;
/** 카울이 가로로 뻗는 범위(m). 넓은 화각에서도 좌우 끝까지 닿아야 한다. */
const COWL_HALF = 3.4;
/**
 * 앞유리 밑단까지의 거리(m)와 **카메라보다 낮은 정도**(m).
 * 절대 높이가 아니라 카메라 기준이다 — 카울은 자차에 붙어 있으므로 종단 선형이나
 * 서스펜션 상하동에 흔들려서는 안 된다(실제 블랙박스 영상에서 보닛은 고정돼 있다).
 */
const COWL_Z = 0.88;
const COWL_DROP = 0.4;
/** 경계 아래로 알파가 0 이 되기까지의 거리 — 화면 높이 비율. */
const COWL_SOFT = 0.24;
/** 가장자리로 갈수록 멀어지는 정도 — 카울이 좌우에서 살짝 올라간다. */
const COWL_BOW = 0.028;
