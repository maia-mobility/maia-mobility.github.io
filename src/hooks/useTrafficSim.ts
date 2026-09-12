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
    /** 루프 위 수요 노드의 고정 위치(m) */
    nodes: number[];
    jobs: Job[];
    next: number;
    served: number;
    waitSum: number;
    /** 차량 id 별 운행 여부 */
    busy: Uint8Array;
    /** 차량 id 별 정차 종료 시각 */
    dwell: Float64Array;
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

/* --- 03 dispatch --------------------------------------------------- */

/** 배차 루프 — 둘레가 DISPATCH.length(520m) 인 직사각 회로. 2*(215+45)=520. */
const LOOP_W = 222;
const LOOP_H = 38;
/**
 * 수요 노드를 회로 바깥으로 밀어내는 거리(m). 축척에도 이 여백을 포함시킨다.
 *
 * 치수(222×38)는 캔버스가 가로로 길다는 점에 맞췄다. 이전 215×45 + NODE_OUT 14 는
 * 세로가 축척을 잡아먹어 가로로 700px 가 비었다. 둘레는 2*(222+38)=520m 로 동일하다.
 */
const NODE_OUT = 9;

function buildDispatch(): Scene {
  const rng = makeRng(DISPATCH.seed);
  const C = 2 * (LOOP_W + LOOP_H);
  const vehicles = seedRing(
    DISPATCH.count,
    C,
    () => ({ kind: 'av', params: DISPATCH.params }),
    DISPATCH.v0,
    rng,
  );
  const nodes = Array.from({ length: DISPATCH.nodes }, (_, j) => ((j + 0.35) * C) / DISPATCH.nodes);
  return {
    scenario: 'dispatch',
    vehicles,
    rng,
    t: 0,
    accum: 0,
    spreadEma: 0,
    spreadSlow: 0,
    circumference: C,
    dispatch: {
      nodes,
      jobs: [],
      next: 1,
      served: 0,
      waitSum: 0,
      busy: new Uint8Array(DISPATCH.count),
      dwell: new Float64Array(DISPATCH.count),
    },
  };
}

/** 링 위에서 a → b 까지 진행 방향 거리. */
function ahead(a: number, b: number, C: number): number {
  let d = b - a;
  if (d < 0) d += C;
  return d;
}

