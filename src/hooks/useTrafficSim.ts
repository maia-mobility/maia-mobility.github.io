import { useEffect, useRef, type RefObject } from 'react';
import { useCanvas2D, type Canvas2DView } from './useCanvas2D';
import { useRafLoop } from './useRafLoop';
import {
  idmAccel,
  makeRng,
  makeVehicle,
  seedPlatoon,
  seedRing,
  speedSpread,
  step,
  type Vehicle,
} from '../lib/idm';
import { DISPATCH, PLATOON, RING, V2V } from '../lib/scenarios';
import type { SimScenario } from '../data/research';

/* ============================================================================
   useTrafficSim — 조감도(bird's-eye) 교통 시뮬레이션 렌더러.

   물리는 `src/lib/idm.ts` 가, 설정은 `src/lib/scenarios.ts` 가 전부 소유한다.
   이 훅은 **읽어서 그리기만 한다.** 파라미터를 새로 지어내지 않는다.
   여기서 만드는 숫자는 렌더링 좌표(px)와 계측 표기(HUD)뿐이다.

   규칙:
   - React state 를 일절 건드리지 않는다. 계측값은 `onMetrics` 로 흘려보내고,
     컴포넌트가 ref 로 잡은 DOM 노드에 textContent 로 찍는다.
   - 점·차량은 전부 `fillRect`. `arc()` 없음, `shadowBlur` 없음.
   - 색은 전부 global.css 토큰을 getComputedStyle 로 읽는다.
   ========================================================================= */

export type PlatoonMode = 'human' | 'acc' | 'controlled';

/** HUD 로 흘려보내는 계측값. 해당 없는 항목은 NaN. */
export interface TrafficMetrics {
  scenario: SimScenario;
  /** 시나리오 시간(s) */
  t: number;
  /**
   * **이 시나리오의 결론값이 확정됐는가.**
   *
   * 과도구간의 숫자는 결론이 아니다 — 플래툰은 교란이 후미까지 지나가야,
   * 링은 측정 창이 다 차야 값이 정해진다. 그 전에는 이 플래그가 false 이고
   * HUD 는 숫자를 확정값처럼 찍지 않는다. 판정 기준은 각 시나리오의 물리다
   * (`stepPlatoon` · `settleRing` 주석 참조).
   */
  settled: boolean;
  /** 확정된 시각(s). 측정 중이면 NaN. */
  settledAtS: number;
  /** 속도 표준편차(m/s) — 표기용으로 EMA 를 먹인 값 */
  spread: number;
  meanKmh: number;
  minKmh: number;
  maxKmh: number;
  /* 01 platoon */
  leadDropKmh: number;
  rearDropKmh: number;
  amp: number;
  braking: boolean;
  /** 직전 사이클에서 확정된 증폭률. 첫 사이클이면 NaN. */
  lastAmp: number;
  /** 제동파가 닿은 차량 수(선두부터). 전파 진행 표시용. */
  waveVeh: number;
  /* 02 shockwave */
  avCount: number;
  reductionPct: number;
  /** 링 측정 창 길이(s) — 이만큼 관측해야 감쇠율을 확정한다. */
  windowS: number;
  /* 03 dispatch */
  pending: number;
  assigned: number;
  served: number;
  meanWaitS: number;
  /* 04 v2v */
  links: number;
  merges: number;
}

export interface TrafficSimOptions {
  scenario: SimScenario;
  /** 01 전용 — 차량추종 모델 프리셋 선택. */
  mode?: PlatoonMode;
  /** 02 전용 — 링에 투입할 제어 AV 대수. */
  avCount?: number;
  /** 화면 밖이면 rAF 를 멈출 대상. */
  target?: RefObject<Element | null>;
  reducedMotion?: boolean;
  /** 계측값 콜백. 초당 5회. setState 로 받지 말 것 — DOM 에 직접 쓴다. */
  onMetrics?: (m: TrafficMetrics) => void;
}

/* ------------------------------------------------------------------ *
 * 색 — global.css 토큰에서만 읽는다 (하드 룰 8).
 * `--accent`/`--warn` 은 var() 별칭이므로 원본 intensity 토큰을 직접 읽는다.
 * ------------------------------------------------------------------ */

type RGB = [number, number, number];

/** 토큰을 못 읽는 환경(SSR·테스트)용 중립 회색. 팔레트를 복제하지 않는다. */
const NEUTRAL: RGB = [140, 152, 164];

function parseHexToken(raw: string): RGB | null {
  const v = raw.trim();
  if (v.length < 4 || v.charCodeAt(0) !== 35 /* '#' */) return null;
  const body = v.slice(1);
  const short = body.length === 3 || body.length === 4;
  const stepSize = short ? 1 : 2;
  if (!short && body.length !== 6 && body.length !== 8) return null;
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const part = body.slice(i * stepSize, i * stepSize + stepSize);
    const n = Number.parseInt(short ? part + part : part, 16);
    if (Number.isNaN(n)) return null;
    out[i] = n;
  }
  return out;
}

