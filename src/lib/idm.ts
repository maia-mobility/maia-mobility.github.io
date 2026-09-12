/**
 * IDM(Intelligent Driver Model) 차량추종 모델.
 *
 * 순수 물리만 담당한다 — DOM·캔버스·React 를 일절 참조하지 않는다.
 * 렌더링은 `useTrafficSim` 이, 파라미터 선택은 각 시나리오가 맡는다.
 *
 * 모델 (Treiber, Hennecke & Helbing, 2000):
 *
 *   a = aMax · [ 1 − (v/v0)^δ − (s*(v, Δv) / s)² ]
 *   s*(v, Δv) = s0 + max(0, v·T + v·Δv / (2·√(aMax·b)))
 *
 *   v   자차 속도            s   앞차와의 순간격(범퍼-범퍼)
 *   v0  희망 속도            Δv  접근 속도 (v − v_앞차)
 *   s0  정지 시 최소 간격     T   희망 차두시간
 *   aMax 최대 가속            b   쾌적 감속
 *
 * 이 사이트에서 중요한 점 — **상용 ACC 는 스트링 안정적이지 않다.**
 * 연구실의 TR-C 논문이 실측으로 보인 결과가 그것이고, 시뮬레이션도 그렇게 거동해야 한다.
 * 없는 안정성을 꾸며내지 말 것.
 */

export interface IDMParams {
  /** 희망 속도 (m/s) */
  v0: number;
  /** 희망 차두시간 (s) — 스트링 안정성을 가르는 가장 중요한 값 */
  T: number;
  /** 정지 시 최소 간격 (m) */
  s0: number;
  /** 최대 가속 (m/s²) */
  aMax: number;
  /** 쾌적 감속 (m/s²) */
  b: number;
  /** 가속 지수 — 보통 4 */
  delta: number;
  /**
   * 반응 지연 (s). 사람 운전자의 스트링 불안정성을 만드는 주범.
   * 지연은 이산 스텝 수로 반올림되므로 dt 보다 작으면 0 으로 취급된다.
   */
  reaction: number;
  /** 가속도에 섞이는 잡음 크기 (m/s²). 사람은 일정하게 밟지 못한다. */
  noise: number;
}

export type VehicleKind = 'human' | 'av';

/**
 * 파라미터 프리셋.
 *
 * - `human`         사람 운전자. 반응 지연 + 잡음 → 스트링 불안정.
 * - `accCommercial` 양산 상용 ACC. 작동 지연이 커서 **교란을 뒤로 갈수록 증폭시킨다**.
 *                   연구실 TR-C 논문의 실측 결과가 바로 이것이다.
 * - `avControlled`  제어 정책이 적용된 AV. 지연 없이 단호하게 반응해 교란을 흡수한다.
 * - `avBase`        FollowerStopper 차량의 대체 IDM. 앞차가 없을 때만 쓰인다.
 *
 * ── 검증된 거동 (플래툰 12대, 54 km/h, 선두 −2.5 m/s² × 3초) ──
 *   human         3.92x 증폭 — 후미 완전 정지
 *   accCommercial 1.30x 증폭 — 정지 없이 39 → 33 km/h 로 점진 악화
 *   avControlled  0.52x        — 교란 흡수 (브라우저 실측 0.54)
 *
 * ── 링 도로 (둘레 400 m, 22대, 평형 28 km/h) ──
 *   사람만        속도 변동 3.09 (0–36 km/h 완전 stop-and-go)
 *   + FS 1대      0.15  (−95%)
 *   + FS 2대      0.06  (−98%)
 *
 * 주의 — 차두시간만 줄인 IDM 은 조밀한 링에서 파동을 감쇠시키지 **못한다**.
 * 링의 파동 감쇠는 `FollowerStopper`(아래)가, 플래툰의 스트링 안정성은 `avControlled` 가 담당한다.
 */