function stepDispatch(sc: Scene, dt: number): void {
  const st = sc.dispatch!;
  const C = sc.circumference!;
  const vs = sc.vehicles;
  const used = new Set<number>();
  for (const j of st.jobs) {
    used.add(j.origin);
    used.add(j.dest);
  }

  // 새 수요 — 비어 있는 노드에서 발생하고, 목적지는 다른 빈 노드로 잡는다.
  if (sc.t >= st.next && st.jobs.length < DISPATCH.nodes - 1) {
    const free = st.nodes.map((_, i) => i).filter((i) => !used.has(i));
    if (free.length >= 2) {
      const oi = Math.min(free.length - 1, Math.floor(sc.rng() * free.length));
      const origin = free.splice(oi, 1)[0]!;
      const dest = free[Math.min(free.length - 1, Math.floor(sc.rng() * free.length))]!;
      st.jobs.push({ origin, dest, veh: -1, born: sc.t, phase: 0 });
    }
    st.next = sc.t + DISPATCH.demandInterval * (0.7 + sc.rng() * 0.7);
  }

  // 배차 — 출발 노드까지 진행 방향 거리가 가장 짧은 유휴 차량
  for (const job of st.jobs) {
    if (job.phase !== 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (const v of vs) {
      if (st.busy[v.id]) continue;
      const d = ahead(v.x, st.nodes[job.origin]!, C);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    if (best >= 0) {
      job.veh = best;
      job.phase = 1;
      st.busy[best] = 1;
    }
  }

  // 도착 판정 — 목표 노드를 막 지나쳤으면 정차한다.
  const byId = new Map<number, Vehicle>();
  for (const v of vs) byId.set(v.id, v);
  for (let i = st.jobs.length - 1; i >= 0; i--) {
    const job = st.jobs[i]!;
    if (job.phase === 0) continue;
    const v = byId.get(job.veh);
    if (!v || sc.t < st.dwell[v.id]!) continue;
    const target = st.nodes[job.phase === 1 ? job.origin : job.dest]!;
    if (ahead(v.x, target, C) < C - 7) continue;
    st.dwell[v.id] = sc.t + 1.2;
    if (job.phase === 1) {
      job.phase = 2;
      st.waitSum += sc.t - job.born;
    } else {
      st.served++;
      st.busy[v.id] = 0;
      st.jobs.splice(i, 1);
    }
  }

  step(vs, dt, {
    circumference: C,
    rng: sc.rng,
    // 승하차 정차 — 물리는 그대로 두고 가속도만 눌러 세운다. 뒤차는 IDM 이 알아서 선다.
    override: (v) => (sc.t < st.dwell[v.id]! ? (v.v > 0.2 ? -v.params.b : 0) : undefined),
  });
  sc.t += dt;
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

  // 넓은 화면에서는 링 옆에 속도 변동 시계열을 붙인다 — AV 를 넣으면 이 선이 내려앉는다.
  const wide = W >= 520;
  const ringW = wide ? Math.round(W * 0.46) : W;
  const cx = ringW / 2;
  const cy = H / 2;
  const R = Math.max(26, Math.min(ringW * 0.4, H * 0.42) - 18);
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

  /* --- 속도 변동 시계열 (최근 40초) --- */
  const x0 = ringW + PAD;
  const x1 = W - PAD;
  const yBot = Math.round(H * 0.86);
  const yTop = Math.round(H * 0.16);
  const yOf = (v: number) => yBot - Math.min(1, v / HIST_FS) * (yBot - yTop);

  ctx.fillStyle = pal.mute;
  dots(ctx, x0, yBot, x1, yBot, 5, 1);
  // 검증된 0-AV 기준선 (scenarios.ts)
  ctx.fillStyle = pal.hot;
  dots(ctx, x0, yOf(RING.spreadByAV[0] ?? 3.09), x1, yOf(RING.spreadByAV[0] ?? 3.09), 7, 1);

  // 트레이스는 점으로만 찍는다 — 막대로 채우면 화면이 무거워지고 추세가 안 읽힌다.
  const wpx = (x1 - x0) / HIST_N;
  ctx.fillStyle = pal.av;
  for (let i = 0; i < st.filled; i++) {
    const idx = (st.head - st.filled + i + HIST_N * 2) % HIST_N;
    ctx.fillRect(Math.round(x0 + i * wpx), Math.round(yOf(st.hist[idx]!)), 2, 2);
  }
}

/** 배차 루프의 월드 좌표 → 화면. 직사각 회로를 따라간다. */
function loopPoint(s: number, C: number): { x: number; y: number; a: number } {
  const d = ((s % C) + C) % C;
  const hw = LOOP_W / 2;
  const hh = LOOP_H / 2;
  if (d < LOOP_W) return { x: -hw + d, y: -hh, a: 0 };
  if (d < LOOP_W + LOOP_H) return { x: hw, y: -hh + (d - LOOP_W), a: Math.PI / 2 };
  if (d < 2 * LOOP_W + LOOP_H)
    return { x: hw - (d - LOOP_W - LOOP_H), y: hh, a: Math.PI };
  return { x: -hw, y: hh - (d - 2 * LOOP_W - LOOP_H), a: -Math.PI / 2 };
}

function drawDispatch(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, pal: Palette) {
  const st = sc.dispatch!;
  const C = sc.circumference!;
  const scale = Math.min(
    (W - PAD * 2) / (LOOP_W + NODE_OUT * 2),
    (H - PAD * 2) / (LOOP_H + NODE_OUT * 2),
  );
  const cx = W / 2;
  const cy = H / 2;
  const toS = (p: { x: number; y: number }) => ({ x: cx + p.x * scale, y: cy + p.y * scale });

  /** 차로 폭의 절반(px). 회로를 선이 아니라 "도로"로 보이게 하는 값. */
  const halfW = Math.max(3, Math.min(9, LOOP_H * scale * 0.16));

  /** 진행 방향 왼쪽으로 오프셋한 점 — 도로 양쪽 경계를 그리는 데 쓴다. */
  const edge = (s: number, side: number) => {
    const p = loopPoint(((s % C) + C) % C, C);
    const sp = toS(p);
    return { x: sp.x - Math.sin(p.a) * halfW * side, y: sp.y + Math.cos(p.a) * halfW * side };
  };

  /* --- 도로 --------------------------------------------------------
     한 줄짜리 희미한 점선은 "도로"로 읽히지 않는다. 양쪽 경계를 --line-hot 으로
     긋고 가운데에 차선 파선을 넣어야 비로소 주행로로 보인다. */
  const seg = 3; // m 단위 표본 간격
  ctx.fillStyle = pal.hot;
  for (let s = 0; s < C; s += seg) {
    for (const side of [1, -1] as const) {
      const e = edge(s, side);
      ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    }
  }
  // 중앙 차선 파선 — 6m 그리고 6m 띄운다
  ctx.fillStyle = pal.line;
  for (let s = 0; s < C; s += 12) {
    for (let k = 0; k < 6; k += 2) {
      const p = toS(loopPoint((s + k) % C, C));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }

  // 노드 위치 — 회로 바깥쪽으로 밀어낸다.
  const nodeAt = (idx: number) => {
    const p = loopPoint(st.nodes[idx]!, C);
    const out = NODE_OUT;
    const nx = p.x + (p.a === Math.PI / 2 ? out : p.a === -Math.PI / 2 ? -out : 0);
    const ny = p.y + (p.a === 0 ? -out : p.a === Math.PI ? out : 0);
    return { marker: toS({ x: nx, y: ny }), curb: toS(p) };
  };

  // 역할 표: 0 유휴 · 1 대기 수요 · 2 픽업 대상 · 3 하차 지점
  const role = new Uint8Array(st.nodes.length);
  for (const job of st.jobs) {
    role[job.origin] = job.phase === 0 ? 1 : job.phase === 1 ? 2 : 0;
    if (job.phase === 2) role[job.dest] = 3;
  }

  // 점멸은 계단 함수(2단계)로 낸다 — 페이드가 아니라 계측기의 깜빡임이다.
  const blink = sc.t * 2.2 - Math.floor(sc.t * 2.2) < 0.62;

  /* --- 배차 경로 ----------------------------------------------------
     차량에서 목표 노드까지 **도로를 따라** 점을 찍는다.
     직선으로 화면을 가로지르면 차량이 실제로 갈 경로와 무관해 오해를 부른다. */
  const byId = new Map(sc.vehicles.map((v) => [v.id, v]));
  for (const job of st.jobs) {
    if (job.phase === 0) continue;
    const v = byId.get(job.veh);
    if (!v) continue;
    const target = st.nodes[job.phase === 1 ? job.origin : job.dest]!;
    const dist = ahead(v.x, target, C);
    ctx.fillStyle = job.phase === 1 ? (blink ? pal.linkOn : pal.linkOff) : pal.linkOff;
    // 6m 간격으로 경로를 따라간다. 픽업 전(phase 1)은 밝게 점멸한다.
    for (let d = 0; d <= dist; d += 6) {
      const p = toS(loopPoint(v.x + d, C));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    // 목표에 닿는 마지막 구간 — 노드까지 이어 붙인다
    const nm = nodeAt(job.phase === 1 ? job.origin : job.dest);
    dots(ctx, nm.curb.x, nm.curb.y, nm.marker.x, nm.marker.y, 3, 2);
  }

  /* --- 수요 노드 ----------------------------------------------------
     모양은 늘 같다(코너 틱 4개 — HudFrame 언어). 상태는 색과 점멸로만 말한다. */
  for (let i = 0; i < st.nodes.length; i++) {
    const { marker, curb } = nodeAt(i);
    const active = role[i] !== 0;
    const lit = role[i] === 1 ? blink : true;

    ctx.fillStyle =
      role[i] === 0
        ? pal.hot
        : role[i] === 1
          ? lit
            ? pal.node
            : pal.humanDim
          : role[i] === 2
            ? pal.av
            : pal.avDim;

    // 코너 틱 — 활성 노드는 더 크게
    const r = active ? 9 : 5;
    const t = active ? 3 : 2;
    for (const [ox, oy] of [
      [-r, -r],
      [r - t, -r],
      [-r, r - t],
      [r - t, r - t],
    ] as const) {
      ctx.fillRect(Math.round(marker.x + ox), Math.round(marker.y + oy), t, t);
    }

    // 연석의 정차 표시 — 노드가 도로 위 어느 지점인지 못박는다
    const cd = Math.hypot(marker.x - curb.x, marker.y - curb.y) || 1;
    const ux = (marker.x - curb.x) / cd;
    const uy = (marker.y - curb.y) / cd;
    for (let k = -halfW; k <= halfW; k += 2) {
      ctx.fillRect(Math.round(curb.x - uy * k), Math.round(curb.y + ux * k), 2, 2);
    }

    if (!active) continue;
    // 중심점 + 연석까지 내려가는 짧은 연결선
    ctx.fillRect(Math.round(marker.x) - 1, Math.round(marker.y) - 1, 3, 3);
    ctx.fillStyle = pal.linkOff;
    dots(ctx, marker.x, marker.y, curb.x, curb.y, 3, 1);
  }

  /* --- 차량 --------------------------------------------------------
     배차된 차량은 밝은 시안, 유휴는 흐리게. 정차 중이면 제동등이 켜진다. */
  const carLen = Math.max(5, CAR_LEN * scale * 1.4);
  const carWid = Math.max(3, halfW * 1.3);
  for (const v of sc.vehicles) {
    const p = loopPoint(v.x, C);
    const sp = toS(p);
    car(ctx, sp.x, sp.y, p.a, carLen, carWid, st.busy[v.id] ? pal.av : pal.avDim, brakeOf(v, pal));
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