function readToken(name: string): RGB {
  if (typeof window === 'undefined') return NEUTRAL;
  return parseHexToken(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? NEUTRAL;
}

const rgba = (c: RGB, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

interface Palette {
  bg: string;
  /** 도로 경계 점 */
  line: string;
  /** 차선 파선 · 눈금 */
  hot: string;
  /** human = 앰버 */
  human: string;
  humanDim: string;
  /** av = 시안 */
  av: string;
  avDim: string;
  /** 제동등 = intensity 램프 최상단(적색) */
  brake: string;
  mute: string;
  /** 링크·마커 점멸 2단계 */
  linkOn: string;
  linkOff: string;
  node: string;
  nodeDone: string;
}

function buildPalette(): Palette {
  const bg = readToken('--bg');
  const line = readToken('--line');
  const hot = readToken('--line-hot');
  const human = readToken('--i-4'); // --warn
  const av = readToken('--i-2'); // --accent
  const brake = readToken('--i-6');
  const mute = readToken('--fg-mute');
  return {
    bg: rgba(bg, 1),
    line: rgba(line, 1),
    hot: rgba(hot, 1),
    human: rgba(human, 0.92),
    humanDim: rgba(human, 0.3),
    av: rgba(av, 0.95),
    avDim: rgba(av, 0.32),
    brake: rgba(brake, 0.95),
    mute: rgba(mute, 0.55),
    linkOn: rgba(av, 0.75),
    linkOff: rgba(av, 0.18),
    node: rgba(human, 0.8),
    nodeDone: rgba(mute, 0.4),
  };
}

/* ------------------------------------------------------------------ *
 * 씬
 * ------------------------------------------------------------------ */

/** 물리 스텝. 반응 지연(0.8s·0.75s)이 정수 스텝으로 떨어지도록 1/60 고정. */
const PHYS_DT = 1 / 60;
/** 한 프레임에 밀어넣을 수 있는 최대 물리 스텝 — 탭 복귀 시 폭주 방지. */
const MAX_SUB = 12;
const CAR_LEN = 4.6;
/** 링 시계열 트레이스 — 0.25s 간격 샘플 160개 = 40초 이력. */
const HIST_N = 160;
const HIST_STEP = 0.25;
/** 트레이스 풀스케일(m/s). 검증된 0-AV 변동(3.09)이 화면 상단 근처에 오도록. */
const HIST_FS = 4;

/* --- 확정 판정 상수 -------------------------------------------------- *
 * 물리를 바꾸는 값이 아니라 **언제 숫자를 확정값으로 읽어도 되는가**를 정하는 값이다.
 * ------------------------------------------------------------------ */

/**
 * 플래툰: 제동파가 지나갔다고 볼 감속 문턱(m/s²).
 * 사람 프리셋의 가속도 잡음(±0.35)과 자유주행 중의 미세 조정(실측 ≤0.44)보다 크고,
 * 실제 제동파(실측 −2.5 … −8.0)보다는 한참 작다.
 */
const WAVE_DECEL = -0.6;
/**
 * 이 시간(s) 동안 플래툰의 어느 차량도 문턱을 넘겨 감속하지 않으면 과도응답이 끝난 것이다.
 * 파가 차량에서 차량으로 넘어갈 때 생기는 최대 공백이 실측 0.82 s 이므로 그보다 넉넉히 잡는다.
 */
const WAVE_QUIET = 1.2;
/**
 * 링: 감쇠율을 확정하기 전에 관측해야 하는 최소 시간(s) = 링 2바퀴.
 * FollowerStopper 는 파동이 자기를 통과할 때만 그것을 흡수한다. 한 바퀴면 모든 차량이
 * 모든 AV 의 후류를 한 번 지나고, 두 바퀴면 진폭이 바닥까지 내려간다(실측 ≈104 s).
 */
const RING_WINDOW = (2 * RING.length) / RING.v0;
/** 링 정착 판정에 쓰는 평균 창 — 샘플 24개 = 6 s. 이 창 2개를 맞대 추세를 본다. */
const RING_W = 24;

/** 배차 요청 — 출발 노드에서 태워 도착 노드에 내린다. */
interface Job {
  origin: number;
  dest: number;
  /** 배정된 차량 id (-1 = 미배정) */
  veh: number;
  born: number;
  /** 0 대기 · 1 픽업 이동 · 2 운행 중 */
  phase: 0 | 1 | 2;
}

interface Scene {
  scenario: SimScenario;
  vehicles: Vehicle[];
  rng: () => number;
  t: number;
  accum: number;
  circumference?: number;
  /** 표기용 EMA(빠름) */
  spreadEma: number;
  /** 표기용 EMA(느림) — 기준값 대비 증감률처럼 흔들리면 안 되는 수치에 쓴다. */
  spreadSlow: number;
  platoon?: {
    mode: PlatoonMode;
    v0: number;
    /** 사이클 시작 이후 차량별 최저 속도 */
    minV: number[];
    braking: boolean;
    /** 제동파가 닿은 가장 뒤쪽 차량의 인덱스. count = 아직 아무도 안 닿음. */
    waveFront: number;
    /** 마지막으로 문턱을 넘긴 감속이 있었던 시각(s) */
    lastBrakeT: number;
    /** 증폭률이 확정된 시각(s). 아직이면 NaN. */
    settledAt: number;
    /** 직전 사이클에서 확정된 증폭률. 첫 사이클이면 NaN. */
    lastAmp: number;
    /** 카메라: 좌측 기준 위치(m)와 가시 구간(m) */
    camX: number;
    span: number;
  };
  ring?: {
    avCount: number;
    U: number;
    /** 속도 변동 이력 — 화면 오른쪽의 시계열 트레이스. */
    hist: Float32Array;
    head: number;
    filled: number;
    sampleAcc: number;
    /** 감쇠율이 확정된 시각(s). 아직이면 NaN. */
    settledAt: number;
  };
  dispatch?: {
    net: Net;
    /** 차량 id 로 색인하는 도로망 위 상태 */
    nav: Nav[];
    jobs: Job[];
    next: number;
    served: number;
    waitSum: number;
  };
  v2v?: { ramp: Vehicle[]; nextSpawn: number; merges: number; links: number; nextId: number };
}


/* --- 01 platoon ---------------------------------------------------- */

function buildPlatoon(mode: PlatoonMode, lastAmp = Number.NaN): Scene {
  const p = PLATOON.modes[mode].params;
  const v0 = PLATOON.v0;
  const kind = mode === 'human' ? 'human' : 'av';
  const vehicles = seedPlatoon(
    PLATOON.count,
    // 초기 차두거리는 scenarios.ts 가 정한다 — 여기서 다시 유도하지 않는다.
    PLATOON.headway(p, v0),
    () => ({ kind, params: p }),
    v0,
  );
  return {
    scenario: 'platoon',
    vehicles,
    rng: makeRng(PLATOON.seed),
    t: 0,
    accum: 0,
    spreadEma: 0,
    spreadSlow: 0,
    platoon: {
      mode,
      v0,
      minV: vehicles.map((v) => v.v),
      braking: false,
      waveFront: vehicles.length,
      lastBrakeT: 0,
      settledAt: Number.NaN,
      lastAmp,
      camX: Number.NaN,
      span: Number.NaN,
    },
  };
}

/** 증폭률 = 후미 낙폭 / 선두 낙폭. 선두가 아직 안 밟았으면 정의되지 않는다. */
function ampOf(sc: Scene): number {
  const st = sc.platoon!;
  const last = sc.vehicles.length - 1;
  const leadDrop = st.v0 - st.minV[last]!;
  return leadDrop > 0.15 ? (st.v0 - st.minV[0]!) / leadDrop : Number.NaN;
}

function stepPlatoon(sc: Scene, dt: number): Scene {
  const st = sc.platoon!;
  const last = sc.vehicles.length - 1;
  const { at, duration, accel } = PLATOON.perturb;
  const braking = sc.t >= at && sc.t < at + duration;
  st.braking = braking;

  step(sc.vehicles, dt, {
    rng: sc.rng,
    override: (_v, i) => (braking && i === last ? accel : undefined),
  });
  sc.t += dt;

  let quiet = true;
  for (let i = 0; i <= last; i++) {
    const veh = sc.vehicles[i]!;
    if (veh.v < st.minV[i]!) st.minV[i] = veh.v;
    // 제동파의 앞머리는 "문턱을 넘겨 감속 중인 가장 뒤쪽 차량"이다.
    if (veh.a <= WAVE_DECEL) {
      quiet = false;
      if (i < st.waveFront) st.waveFront = i;
    }
  }
  if (!quiet) st.lastBrakeT = sc.t;

  /*
   * **확정 조건** — 증폭률은 사이클 전체의 최저 속도로 정의되는 값이라,
   * 과도응답이 남아 있는 동안에는 아직 더 내려갈 수 있다. 그래서
   *   ① 선두의 감속이 끝났고(선두 낙폭이 더는 깊어지지 않는다)
   *   ② 플래툰 안 어느 차량도 WAVE_QUIET 동안 제동하지 않았을 때
   * 비로소 확정으로 본다. ②가 곧 "제동파가 플래툰을 빠져나갔다"는 뜻이다.
   * 사람 25.6 s · 상용ACC 25.7 s · 제어AV 9.5 s 에서 걸리고, 그때의 값이 정착값과 같다.
   */
  if (
    Number.isNaN(st.settledAt) &&
    sc.t >= at + duration &&
    sc.t - st.lastBrakeT >= WAVE_QUIET &&
    Number.isFinite(ampOf(sc))
  ) {
    st.settledAt = sc.t;
  }

  // 한 사이클이 끝나면 같은 초기조건으로 리셋 — 교란이 반복해서 뒤로 전파된다.
  // 확정된 증폭률은 다음 사이클로 넘겨 "직전 사이클" 표기에 쓴다.
  if (sc.t >= PLATOON.cycle) {
    return buildPlatoon(st.mode, Number.isNaN(st.settledAt) ? st.lastAmp : ampOf(sc));
  }
  return sc;
}

/* --- 02 shockwave (ring) ------------------------------------------- */

/** 링에 AV 를 균등 배치한다. U(목표속도)는 Stern et al. 방식대로 구간 평균. */
function applyAV(sc: Scene, k: number): void {
  const vs = sc.vehicles;
  const n = vs.length;
  const U = vs.reduce((s, v) => s + v.v, 0) / n;
  const pick = new Set<number>();
  for (let j = 0; j < k; j++) pick.add(Math.round((j * n) / k) % n);

  for (const v of vs) {
    const isAV = pick.has(v.id);
    v.kind = isAV ? 'av' : 'human';
    v.params = isAV ? RING.avBase : RING.human;
    v.fs = isAV ? { ...RING.fs, U } : undefined;
    v.vCmd = undefined;
    v._delay.length = 0;
  }
  sc.ring!.avCount = k;
  sc.ring!.U = U;
}

function buildRing(avCount: number): Scene {
  const rng = makeRng(RING.seed);
  const vehicles = seedRing(
    RING.count,
    RING.length,
    () => ({ kind: 'human', params: RING.human }),
    RING.v0,
    rng,
  );
  const sc: Scene = {
    scenario: 'shockwave',
    vehicles,
    rng,
    t: 0,
    accum: 0,
    spreadEma: 0,
    spreadSlow: 0,
    circumference: RING.length,
    ring: {
      avCount: 0,
      U: RING.v0,
      hist: new Float32Array(HIST_N),
      head: 0,
      filled: 0,
      sampleAcc: 0,
      settledAt: Number.NaN,
    },
  };

  // 파동이 자리잡을 때까지(warmup) 미리 돌려 둔다 — 방문자가 60초를 기다리지
  // 않고 바로 stop-and-go 를 본다. AV 투입은 그 다음이다(scenarios.ts 규정).
  for (let t = 0; t < RING.warmup; t += PHYS_DT) {
    step(vehicles, PHYS_DT, { circumference: RING.length, rng });
  }
  sc.spreadEma = speedSpread(vehicles);
  // 느린 EMA 는 검증된 0-AV 기준값(scenarios.ts)에서 출발시킨다 — 계측기의 영점이다.
  // 이후 값은 전부 실측이고, AV 를 넣으면 그대로 −95% 쪽으로 내려간다.
  sc.spreadSlow = RING.spreadByAV[0] ?? sc.spreadEma;
  if (avCount > 0) applyAV(sc, avCount);
  return sc;
}

/* --- 03 dispatch ---------------------------------------------------
 *
 * 도심 도로망 위의 수요응답형 운행.
 *
 * 앞 판은 직사각 회로 하나였다. 차가 한 줄로 돌기만 해서 "배차"가 아니라
 * **순환버스**로 읽혔고, 캔버스에서는 긴 가로줄 두 개로 보였다. 더 큰 문제는
 * 배차의 본질 — **길이 갈라지는 곳에서 어디로 갈지 고르는 것** — 이 회로에는
 * 아예 존재하지 않았다는 점이다. 노선이 하나면 고를 것이 없다.
 *
 * 지금은 교차로 12곳짜리 도로망이다. 수요가 교차로에 뜨면 **도로를 따라 가장
 * 가까운** 유휴 차량이 최단경로(다익스트라)로 향하고, 태운 뒤 목적지로 간다.
 * 차량은 간선 위에서 IDM 으로 앞차를 따르고, 교차로는 한 번에 한 대만 지난다.
 */

/** 교차로 점유 반경(m). 이 안에 차가 있으면 뒤따라오는 차는 정지선에 선다. */
const NODE_HOLD = 8;
/** 교차로 통과를 판단하기 시작하는 거리(m). */
const NODE_GUARD = 22;
/** 회전 통과 속도(m/s). 직각으로 꺾는데 43km/h 로 지나가면 궤적이 아니라 순간이동이다. */
const TURN_V = 7;
/** 이 각(rad)보다 크게 꺾이면 회전으로 본다. 격자 흔들림(≈0.3)과 직각(≈1.57) 사이. */
const TURN_BEND = 0.9;

interface NetNode {
  x: number;
  y: number;
}

interface Net {
  nodes: NetNode[];
  /** 노드별 인접 노드 */
  adj: number[][];
  /** 간선 목록(a < b) — 그리기용 */
  edges: [number, number][];
  /** 노드 간 최단거리(m) — n×n 평탄 배열 */
  dist: Float64Array;
  /** 최단경로의 첫 홉 — n×n 평탄 배열. -1 = 도달 불가 */
  hop: Int8Array;
  /** 도면 크기(m) */
  w: number;
  h: number;
}

/** 차량 한 대의 도로망 위 상태. 차량 id 로 색인한다. */
interface Nav {
  /** 현재 간선 a → b */
  a: number;
  b: number;
  /** a 로부터 진행한 거리(m) */
  s: number;
  /** b 다음에 지날 노드들 */
  route: number[];
  /** 배정된 수요 색인(-1 = 유휴) */
  job: number;
  /** 정차 종료 시각(s) */
  dwell: number;
}

function buildNet(rng: () => number): Net {
  const { cols, rows, spanX, spanY, jitter, cut } = DISPATCH;
  const n = cols * rows;
  const nodes: NetNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        x: (c - (cols - 1) / 2) * spanX + (rng() - 0.5) * 2 * jitter,
        y: (r - (rows - 1) / 2) * spanY + (rng() - 0.5) * 2 * jitter,
      });
    }
  }

  const dropped = new Set(cut.map(([a, b]) => `${a}-${b}`));
  const edges: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols && !dropped.has(`${i}-${i + 1}`)) edges.push([i, i + 1]);
      if (r + 1 < rows && !dropped.has(`${i}-${i + cols}`)) edges.push([i, i + cols]);
    }
  }

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }

  const len = (a: number, b: number) => Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);

  /* 전 쌍 최단경로. 노드가 12개뿐이라 출발지마다 O(n²) 다익스트라로 충분하고,
     빌드 때 한 번만 돌므로 프레임에는 아무 비용도 없다. */
  const dist = new Float64Array(n * n).fill(Infinity);
  const hop = new Int8Array(n * n).fill(-1);
  for (let s = 0; s < n; s++) {
    const d = new Float64Array(n).fill(Infinity);
    const prev = new Int8Array(n).fill(-1);
    const done = new Uint8Array(n);
    d[s] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!done[i] && d[i]! < best) {
          best = d[i]!;
          u = i;
        }
      }
      if (u < 0) break;
      done[u] = 1;
      for (const v of adj[u]!) {
        const nd = d[u]! + len(u, v);
        if (nd < d[v]!) {
          d[v] = nd;
          prev[v] = u;
        }
      }
    }
    for (let t = 0; t < n; t++) {
      dist[s * n + t] = d[t]!;
      if (t === s) {
        hop[s * n + t] = s;
        continue;
      }
      // t 에서 prev 를 거슬러 s 바로 다음 노드를 찾는다.
      let cur = t;
      let first = -1;
      let guard = 0;
      while (cur !== s && cur >= 0 && guard++ < n + 1) {
        first = cur;
        cur = prev[cur]!;
      }
      hop[s * n + t] = cur === s ? first : -1;
    }
  }

  let w = 0;
  let h = 0;
  for (const p of nodes) {
    w = Math.max(w, Math.abs(p.x) * 2);
    h = Math.max(h, Math.abs(p.y) * 2);
  }
  return { nodes, adj, edges, dist, hop, w, h };
}