export const PRESETS: Record<'human' | 'accCommercial' | 'avControlled' | 'avBase', IDMParams> = {
  human: {
    v0: 30,
    T: 1.5,
    s0: 2.0,
    aMax: 1.0,
    b: 1.5,
    delta: 4,
    reaction: 0.8,
    noise: 0.35,
  },
  accCommercial: {
    v0: 30,
    T: 1.7,
    s0: 2.5,
    // 가속·감속이 모두 소극적이다. 지연과 겹치면 교란이 증폭된다.
    aMax: 0.8,
    b: 1.1,
    delta: 4,
    // 센서·액추에이터 지연. 스트링 불안정성을 만드는 실제 원인.
    reaction: 0.75,
    noise: 0,
  },
  avControlled: {
    v0: 30,
    T: 1.1,
    s0: 2.0,
    aMax: 2.0,
    b: 2.8,
    delta: 4,
    reaction: 0,
    noise: 0,
  },
  avBase: {
    v0: 30,
    T: 1.2,
    s0: 2.0,
    aMax: 1.4,
    b: 2.0,
    delta: 4,
    reaction: 0,
    noise: 0,
  },
};

export interface Vehicle {
  id: number;
  /** 경로를 따라간 거리 (m). 링 도로에서는 둘레로 wrap 된다. */
  x: number;
  /** 속도 (m/s) */
  v: number;
  /** 직전 스텝의 가속도 (m/s²) — 렌더러가 제동등에 쓴다 */
  a: number;
  /** 차량 길이 (m) */
  length: number;
  lane: number;
  kind: VehicleKind;
  params: IDMParams;
  /**
   * 지정되면 이 차량은 IDM 대신 FollowerStopper 로 주행한다 — 즉 파동을 감쇠시키는
   * 제어 AV 가 된다. 앞차가 없을 때는 `params` 의 IDM 으로 자유주행한다.
   */
  fs?: FollowerStopperParams;
  /** 직전 스텝의 지령 속도 (m/s). 렌더러의 HUD 표기용. */
  vCmd?: number;
  /** 반응 지연 구현용 가속도 링 버퍼. 외부에서 건드리지 말 것. */
  _delay: number[];
}

/** 결정론적 난수 (mulberry32). 시드가 같으면 항상 같은 그림이 나온다. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeVehicle(
  id: number,
  x: number,
  v: number,
  kind: VehicleKind,
  params: IDMParams,
  lane = 0,
  length = 4.6,
  fs?: FollowerStopperParams,
): Vehicle {
  return { id, x, v, a: 0, length, lane, kind, params, fs, _delay: [] };
}

/**
 * IDM 가속도. 앞차가 없으면 자유주행(희망 속도로 수렴)한다.
 *
 * @param gap  앞차와의 순간격 (m). 음수면 충돌 상태로 보고 강하게 제동.
 * @param dv   접근 속도 v − v_앞차 (m/s)
 */
export function idmAccel(p: IDMParams, v: number, gap: number | null, dv: number): number {
  const free = 1 - Math.pow(Math.max(v, 0) / p.v0, p.delta);
  if (gap === null) return p.aMax * free;

  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const s = Math.max(gap, 0.1); // 0 나누기 방지
  return p.aMax * (free - Math.pow(sStar / s, 2));
}


/* ------------------------------------------------------------------ *
 * FollowerStopper — 파동을 감쇠시키는 제어기
 *
 * Stern et al. (2018), "Dissipation of stop-and-go waves via control of
 * autonomous vehicles: Field experiments." 링 도로에서 단 한 대의 제어 차량이
 * 전체 흐름의 stop-and-go 파동을 없앨 수 있음을 실험으로 보였다.
 * (Raphael Stern 은 이 연구실 PI 의 박사후과정 지도교수다.)
 *
 * 핵심 발상은 "앞차를 바짝 따라가기"의 정반대다. 제어 차량은 목표 속도 U 를
 * 유지하려 하고, 간격이 좁아질 때만 앞차 속도로 부드럽게 내려앉는다.
 * 앞차의 속도 변동을 뒤로 전달하지 않으므로 파동이 이 차량에서 흡수된다.
 * ------------------------------------------------------------------ */

export interface FollowerStopperParams {
  /** 목표 속도 (m/s). 보통 구간 평균 속도로 잡는다. */
  U: number;
  /** 영역 경계 기준거리 (m) — Stern et al. 의 Δx₁⁰ · Δx₂⁰ · Δx₃⁰ */
  dx: [number, number, number];
  /** 경계 확장 계수 (m/s²) — Stern et al. 의 d₁ · d₂ · d₃ */
  d: [number, number, number];
  /** 지령 속도 추종 시정수 (s). 작을수록 지령을 빨리 따라간다. */
  tau: number;
}