const edgeLen = (net: Net, a: number, b: number): number =>
  Math.hypot(net.nodes[a]!.x - net.nodes[b]!.x, net.nodes[a]!.y - net.nodes[b]!.y);

/** from 에서 to 까지의 노드 열(from 은 빼고). 도달 불가면 빈 배열. */
function routeTo(net: Net, from: number, to: number): number[] {
  const n = net.nodes.length;
  const out: number[] = [];
  let cur = from;
  let guard = 0;
  while (cur !== to && guard++ < n + 1) {
    const nx = net.hop[cur * n + to]!;
    if (nx < 0) return [];
    out.push(nx);
    cur = nx;
  }
  return out;
}

/** 차량의 현재 좌표와 진행 방향. 그리기와 배차 링크가 같이 쓴다. */
function navPoint(net: Net, nv: Nav): { x: number; y: number; ang: number } {
  const A = net.nodes[nv.a]!;
  const B = net.nodes[nv.b]!;
  const L = Math.max(1e-3, Math.hypot(B.x - A.x, B.y - A.y));
  const k = Math.min(1, Math.max(0, nv.s / L));
  return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, ang: Math.atan2(B.y - A.y, B.x - A.x) };
}

function buildDispatch(): Scene {
  const rng = makeRng(DISPATCH.seed);
  const net = buildNet(rng);
  const vehicles: Vehicle[] = [];
  const nav: Nav[] = [];
  for (let i = 0; i < DISPATCH.count; i++) {
    // 서로 다른 간선에 흩어 놓는다 — 한 간선에 몰리면 첫 화면이 정체로 시작한다.
    const [a, b] = net.edges[(i * 5 + 1) % net.edges.length]!;
    const flip = i % 2 === 0;
    vehicles.push(makeVehicle(i, 0, DISPATCH.v0, 'av', DISPATCH.params));
    nav.push({
      a: flip ? a : b,
      b: flip ? b : a,
      s: edgeLen(net, a, b) * (0.2 + rng() * 0.6),
      route: [],
      job: -1,
      dwell: 0,
    });
  }
  const sc: Scene = {
    scenario: 'dispatch',
    vehicles,
    rng,
    t: 0,
    accum: 0,
    spreadEma: 0,
    spreadSlow: 0,
    dispatch: { net, nav, jobs: [], next: 1, served: 0, waitSum: 0 },
  };

  /* **정상운행 상태에서 시작한다.**
     빈 도로에 차 여섯 대를 흩어 놓고 시작하면, 첫 운행이 끝나기까지 20초가 걸린다
     (실측). 그 사이 방문자가 보는 것은 `TRIPS SERVED 0` 뿐이라 "배차가 안 되는
     시스템"으로 읽힌다. 45초를 미리 돌려 놓으면 화면에 들어선 순간이 곧 운행 중인
     한복판이다. 수치는 그대로 실측이다 — 과도구간을 건너뛴 것이지 지어낸 게 아니다. */
  for (let i = 0; i < 45 * 60; i++) stepDispatch(sc, 1 / 60);
  return sc;
}

/** 유휴 차량이 다음에 들어설 간선. 왔던 길로 바로 되돌아가지 않는다. */
function wander(net: Net, nv: Nav, rng: () => number): number {
  const opts = net.adj[nv.b]!.filter((x) => x !== nv.a);
  const pool = opts.length ? opts : net.adj[nv.b]!;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

function stepDispatch(sc: Scene, dt: number): void {
  const st = sc.dispatch!;
  const net = st.net;
  const n = net.nodes.length;
  const vs = sc.vehicles;
  const nav = st.nav;

  /* --- 새 수요 ------------------------------------------------------
     이미 수요가 걸린 교차로는 피한다 — 같은 자리에 마커가 겹치면 둘 다 안 읽힌다. */
  if (sc.t >= st.next && st.jobs.length < DISPATCH.maxJobs) {
    const taken = new Set<number>();
    for (const j of st.jobs) {
      taken.add(j.origin);
      taken.add(j.dest);
    }
    const free = Array.from({ length: n }, (_, i) => i).filter((i) => !taken.has(i));
    if (free.length >= 2) {
      const origin = free.splice(Math.floor(sc.rng() * free.length), 1)[0]!;
      // 한 블록짜리 운행은 화면에서 배차로 안 보인다 — 충분히 먼 목적지를 고른다.
      const fit = free.filter((i) => {
        const d = net.dist[origin * n + i]!;
        return d >= DISPATCH.minTrip && d <= DISPATCH.maxTrip;
      });
      const pool = fit.length ? fit : free;
      const dest = pool[Math.min(pool.length - 1, Math.floor(sc.rng() * pool.length))]!;
      st.jobs.push({ origin, dest, veh: -1, born: sc.t, phase: 0 });
    }
    st.next = sc.t + DISPATCH.demandInterval * (0.7 + sc.rng() * 0.7);
  }

  /* --- 배차 --------------------------------------------------------
     **도로를 따라** 가장 가까운 유휴 차량. 직선거리로 고르면 강 건너 차가 뽑힌다. */
  for (let ji = 0; ji < st.jobs.length; ji++) {
    const job = st.jobs[ji]!;
    if (job.phase !== 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (const v of vs) {
      const nv = nav[v.id]!;
      if (nv.job >= 0) continue;
      // 이미 b 를 향해 달리고 있으므로 b 부터 잰다 — 중간에 되돌 수는 없다.
      const d = net.dist[nv.b * n + job.origin]!;
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    if (best < 0) continue;
    const nv = nav[best]!;
    nv.job = ji;
    nv.route = routeTo(net, nv.b, job.origin);
    job.veh = best;
    job.phase = 1;
  }

  /* --- 교차로 점유 --------------------------------------------------
     교차로 안(NODE_HOLD)에 있는 차량을 미리 세어 둔다. 프레임당 한 번이다. */
  const holder = new Int8Array(n).fill(-1);
  for (const v of vs) {
    const nv = nav[v.id]!;
    const L = edgeLen(net, nv.a, nv.b);
    if (L - nv.s < NODE_HOLD) holder[nv.b] = v.id;
    else if (nv.s < NODE_HOLD) holder[nv.a] = v.id;
  }

  /* --- 주행 --------------------------------------------------------- */
  for (const v of vs) {
    const nv = nav[v.id]!;
    let L = edgeLen(net, nv.a, nv.b);

    /* 유휴 차량도 **다음 간선을 미리 정해 둔다.** 비워 두면 아래의 `arriving` 이
       켜져 모든 교차로가 정차 지점이 된다 — 처음에 전 차량이 그렇게 멈춰 섰다. */
    if (nv.route.length === 0 && nv.job < 0 && sc.t >= nv.dwell) {
      nv.route.push(wander(net, nv, sc.rng));
    }

    /* 앞차 — 같은 간선의 같은 방향에서 바로 앞. 없으면 다음 간선의 맨 뒤차까지
       본다. 교차로 너머를 안 보면 정지선 앞에서 뒤차가 그대로 들이받는다. */
    let gap: number | null = null;
    let leadV = 0;
    for (const o of vs) {
      if (o.id === v.id) continue;
      const ov = nav[o.id]!;
      let d = Infinity;
      if (ov.a === nv.a && ov.b === nv.b && ov.s > nv.s) d = ov.s - nv.s;
      else if (nv.route.length && ov.a === nv.b && ov.b === nv.route[0]) d = L - nv.s + ov.s;
      if (d < (gap ?? Infinity) + v.length) {
        gap = d - v.length;
        leadV = o.v;
      }
    }

    /* 정지해야 하는 지점 — 목표 노드(승하차)이거나, 남이 점유한 교차로다.
       둘 다 "그 자리에 선 앞차"로 환산해 IDM 에 넘긴다. 별도의 제동 로직을
       두지 않아야 뒤차가 같은 규칙으로 자연스럽게 따라 선다. */
    const toNode = L - nv.s;
    // 세워야 하는 것은 **배차된 차량이 목표에 닿을 때**뿐이다.
    const arriving = nv.job >= 0 && nv.route.length === 0;
    const blocked = toNode < NODE_GUARD && holder[nv.b] >= 0 && holder[nv.b] !== v.id;
    if (arriving || blocked) {
      const d = Math.max(0, toNode - (arriving ? 0 : 2));
      if (gap === null || d < gap) {
        gap = d;
        leadV = 0;
      }
    }

    let acc = idmAccel(v.params, v.v, gap, v.v - leadV);
    // 정차 중에는 아예 못 움직이게 눌러 둔다.
    if (sc.t < nv.dwell) acc = v.v > 0.2 ? -v.params.b : -v.v / Math.max(dt, 1e-3);
    /* 회전 감속 — **필요한 제동거리를 역산해서** 걸어야 한다. 교차로 앞 고정
       거리에서 제동을 시작하게 했더니 그 거리가 제동거리보다 짧아 전 차량이
       상시 제동 상태가 됐고(실측 평균 14km/h), 도로망이 아니라 주차장이 됐다. */
    else if (nv.route.length && v.v > TURN_V) {
      const A = net.nodes[nv.a]!;
      const B = net.nodes[nv.b]!;
      const C = net.nodes[nv.route[0]!]!;
      const turn = Math.abs(
        Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(B.y - A.y, B.x - A.x),
      );
      const bend = Math.min(turn, Math.abs(2 * Math.PI - turn));
      if (bend > TURN_BEND) {
        const need = (v.v * v.v - TURN_V * TURN_V) / (2 * v.params.b);
        if (toNode < need + 4) acc = Math.min(acc, -v.params.b);
      }
    }

    v.a = acc;
    v.v = Math.max(0, v.v + acc * dt);
    nv.s += v.v * dt;

    /* --- 도착 판정 ----------------------------------------------------
       **IDM 은 정지간격(s0 = 2m) 앞에서 선다.** 그래서 "노드를 지나면 도착"으로
       잡으면 그 순간이 영영 오지 않는다 — 전 차량이 목표 2m 앞에 멈춰 선 채로
       굳었고 TRIPS SERVED 가 0 에서 움직이지 않았다. 서 있는 것으로 판정한다. */
    if (arriving && sc.t >= nv.dwell && toNode <= v.params.s0 + 0.8 && v.v < 0.5) {
      nv.s = L;
      v.v = 0;
      arriveDispatch(sc, st, v, nv);
    }

    /* --- 간선 넘기 ---------------------------------------------------
       정차 중이거나 목표에 닿았으면 노드에 멈춰 선다. 목표 처리는 여기서
       한 번만 일어난다 — 처리가 끝나면 route 가 차거나 job 이 풀리므로. */
    let guard = 0;
    while (nv.s >= L && guard++ < 4) {
      // 목표 도착 처리는 한 번만 일어난다 — 끝나면 route 가 차거나 job 이 풀린다.
      if (nv.route.length === 0 && nv.job >= 0) arriveDispatch(sc, st, v, nv);
      // 정차는 route 가 이미 채워진 뒤에도 지켜져야 한다(승차 직후가 그렇다).
      if (sc.t < nv.dwell) {
        nv.s = L;
        v.v = 0;
        break;
      }
      if (nv.route.length === 0) nv.route.push(wander(net, nv, sc.rng));
      nv.a = nv.b;
      nv.b = nv.route.shift()!;
      nv.s -= L;
      L = edgeLen(net, nv.a, nv.b);
    }
    if (nv.s > L) nv.s = L;
  }

  sc.t += dt;
}

/** 목표 노드 도착 — 태우거나 내린다. */
function arriveDispatch(sc: Scene, st: NonNullable<Scene['dispatch']>, v: Vehicle, nv: Nav): void {
  if (nv.job < 0) return;
  const job = st.jobs[nv.job];
  if (!job) {
    nv.job = -1;
    return;
  }
  nv.dwell = sc.t + DISPATCH.dwell;
  v.v = 0;
  if (job.phase === 1) {
    st.waitSum += sc.t - job.born;
    job.phase = 2;
    nv.route = routeTo(st.net, nv.b, job.dest);
    // 목적지가 바로 여기면 그 자리에서 완료 처리한다(도달 불가도 같이 걸러진다).
    if (nv.route.length === 0) finishDispatch(st, nv);
    return;
  }
  finishDispatch(st, nv);
}

function finishDispatch(st: NonNullable<Scene['dispatch']>, nv: Nav): void {
  st.served++;
  const gone = nv.job;
  st.jobs.splice(gone, 1);
  nv.job = -1;
  // 뒤 색인이 한 칸씩 당겨진다 — 다른 차량이 들고 있는 색인도 같이 옮긴다.
  for (const other of st.nav) if (other.job > gone) other.job--;
}
/* --- 04 v2v -------------------------------------------------------- */

/** 합류로 길이(m) — mergeAt 앞쪽으로 이만큼이 램프다. */
const RAMP_LEN = 150;
/** 본선 유지 대수. 램프 차량까지 합쳐 V2V.count 를 넘지 않는다. */
const MAIN_COUNT = 7;
/** 본선 차두거리(m) — 새 차량을 왼쪽 끝에서 들여보내는 간격. */
const MAIN_HEADWAY = V2V.length / MAIN_COUNT;

/** 본선은 직선 스트림이다: 왼쪽에서 들어와 오른쪽으로 빠진다. index 0 이 맨 뒤. */
function buildV2V(): Scene {
  const vehicles = seedPlatoon(
    MAIN_COUNT,
    MAIN_HEADWAY,
    () => ({ kind: 'av', params: V2V.params }),
    V2V.v0,
  );
  return {
    scenario: 'v2v',
    vehicles,
    rng: makeRng(V2V.seed),
    t: 0,
    accum: 0,
    spreadEma: 0,
    spreadSlow: 0,
    v2v: { ramp: [], nextSpawn: 2.5, merges: 0, links: 0, nextId: MAIN_COUNT },
  };
}

function stepV2V(sc: Scene, dt: number): void {
  const st = sc.v2v!;
  const main = sc.vehicles;

  // 램프 차량 생성 — 동시에 1대, 전체 대수는 설정값을 넘지 않는다.
  if (sc.t >= st.nextSpawn && st.ramp.length < 1 && main.length + st.ramp.length < V2V.count) {
    st.ramp.push(
      makeVehicle(st.nextId++, V2V.mergeAt - RAMP_LEN, V2V.v0 * 0.78, 'av', V2V.params, 1, CAR_LEN),
    );
    st.nextSpawn = sc.t + 7 + sc.rng() * 3;
  }

  // 협조 합류 — 램프 차량의 투영 위치를 본선 후행차에게 "유령 선행차"로 준다.
  // 파라미터는 그대로 두고, 앞차만 바꿔 끼우는 것이 협조 주행의 최소 표현이다.
  const yields = new Map<number, number>();
  for (const r of st.ramp) {
    let leader: Vehicle | null = null;
    let follower: Vehicle | null = null;
    for (const m of main) {
      if (m.x >= r.x) {
        if (!leader || m.x < leader.x) leader = m;
      } else if (!follower || m.x > follower.x) follower = m;
    }
    if (leader) {
      yields.set(-r.id, idmAccel(r.params, r.v, leader.x - r.x - leader.length, r.v - leader.v));
    }
    if (follower) {
      yields.set(follower.id, idmAccel(follower.params, follower.v, r.x - follower.x - r.length, follower.v - r.v));
    }
  }

  step(main, dt, {
    rng: sc.rng,
    override: (v, i) => {
      const ghost = yields.get(v.id);
      if (ghost === undefined) return undefined;
      // 본선 후행차는 "양보"만 한다 — 평소 IDM 보다 더 밟는 일은 없다.
      const lead = i + 1 < main.length ? main[i + 1]! : null;
      const normal = lead
        ? idmAccel(v.params, v.v, lead.x - v.x - lead.length, v.v - lead.v)
        : idmAccel(v.params, v.v, null, 0);
      return Math.min(normal, ghost);
    },
  });

  if (st.ramp.length) step(st.ramp, dt, { override: (v) => yields.get(-v.id) });
  sc.t += dt;

  // 합류점 통과 → 본선 배열에 정렬 위치로 끼워 넣는다.
  for (let i = st.ramp.length - 1; i >= 0; i--) {
    const r = st.ramp[i]!;
    if (r.x < V2V.mergeAt) continue;
    r.lane = 0;
    let at = main.length;
    for (let j = 0; j < main.length; j++) {
      if (main[j]!.x > r.x) {
        at = j;
        break;
      }
    }
    main.splice(at, 0, r);
    st.ramp.splice(i, 1);
    st.merges++;
  }

  // 오른쪽 끝으로 빠진 차량은 내보내고, 왼쪽 끝에서 새로 들여보낸다.
  while (main.length && main[main.length - 1]!.x > V2V.length + 20) main.pop();
  const tail = main[0];
  if ((!tail || tail.x > MAIN_HEADWAY - 20) && main.length + st.ramp.length < V2V.count) {
    main.unshift(
      makeVehicle(st.nextId++, -20, V2V.v0, 'av', V2V.params, 0, CAR_LEN),
    );
  }
}

/* --- 공통 전진 ------------------------------------------------------ */

function buildScene(scenario: SimScenario, mode: PlatoonMode, avCount: number): Scene {
  if (scenario === 'platoon') return buildPlatoon(mode);
  if (scenario === 'shockwave') return buildRing(avCount);
  if (scenario === 'dispatch') return buildDispatch();
  return buildV2V();
}

/** 이력 버퍼에서 뒤에서 `back` 번째부터 `n` 개의 평균. */
function histMean(r: NonNullable<Scene['ring']>, back: number, n: number): number {
  let s = 0;
  for (let k = 0; k < n; k++) {
    s += r.hist[(r.head - back - k + HIST_N * 2) % HIST_N]!;
  }
  return s / n;
}

/**
 * 링의 감쇠율을 확정해도 되는가.
 *
 * ① 측정 창(링 2바퀴 ≈104 s)이 다 찼고 — AV 투입 직후의 감쇠 과도구간을 통째로 배제한다.
 *    AV 1대일 때 진폭은 t=28 s 부근에서 한 번 평평해졌다가 다시 내려간다(실측 −46% → −95%).
 *    통계적 평탄성만 보면 그 가짜 평지에서 확정을 선언하게 되므로, 물리적 최소 관측
 *    시간을 먼저 요구한다.
 * ② 최근 6 s 평균이 그 직전 6 s 평균과 거의 같을 때.
 *
 * 한 번 확정되면 되돌리지 않는다(래치) — 계측기의 수치가 깜빡여서는 안 된다.
 */
function settleRing(sc: Scene): void {
  const r = sc.ring!;
  if (!Number.isNaN(r.settledAt) || sc.t < RING_WINDOW || r.filled < RING_W * 2) return;
  const recent = histMean(r, 1, RING_W);
  const prev = histMean(r, 1 + RING_W, RING_W);
  if (Math.abs(recent - prev) <= Math.max(0.04, 0.08 * prev)) r.settledAt = sc.t;
}

function advance(sc: Scene, dt: number): Scene {
  if (sc.scenario === 'platoon') return stepPlatoon(sc, dt);
  if (sc.scenario === 'shockwave') {
    step(sc.vehicles, dt, { circumference: sc.circumference, rng: sc.rng });
    sc.t += dt;
    const r = sc.ring!;
    r.sampleAcc += dt;
    if (r.sampleAcc >= HIST_STEP) {
      r.sampleAcc = 0;
      r.hist[r.head] = speedSpread(sc.vehicles);
      r.head = (r.head + 1) % HIST_N;
      if (r.filled < HIST_N) r.filled++;
      settleRing(sc);
    }
    return sc;
  }
  if (sc.scenario === 'dispatch') stepDispatch(sc, dt);
  else stepV2V(sc, dt);
  return sc;
}

/** 시나리오별 배속. */
const timeScale = (s: SimScenario): number =>
  s === 'platoon'
    ? PLATOON.timeScale
    : s === 'shockwave'
      ? RING.timeScale
      : s === 'dispatch'
        ? DISPATCH.timeScale
        : V2V.timeScale;

/** 정지 프레임에서 보여줄 시각(s) — 교란이 이미 전파된 시점. */
const stillTime = (s: SimScenario): number =>
  s === 'platoon' ? 30 : s === 'shockwave' ? 45 : s === 'dispatch' ? 24 : 30;

/** 정지 프레임의 미리돌리기 상한(s). 확정이 늦는 시나리오(링)를 위한 여유. */
const STILL_CAP = 150;

/** 이 씬의 결론값이 확정됐는가 — 정지 프레임 미리돌리기의 종료 조건. */
const isSettled = (sc: Scene): boolean =>
  sc.platoon
    ? !Number.isNaN(sc.platoon.settledAt)
    : sc.ring
      ? !Number.isNaN(sc.ring.settledAt)
      : true;

/* ------------------------------------------------------------------ *
 * 그리기 원시요소 — 전부 fillRect. arc() 없음.
 * ------------------------------------------------------------------ */

function dots(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  gap: number,
  size: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const n = Math.max(1, Math.round(len / gap));
  const half = size / 2;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    ctx.fillRect(Math.round(x0 + dx * k - half), Math.round(y0 + dy * k - half), size, size);
  }
}

/** 점으로 그린 원 — arc() 금지(하드 룰 1). */
function dotRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  gap: number,
  size: number,
): void {
  const n = Math.max(12, Math.round((2 * Math.PI * r) / gap));
  const half = size / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(
      Math.round(cx + Math.cos(a) * r - half),
      Math.round(cy + Math.sin(a) * r - half),
      size,
      size,
    );
  }
}