export const FS_DEFAULT: FollowerStopperParams = {
  U: 20,
  dx: [4.5, 5.25, 6.0],
  d: [1.5, 1.0, 0.5],
  tau: 0.45,
};

/**
 * FollowerStopper 지령 속도.
 *
 * @param gap 앞차와의 순간격 (m)
 * @param dv  접근 속도 v − v_앞차 (m/s). 양수면 좁혀지는 중.
 */
export function followerStopperCmd(
  fs: FollowerStopperParams,
  v: number,
  vLead: number,
  gap: number,
  dv: number,
): number {
  // 좁혀지는 중일 때만 경계가 넓어진다 (Δv < 0 인 구간에서만 제곱항이 산다).
  const closing = Math.max(dv, 0);
  const q = closing * closing;
  const x1 = fs.dx[0] + q / (2 * fs.d[0]);
  const x2 = fs.dx[1] + q / (2 * fs.d[1]);
  const x3 = fs.dx[2] + q / (2 * fs.d[2]);

  const vSafe = Math.min(Math.max(vLead, 0), fs.U);

  if (gap <= x1) return 0;
  if (gap <= x2) return (vSafe * (gap - x1)) / Math.max(x2 - x1, 1e-6);
  if (gap <= x3) return vSafe + ((fs.U - vSafe) * (gap - x2)) / Math.max(x3 - x2, 1e-6);
  return fs.U;
}

/** 지령 속도를 가속도로 바꾼다. 차량의 물리 한계로 클램프된다. */
export function followerStopperAccel(
  fs: FollowerStopperParams,
  p: IDMParams,
  v: number,
  vLead: number,
  gap: number,
  dv: number,
): { a: number; vCmd: number } {
  const vCmd = followerStopperCmd(fs, v, vLead, gap, dv);
  const a = Math.max(-p.b * 2, Math.min((vCmd - v) / fs.tau, p.aMax));
  return { a, vCmd };
}

/** 링 도로 둘레를 고려한 앞차까지의 순간격. */
function ringGap(me: Vehicle, lead: Vehicle, circumference: number): number {
  let d = lead.x - me.x;
  if (d < 0) d += circumference;
  return d - lead.length;
}

export interface StepOptions {
  /** 링 도로 둘레 (m). 지정하면 순환 경계, 없으면 직선 도로. */
  circumference?: number;
  /** 특정 차량의 가속도를 덮어쓴다 — 교란 주입(선두 급제동)에 쓴다. */
  override?: (veh: Vehicle, index: number) => number | undefined;
  rng?: () => number;
}

/**
 * 한 스텝 전진. `vehicles` 는 **x 오름차순으로 정렬되어 있어야 한다**
 * (링 도로에서는 i+1 번째가 i 번째의 앞차, 마지막의 앞차는 0번).
 *
 * 배열을 제자리에서 수정한다 — 프레임마다 객체를 새로 만들면 GC 가 튄다.
 */