function car(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  angle: number,
  len: number,
  wid: number,
  color: string,
  brake: string | null,
): void {
  if (angle === 0) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(px - len / 2), Math.round(py - wid / 2), len, wid);
    if (brake) {
      ctx.fillStyle = brake;
      ctx.fillRect(Math.round(px - len / 2) - 2, Math.round(py - wid / 2), 2, wid);
    }
    return;
  }
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-len / 2, -wid / 2, len, wid);
  if (brake) {
    ctx.fillStyle = brake;
    ctx.fillRect(-len / 2 - 2, -wid / 2, 2, wid);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * 시나리오별 렌더러
 * ------------------------------------------------------------------ */

const PAD = 14;

/** 제동 중이면 제동등 색, 아니면 null. */
const brakeOf = (v: Vehicle, pal: Palette): string | null => (v.a < -0.9 ? pal.brake : null);

function drawPlatoon(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, pal: Palette) {
  const st = sc.platoon!;
  const vs = sc.vehicles;
  const rear = vs[0]!.x;
  const lead = vs[vs.length - 1]!.x;

  // 카메라: 후미를 왼쪽에 고정하고, 대열 길이에 맞춰 천천히 줌아웃한다.
  const want = Math.min(900, Math.max(360, lead - rear + 90));
  if (Number.isNaN(st.span)) {
    st.span = want;
    st.camX = rear - 30;
  } else {
    st.span += (want - st.span) * 0.02;
    st.camX += (rear - 30 - st.camX) * 0.12;
  }
  const scale = (W - PAD * 2) / st.span;
  const toX = (x: number) => PAD + (x - st.camX) * scale;

  const yRoad = Math.round(H * 0.27);
  const half = Math.max(5, Math.min(11, H * 0.04));

  // 도로 — 점선 헤어라인 2줄
  ctx.fillStyle = pal.line;
  dots(ctx, PAD, yRoad - half, W - PAD, yRoad - half, 5, 1);
  dots(ctx, PAD, yRoad + half, W - PAD, yRoad + half, 5, 1);

  // 거리 눈금 — 월드 좌표에 박혀 있어 도로가 흘러간다(주행 단서이자 축척).
  ctx.fillStyle = pal.hot;
  const tickStep = 50;
  for (let x = Math.floor(st.camX / tickStep) * tickStep; x < st.camX + st.span; x += tickStep) {
    const px = toX(x);
    if (px < PAD || px > W - PAD) continue;
    ctx.fillRect(Math.round(px), Math.round(yRoad - half - 5), 1, 4);
  }

  // 속도 프로파일 — 차량 위치 바로 아래에 막대. 파동이 어디 있는지 공간적으로 읽힌다.
  const yBase = Math.round(H * 0.94);
  const barMax = yBase - Math.round(H * 0.42);
  ctx.fillStyle = pal.mute;
  dots(ctx, PAD, yBase, W - PAD, yBase, 5, 1);

  const vRef = Math.max(st.v0, ...vs.map((v) => v.v));
  const carLen = Math.max(5, CAR_LEN * scale);
  const carWid = Math.max(3, Math.min(7, half * 0.9));

  for (let i = 0; i < vs.length; i++) {
    const v = vs[i]!;
    const px = toX(v.x);
    if (px < -20 || px > W + 20) continue;
    const isLead = i === vs.length - 1;
    const col = v.kind === 'human' ? pal.human : pal.av;

    car(ctx, px, yRoad, 0, carLen, carWid, col, brakeOf(v, pal));

    // 교란원(선두)이 제동 중이면 위에 틱을 하나 세운다.
    if (isLead && st.braking) {
      ctx.fillStyle = pal.brake;
      ctx.fillRect(Math.round(px), yRoad - half - 8, 1, 6);
    }

    const h = Math.round((v.v / vRef) * barMax);
    ctx.fillStyle = v.kind === 'human' ? pal.humanDim : pal.avDim;
    ctx.fillRect(Math.round(px) - 1, yBase - h, 3, h);
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(px) - 1, yBase - h, 3, 2);
  }
}

function drawRing(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, pal: Palette) {
  const st = sc.ring!;
  const vs = sc.vehicles;
  const C = sc.circumference!;

  // 넓은 화면에서는 링 옆에 속도 편차의 시계열 띠를 붙인다 — AV 를 넣으면 이 선이
  // 기준선 아래로 내려앉는다. 링만 두면 넓은 캔버스(가로세로비 3.8)의 오른쪽 절반이
  // 통째로 빈다.
  const wide = W >= 520;
  const ringW = wide ? Math.round(W * 0.42) : W;
  const cx = ringW / 2;
  const cy = H / 2;
  const R = Math.max(26, Math.min(ringW * 0.46, H * 0.44) - 16);
  const half = Math.max(4, R * 0.05);

  ctx.fillStyle = pal.line;
  dotRing(ctx, cx, cy, R - half, 6, 1);
  dotRing(ctx, cx, cy, R + half, 6, 1);

  const vRef = Math.max(RING.v0 * 1.2, ...vs.map((v) => v.v));
  const tickMax = Math.max(10, R * 0.2);
  const carLen = Math.max(5, (CAR_LEN / C) * 2 * Math.PI * R);
  const carWid = Math.max(3, Math.min(7, half * 1.1));

  for (const v of vs) {
    const a = (v.x / C) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const col = v.kind === 'human' ? pal.human : pal.av;

    // 속도 눈금 — 링 바깥으로 뻗는 막대. 정체 구간이 바로 보인다.
    const len = Math.max(1, (v.v / vRef) * tickMax);
    ctx.save();
    ctx.translate(cx + ca * (R + half + 2), cy + sa * (R + half + 2));
    ctx.rotate(a);
    ctx.fillStyle = v.kind === 'human' ? pal.humanDim : pal.avDim;
    ctx.fillRect(0, -1, len, 2);
    ctx.restore();

    car(ctx, cx + ca * R, cy + sa * R, a + Math.PI / 2, carWid, carLen, col, brakeOf(v, pal));
  }

  if (!wide) return;

  /* --- 속도 편차 띠 (최근 40초) -------------------------------------------
   *
   * 링 옆에 점만 흩뿌린 **스파크라인**이었다. 축도 눈금도 기준선의 뜻도 없어서
   * 내용이 아니라 장식으로 읽혔다("빈 자리에 떠 있는 선"). 지금은 축이 있는 띠다:
   *   · 세로축 0 … 4 m/s — 왼쪽 변에 0·2·4 눈금 틱
   *   · 가로축 최근 40초 — 아래 변에 10초마다 눈금 틱
   *   · 앰버 기준선 = 검증된 0-AV 속도편차(scenarios.ts). AV 를 넣으면 시안 궤적이
   *     이 선 아래로 내려온다 — 이 장면이 하려는 말 전부가 그 한 칸에 있다.
   *
   * 글자는 쓰지 않는다. 캔버스는 aria-hidden 이고, 읽는 값은 아래 계측 한 줄이 맡는다.
   */
  const x0 = ringW + PAD * 2;
  const x1 = W - PAD;
  const yBot = H - PAD - 4;
  const yTop = PAD + 4;
  const yOf = (v: number) => yBot - Math.min(1, v / HIST_FS) * (yBot - yTop);

  // 세로축 — 점선 헤어라인 + 0·2·4 m/s 눈금 틱
  ctx.fillStyle = pal.line;
  dots(ctx, x0, yTop, x0, yBot, 5, 1);
  ctx.fillStyle = pal.hot;
  for (let v = 0; v <= HIST_FS; v += HIST_FS / 2) {
    const y = Math.round(yOf(v));
    ctx.fillRect(x0 - 4, y, 4, 1);
  }

  // 가로축 — 10초 눈금. 시간이 실제로 흐른다는 것을 눈금이 말한다.
  ctx.fillStyle = pal.line;
  dots(ctx, x0, yBot, x1, yBot, 5, 1);
  ctx.fillStyle = pal.hot;
  const secs = HIST_N * HIST_STEP;
  for (let t = 0; t <= secs; t += 10) {
    const x = Math.round(x0 + (t / secs) * (x1 - x0));
    ctx.fillRect(x, yBot + 1, 1, 4);
  }

  // 검증된 0-AV 기준선 (scenarios.ts). 앰버 = 사람이 모는 교통 — 링의 차와 같은 색이다.
  ctx.fillStyle = pal.humanDim;
  dots(ctx, x0, yOf(RING.spreadByAV[0] ?? 3.09), x1, yOf(RING.spreadByAV[0] ?? 3.09), 6, 1);

  // 트레이스는 점으로만 찍는다 — 막대로 채우면 화면이 무거워지고 추세가 안 읽힌다.
  const wpx = (x1 - x0) / HIST_N;
  ctx.fillStyle = pal.av;
  for (let i = 0; i < st.filled; i++) {
    const idx = (st.head - st.filled + i + HIST_N * 2) % HIST_N;
    ctx.fillRect(Math.round(x0 + i * wpx), Math.round(yOf(st.hist[idx]!)), 2, 2);
  }
}

/** 네 모서리 틱 — HudFrame 과 같은 언어. 원은 하드 룰 1 로 금지다. */
function corners(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  for (const [ox, oy] of [
    [-r, -r],
    [r - t, -r],
    [-r, r - t],
    [r - t, r - t],
  ] as const) {
    ctx.fillRect(Math.round(x + ox), Math.round(y + oy), t, t);
  }
}