export function step(vehicles: Vehicle[], dt: number, opts: StepOptions = {}): void {
  const { circumference, override, rng } = opts;
  const n = vehicles.length;
  if (n === 0) return;

  // 1단계: 모든 가속도를 먼저 계산한다.
  //        차량을 하나씩 갱신하면 뒤차가 앞차의 '갱신된' 상태를 보게 되어
  //        물리적으로 불가능한 즉각 반응이 생긴다.
  const accels = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const me = vehicles[i]!;
    const p = me.params;

    const forced = override?.(me, i);
    if (forced !== undefined) {
      accels[i] = forced;
      continue;
    }

    let lead: Vehicle | null = null;
    if (circumference !== undefined) {
      lead = vehicles[(i + 1) % n]!;
      if (lead === me) lead = null; // 차량이 1대뿐
    } else if (i + 1 < n) {
      lead = vehicles[i + 1]!;
    }

    let gap: number | null = null;
    let dv = 0;
    if (lead) {
      gap =
        circumference !== undefined ? ringGap(me, lead, circumference) : lead.x - me.x - lead.length;
      dv = me.v - lead.v;
    }

    let a: number;
    if (me.fs && lead && gap !== null) {
      // 제어 AV — 앞차를 쫓지 않고 목표 속도를 지킨다. 파동이 여기서 흡수된다.
      const out = followerStopperAccel(me.fs, p, me.v, lead.v, gap, dv);
      a = out.a;
      me.vCmd = out.vCmd;
    } else {
      a = idmAccel(p, me.v, gap, dv);
      me.vCmd = undefined;
    }

    if (p.noise > 0 && rng) a += (rng() - 0.5) * 2 * p.noise;

    accels[i] = a;
  }

  // 2단계: 반응 지연을 적용하고 상태를 전진시킨다.
  for (let i = 0; i < n; i++) {
    const me = vehicles[i]!;
    const p = me.params;

    let a = accels[i]!;

    // 반응 지연 — 방금 계산한 가속도를 큐에 넣고, 지연만큼 지난 값을 꺼내 쓴다.
    const steps = Math.round(p.reaction / dt);
    if (steps > 0) {
      me._delay.push(a);
      a = me._delay.length > steps ? me._delay.shift()! : 0;
    } else if (me._delay.length) {
      me._delay.length = 0;
    }

    // 물리적 한계로 클램프 — 잡음이나 지연 때문에 말도 안 되는 값이 나올 수 있다.
    a = Math.max(-8, Math.min(a, p.aMax * 1.5));

    me.a = a;

    // 반암시적 오일러. 속도는 0 밑으로 내려가지 않는다(후진 금지).
    const vNext = Math.max(0, me.v + a * dt);
    me.x += ((me.v + vNext) / 2) * dt;
    me.v = vNext;

    if (circumference !== undefined) {
      me.x %= circumference;
      if (me.x < 0) me.x += circumference;
    }
  }

  // 링 도로에서는 wrap 때문에 정렬이 깨질 수 있다. 추월은 없으므로
  // 순서는 그대로 두고 배열을 회전시키기만 하면 된다.
  if (circumference !== undefined) rotateToOrigin(vehicles, circumference);
}

/** wrap 된 차량을 배열 앞으로 돌려 x 오름차순을 회복한다. */
function rotateToOrigin(vehicles: Vehicle[], circumference: number): void {
  const n = vehicles.length;
  if (n < 2) return;

  // 앞차의 x 가 뒤차보다 작아지는 지점(= 0 을 넘어간 경계)을 찾는다.
  let breaks = 0;
  let at = 0;
  for (let i = 0; i < n; i++) {
    if (vehicles[(i + 1) % n]!.x < vehicles[i]!.x) {
      breaks++;
      at = (i + 1) % n;
    }
  }
  // 정상 상태에서는 경계가 정확히 1개다. 그 외에는 손대지 않는다.
  if (breaks === 1 && at !== 0) {
    const head = vehicles.splice(0, at);
    vehicles.push(...head);
  }
  void circumference;
}

/** 링 도로에 등간격으로 차량을 배치한다. */
export function seedRing(
  count: number,
  circumference: number,
  pick: (i: number) => { kind: VehicleKind; params: IDMParams; fs?: FollowerStopperParams },
  v0 = 22,
  rng?: () => number,
): Vehicle[] {
  const spacing = circumference / count;
  return Array.from({ length: count }, (_, i) => {
    const { kind, params, fs } = pick(i);
    // 아주 약한 초기 교란 — 완벽한 등간격은 불안정성이 드러나는 데 오래 걸린다.
    const jitter = rng ? (rng() - 0.5) * spacing * 0.06 : 0;
    return makeVehicle(i, i * spacing + jitter, v0, kind, params, 0, 4.6, fs);
  });
}

/** 직선 도로에 플래툰을 배치한다. index 0 이 맨 뒤, 마지막이 선두. */
export function seedPlatoon(
  count: number,
  headway: number,
  pick: (i: number) => { kind: VehicleKind; params: IDMParams; fs?: FollowerStopperParams },
  v0 = 25,
): Vehicle[] {
  return Array.from({ length: count }, (_, i) => {
    const { kind, params, fs } = pick(i);
    return makeVehicle(i, i * headway, v0, kind, params, 0, 4.6, fs);
  });
}

/** 속도 표준편차 — 스트링 불안정성이 커지는지 줄어드는지 보여주는 지표. */
export function speedSpread(vehicles: Vehicle[]): number {
  const n = vehicles.length;
  if (n === 0) return 0;
  const mean = vehicles.reduce((s, v) => s + v.v, 0) / n;
  const varSum = vehicles.reduce((s, v) => s + (v.v - mean) ** 2, 0);
  return Math.sqrt(varSum / n);
}

export const KMH = (ms: number): number => ms * 3.6;