function drawDispatch(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, pal: Palette) {
  const st = sc.dispatch!;
  const net = st.net;

  /* 축척은 가로·세로를 **따로** 잡는다.
     계측기 캔버스의 가로세로비는 페이지마다 다르다(연구 페이지 3.8, 홈 패널 2.6).
     한 축척으로 맞추면 한쪽에서는 화면의 절반이 빈 채로 남는다. 도시의 블록은
     원래 정사각형이 아니므로 늘어난 격자도 도시로 읽힌다 — 다만 비가 지나치면
     도로가 아니라 줄무늬가 되므로 1.75배까지만 허용한다. 마커가 도면 밖으로
     나가므로 여백은 화면 픽셀로 뺀다(미터로 빼면 축척에 따라 여백이 달라진다). */
  const MARK = 24;
  let sx = Math.max(0.2, (W - PAD * 2 - MARK * 2) / net.w);
  let sy = Math.max(0.2, (H - PAD * 2 - MARK * 2) / net.h);
  const RATIO = 1.75;
  if (sx > sy * RATIO) sx = sy * RATIO;
  else if (sy > sx * RATIO) sy = sx * RATIO;
  const SX = (x: number) => W / 2 + x * sx;
  const SY = (y: number) => H / 2 + y * sy;

  /** 차로 폭의 절반(px). 한 줄짜리 선은 "도로"로 읽히지 않는다. */
  const halfW = Math.max(3, Math.min(9, 7.2 * Math.min(sx, sy)));

  /* --- 도로 -------------------------------------------------------- */
  for (const [a, b] of net.edges) {
    const A = net.nodes[a]!;
    const B = net.nodes[b]!;
    const ax = SX(A.x);
    const ay = SY(A.y);
    const bx = SX(B.x);
    const by = SY(B.y);
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / L) * halfW;
    const ny = ((bx - ax) / L) * halfW;
    // 경계는 굵게(2px). 1px 점선으로는 도로망이 아니라 **연필 자국**으로 보였다.
    ctx.fillStyle = pal.hot;
    dots(ctx, ax + nx, ay + ny, bx + nx, by + ny, 5, 2);
    dots(ctx, ax - nx, ay - ny, bx - nx, by - ny, 5, 2);
    ctx.fillStyle = pal.line;
    dots(ctx, ax, ay, bx, by, 11, 1);
  }

  /* --- 교차로 ------------------------------------------------------ */
  ctx.fillStyle = pal.hot;
  for (const q of net.nodes) ctx.fillRect(Math.round(SX(q.x)) - 2, Math.round(SY(q.y)) - 2, 5, 5);

  // 점멸은 계단 함수다 — 페이드가 아니라 계측기의 깜빡임.
  const blink = sc.t * 2.2 - Math.floor(sc.t * 2.2) < 0.62;

  /* --- 배차 링크 ----------------------------------------------------
     차량에서 목표까지 **실제 경로를 따라** 점을 찍는다. 직선으로 화면을 가로지르면
     차가 갈 길과 무관해져서, 배차가 아니라 레이저 포인터로 보인다. */
  for (const job of st.jobs) {
    if (job.phase === 0 || job.veh < 0) continue;
    const nv = st.nav[job.veh];
    if (!nv) continue;
    const p = navPoint(net, nv);
    ctx.fillStyle = job.phase === 1 ? (blink ? pal.linkOn : pal.linkOff) : pal.linkOff;
    let px = SX(p.x);
    let py = SY(p.y);
    for (const k of [nv.b, ...nv.route]) {
      const q = net.nodes[k]!;
      dots(ctx, px, py, SX(q.x), SY(q.y), 7, 2);
      px = SX(q.x);
      py = SY(q.y);
    }
  }

  /* --- 수요 --------------------------------------------------------
     **기다린 만큼 커진다.** 크기가 대기시간이라, 차가 늦으면 화면에서 먼저 보인다. */
  for (const job of st.jobs) {
    const o = net.nodes[job.origin]!;
    const waited = Math.min(16, sc.t - job.born);
    const r = 8 + waited * 0.75;
    ctx.fillStyle = job.phase === 0 ? (blink ? pal.node : pal.humanDim) : pal.avDim;
    corners(ctx, SX(o.x), SY(o.y), job.phase === 0 ? r : 7, 3);
    if (job.phase === 0) {
      // 기다리는 사람 — 마커 한가운데. 배차되면 사라지고 차량이 그 자리를 잇는다.
      ctx.fillRect(Math.round(SX(o.x)) - 1, Math.round(SY(o.y)) - 1, 3, 3);
    }
    if (job.phase !== 2) continue;
    // 승차한 뒤에는 목적지가 켜진다.
    const d = net.nodes[job.dest]!;
    ctx.fillStyle = pal.av;
    corners(ctx, SX(d.x), SY(d.y), 8, 3);
  }

  /* --- 차량 --------------------------------------------------------
     우측통행으로 반 차로 비킨다 — 마주 오는 차와 겹치지 않는다. */
  const carLen = Math.max(7, CAR_LEN * Math.min(sx, sy) * 1.8);
  const carWid = Math.max(3, halfW * 1.05);
  for (const v of sc.vehicles) {
    const nv = st.nav[v.id];
    if (!nv) continue;
    const p = navPoint(net, nv);
    const A = net.nodes[nv.a]!;
    const B = net.nodes[nv.b]!;
    // 각도는 **화면 좌표**에서 잰다 — 가로·세로 축척이 달라 월드 각과 다르다.
    const ang = Math.atan2(SY(B.y) - SY(A.y), SX(B.x) - SX(A.x));
    car(
      ctx,
      SX(p.x) - Math.sin(ang) * halfW * 0.5,
      SY(p.y) + Math.cos(ang) * halfW * 0.5,
      ang,
      carLen,
      carWid,
      nv.job >= 0 ? pal.av : pal.avDim,
      brakeOf(v, pal),
    );
  }
}

function drawV2V(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, pal: Palette) {
  const st = sc.v2v!;
  const scale = (W - PAD * 2) / V2V.length;
  const toX = (x: number) => PAD + x * scale;

  /* 본선을 위쪽에 두고 램프를 깊게 내려 캔버스 세로를 실제로 쓴다.
     이전 배치(본선 0.38H · 램프 0.30H)는 위아래로 각각 30% 가까이 비어 있었다. */
  const yMain = Math.round(H * 0.26);
  const half = Math.max(7, Math.min(20, H * 0.075));
  const rampDrop = Math.max(36, H * 0.50);

  /** 램프 위치 s → 본선으로부터의 세로 오프셋(px). 합류점에서 0 — 두 차로가 만난다. */
  const rampOff = (s: number) => rampDrop * Math.min(1, Math.max(0, (V2V.mergeAt - s) / RAMP_LEN));

  /* --- 본선 -------------------------------------------------------- */
  ctx.fillStyle = pal.hot;
  dots(ctx, PAD, yMain - half, W - PAD, yMain - half, 4, 1);
  dots(ctx, PAD, yMain + half, W - PAD, yMain + half, 4, 1);

  /* --- 합류로 ------------------------------------------------------
     본선으로 수렴하는 자기 차로. 경계 두 줄이 있어야 "길"로 읽힌다. */
  const stepS = RAMP_LEN / 110;
  ctx.fillStyle = pal.hot;
  for (let sm = V2V.mergeAt - RAMP_LEN; sm < V2V.mergeAt; sm += stepS) {
    const y = yMain + rampOff(sm);
    ctx.fillRect(Math.round(toX(sm)), Math.round(y - half), 1, 1);
    ctx.fillRect(Math.round(toX(sm)), Math.round(y + half), 1, 1);
  }

  // 합류점 게이트 — 세로 틱으로 "여기서 합쳐진다"를 못박는다
  ctx.fillStyle = pal.node;
  for (let y = yMain - half - 8; y < yMain + half + 8; y += 4) {
    ctx.fillRect(Math.round(toX(V2V.mergeAt)), Math.round(y), 1, 2);
  }

  const posOf = (v: Vehicle) => ({ x: toX(v.x), y: v.lane === 0 ? yMain : yMain + rampOff(v.x) });

  /* --- V2V 링크 ----------------------------------------------------
     통신 반경 안에 들어온 쌍끼리 점멸한다. */
  const blink = sc.t * 1.8 - Math.floor(sc.t * 1.8) < 0.7;
  let links = 0;
  const main = sc.vehicles;

  ctx.fillStyle = blink ? pal.linkOn : pal.linkOff;
  for (let i = 0; i + 1 < main.length; i++) {
    const a = main[i]!;
    const b = main[i + 1]!;
    if (b.x - a.x > V2V.range) continue;
    links++;
    const pa = posOf(a);
    const pb = posOf(b);
    dots(ctx, pa.x, pa.y - half - 4, pb.x, pb.y - half - 4, 4, 1);
  }
  for (const r of st.ramp) {
    const pr = posOf(r);
    for (const m of main) {
      if (Math.abs(m.x - r.x) > V2V.range) continue;
      links++;
      const pm = posOf(m);
      dots(ctx, pr.x, pr.y, pm.x, pm.y, 4, 1);
    }
  }
  st.links = links;

  /* --- 양보 간격 ----------------------------------------------------
     "협조"의 실체는 본선 차량이 간격을 벌려 주는 순간이다.
     떨어진 막대그래프 대신 **차량 사이에 직접 브래킷을 그어** 어느 간격인지 못박는다.
     램프 차량이 끼어들 자리(가장 가까운 본선 쌍)는 시안으로 점등한다. */
  const yieldPair = new Set<number>();
  for (const r of st.ramp) {
    if (r.x > V2V.mergeAt) continue;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i + 1 < main.length; i++) {
      const mid = (main[i]!.x + main[i + 1]!.x) / 2;
      const d = Math.abs(mid - r.x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD < V2V.range) yieldPair.add(best);
  }

  const yBr = Math.round(yMain + half + 8);
  for (let i = 0; i + 1 < main.length; i++) {
    const a = main[i]!;
    const b = main[i + 1]!;
    const gap = b.x - a.x - CAR_LEN;
    if (gap <= 0) continue;

    const open = yieldPair.has(i);

    /* 모든 쌍에 브래킷을 그으면 화면을 가로지르는 한 줄의 점선이 되어
       "개별 간격"으로 읽히지 않는다. 합류가 걸린 쌍과 그 부근만 그린다. */
    const mid = (a.x + b.x) / 2;
    if (!open && Math.abs(mid - V2V.mergeAt) > V2V.range) continue;
    // 평상시 간격도 읽혀야 비교가 된다 — avDim(0.32)은 너무 어두웠다.
    ctx.fillStyle = open ? pal.av : pal.mute;

    const xa = toX(a.x) + 2;
    const xb = toX(b.x) - 2;
    if (xb - xa < 6) continue;

    // 수평 브래킷 + 양끝 세로 틱 — 이 간격이 누구와 누구 사이인지 분명해진다
    dots(ctx, xa, yBr, xb, yBr, 3, 1);
    ctx.fillRect(Math.round(xa), Math.round(yBr) - 4, 1, 9);
    ctx.fillRect(Math.round(xb), Math.round(yBr) - 4, 1, 9);

    // 벌어지는 중인 간격은 차량까지 잇는 세로 유도선을 덧붙인다
    if (open) {
      dots(ctx, xa, yMain + half, xa, yBr - 4, 3, 1);
      dots(ctx, xb, yMain + half, xb, yBr - 4, 3, 1);
    }
  }

  /* --- 차량 -------------------------------------------------------- */
  const carLen = Math.max(6, CAR_LEN * scale);
  const carWid = Math.max(4, Math.min(9, half * 0.85));
  for (const v of main) {
    const p = posOf(v);
    car(ctx, p.x, p.y, 0, carLen, carWid, pal.av, brakeOf(v, pal));
  }
  // 램프 차량은 합류 전까지 조금 흐리게 — 본선에 아직 속하지 않았다는 표시
  for (const r of st.ramp) {
    const p = posOf(r);
    car(ctx, p.x, p.y, 0, carLen, carWid, r.x < V2V.mergeAt ? pal.avDim : pal.av, brakeOf(r, pal));
  }
}


/* ------------------------------------------------------------------ *
 * 계측
 * ------------------------------------------------------------------ */

function metricsOf(sc: Scene): TrafficMetrics {
  const vs = sc.vehicles;
  const n = vs.length || 1;
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vs) {
    sum += v.v;
    if (v.v < lo) lo = v.v;
    if (v.v > hi) hi = v.v;
  }

  const m: TrafficMetrics = {
    scenario: sc.scenario,
    t: sc.t,
    // 03·04 는 확정을 기다리는 결론값이 없다 — 누적 카운터라 언제 읽어도 그 시점의 실측이다.
    settled: true,
    settledAtS: Number.NaN,
    spread: sc.spreadEma,
    meanKmh: (sum / n) * 3.6,
    minKmh: lo * 3.6,
    maxKmh: hi * 3.6,
    leadDropKmh: Number.NaN,
    rearDropKmh: Number.NaN,
    amp: Number.NaN,
    braking: false,
    lastAmp: Number.NaN,
    waveVeh: Number.NaN,
    avCount: Number.NaN,
    reductionPct: Number.NaN,
    windowS: Number.NaN,
    pending: Number.NaN,
    assigned: Number.NaN,
    served: Number.NaN,
    meanWaitS: Number.NaN,
    links: Number.NaN,
    merges: Number.NaN,
  };

  if (sc.platoon) {
    const st = sc.platoon;
    const last = vs.length - 1;
    // 교란 크기 = 초기 순항속도 대비 최저 속도의 낙폭.
    const leadDrop = st.v0 - st.minV[last]!;
    const rearDrop = st.v0 - st.minV[0]!;
    m.leadDropKmh = leadDrop * 3.6;
    m.rearDropKmh = rearDrop * 3.6;
    m.amp = ampOf(sc);
    m.braking = st.braking;
    m.lastAmp = st.lastAmp;
    m.waveVeh = vs.length - st.waveFront;
    m.settled = !Number.isNaN(st.settledAt);
    m.settledAtS = st.settledAt;
  }
  if (sc.ring) {
    m.avCount = sc.ring.avCount;
    const base = RING.spreadByAV[0] ?? 3.09;
    m.reductionPct = (1 - sc.spreadSlow / base) * 100;
    m.windowS = RING_WINDOW;
    m.settled = !Number.isNaN(sc.ring.settledAt);
    m.settledAtS = sc.ring.settledAt;
  }
  if (sc.dispatch) {
    const st = sc.dispatch;
    m.pending = st.jobs.filter((j) => j.phase === 0).length;
    m.assigned = st.jobs.filter((j) => j.phase !== 0).length;
    m.served = st.served;
    m.meanWaitS = st.served > 0 ? st.waitSum / st.served : Number.NaN;
  }
  if (sc.v2v) {
    m.links = sc.v2v.links;
    m.merges = sc.v2v.merges;
  }
  return m;
}

/* ------------------------------------------------------------------ *
 * 훅
 * ------------------------------------------------------------------ */

export function useTrafficSim(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { scenario, mode = 'acc', avCount = 0, target, reducedMotion = false, onMetrics }: TrafficSimOptions,
): void {
  const sceneRef = useRef<Scene | null>(null);
  const palRef = useRef<Palette | null>(null);
  const drawRef = useRef<(dt: number, elapsed: number) => void>(() => {});
  const metricsRef = useRef(onMetrics);
  metricsRef.current = onMetrics;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const emitRef = useRef(0);

  const view = useCanvas2D(canvasRef, {
    maxDpr: 2,
    alpha: false,
    onResize: (v: Canvas2DView) => {
      // 버퍼를 다시 잡으면 화면이 비므로 정지 프레임 모드에서는 즉시 다시 그린다.
      if (v.ctx) requestAnimationFrame(() => drawRef.current(0, 0));
    },
  });

  const draw = (dt: number): void => {
    const v = view.current;
    const ctx = v.ctx;
    if (!ctx) return;
    const W = v.width;
    const H = v.height;
    if (W < 8 || H < 8) return;

    const pal = palRef.current ?? (palRef.current = buildPalette());
    let sc = sceneRef.current;
    const still = reducedRef.current;

    if (!sc) {
      sc = buildScene(scenario, mode, avCount);
      // 정지 프레임: 교란이 이미 전파된 시점까지 미리 돌려 둔다. 그림이 자리잡은 뒤에도
      // 결론값이 아직 확정 전이면(링은 2바퀴가 필요하다) 확정될 때까지 더 돌린다 —
      // 멈춰 있는 화면에 "측정 중"이 떠 있으면 영원히 측정 중이다.
      if (still) {
        const until = stillTime(scenario);
        // 스텝 수로 상한을 건다 — 플래툰은 사이클마다 t 가 0 으로 돌아가므로
        // 시간으로 거는 상한은 빠져나오지 못한다.
        const maxSteps = Math.round((until + STILL_CAP) / PHYS_DT);
        for (let k = 0; k < maxSteps && (sc.t < until || !isSettled(sc)); k++) {
          sc = advance(sc, PHYS_DT);
        }
      }
      sc.spreadEma = speedSpread(sc.vehicles);
      // 정지 프레임에는 걸러낼 이력이 없다 — 측정값을 그대로 표기한다.
      if (still || sc.spreadSlow === 0) sc.spreadSlow = sc.spreadEma;
      sceneRef.current = sc;
    }

    if (!still && dt > 0) {
      sc.accum += dt * timeScale(sc.scenario);
      let subs = 0;
      while (sc.accum >= PHYS_DT && subs < MAX_SUB) {
        sc = advance(sc, PHYS_DT);
        sc.accum -= PHYS_DT;
        subs++;
      }
      if (subs >= MAX_SUB) sc.accum = 0;
      sceneRef.current = sc;
      // 표기용 EMA — 원시 표준편차는 프레임마다 튀어서 숫자가 읽히지 않는다.
      // 기준값 대비 증감률은 더 느린 EMA 로 재야 부호가 흔들리지 않는다.
      const raw = speedSpread(sc.vehicles);
      sc.spreadEma += (raw - sc.spreadEma) * Math.min(1, dt * 1.6);
      sc.spreadSlow += (raw - sc.spreadSlow) * Math.min(1, dt * 0.22);
    }

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    if (sc.scenario === 'platoon') drawPlatoon(ctx, W, H, sc, pal);
    else if (sc.scenario === 'shockwave') drawRing(ctx, W, H, sc, pal);
    else if (sc.scenario === 'dispatch') drawDispatch(ctx, W, H, sc, pal);
    else drawV2V(ctx, W, H, sc, pal);

    // 계측값은 초당 5회만 내보낸다 — 숫자가 읽힐 속도로.
    emitRef.current += dt;
    if (still || emitRef.current >= 0.2) {
      emitRef.current = 0;
      metricsRef.current?.(metricsOf(sc));
    }
  };

  drawRef.current = draw;

  // 시나리오·모드 전환 → 씬을 새로 만든다. (avCount 변경도 동일 초기조건에서
  // 다시 시작한다 — 같은 파동에 AV 대수만 바꾼 대조 실험이 된다.)
  useEffect(() => {
    sceneRef.current = null;
    emitRef.current = 1;
    const id = requestAnimationFrame(() => drawRef.current(0, 0));
    return () => cancelAnimationFrame(id);
  }, [scenario, mode, avCount]);

  useRafLoop((dt) => drawRef.current(dt, 0), {
    target,
    // 한 페이지에 시뮬이 4개다. 기본 여유(200px)를 없애 화면에 실제로 들어온 것만 돌린다.
    rootMargin: '0px',
    reducedMotion,
    fps: 30,
    maxDelta: 1 / 20,
  });
}
