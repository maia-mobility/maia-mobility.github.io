/**
 * 연구분야별 시뮬레이션 설정.
 *
 * 여기 있는 숫자는 전부 **실측으로 검증된 값**이다 (`src/lib/idm.ts` 상단 주석 참조).
 * 렌더러(`useTrafficSim`)는 이 설정을 읽기만 하고, 물리 파라미터를 새로 지어내지 않는다.
 * 값을 바꾸면 거동이 달라지므로, 바꿀 거면 다시 측정할 것.
 */
import { FS_DEFAULT, PRESETS, type FollowerStopperParams, type IDMParams } from './idm';
import type { SimScenario } from '../data/research';

/** 화면에 그릴 도로의 형태. */
export type Track = 'ring' | 'line' | 'network';

export interface ScenarioConfig {
  track: Track;
  /** 링 둘레 (m) 또는 직선 구간 길이 (m). */
  length: number;
  count: number;
  lanes: number;
  /** 초기 속도 (m/s). */
  v0: number;
  /** 시뮬레이션 배속 — 실시간이 너무 느리면 올린다. */
  timeScale: number;
  seed: number;
}

/* ------------------------------------------------------------------ *
 * 01 · AV Control and Behavior — 스트링 안정성
 *
 * 직선 플래툰 12대. 선두가 −2.5 m/s² 로 3초 감속한다.
 * 세 가지 모드를 전환하며 교란이 뒤로 갈수록 커지는지 작아지는지 보여준다.
 * ------------------------------------------------------------------ */
export const PLATOON = {
  track: 'line' as const,
  length: 600,
  count: 12,
  lanes: 1,
  v0: 15, // 54 km/h
  timeScale: 1,
  seed: 3,

  /**
   * 초기 차두거리 (m). IDM 정상상태 `s0 + v·T + 차량길이` 에서 유도한다.
   * 프리셋마다 T 가 다르므로 모드 전환 시 다시 계산해야 한다 —
   * 이 값으로 배치해야 검증표의 증폭률이 재현된다. 압축 배치하면 평형을 찾아가는
   * 과도응답이 증폭으로 잘못 측정된다.
   */
  headway: (p: IDMParams, v: number) => p.s0 + v * p.T + 4.6,

  /** 교란: t=4s 부터 3초간 선두가 감속. */
  perturb: { at: 4, duration: 3, accel: -2.5 },
  /** 주기적으로 반복 — 한 사이클이 끝나면 리셋한다. */
  cycle: 45,

  modes: {
    human: { label: 'HUMAN', params: PRESETS.human, amplification: 3.92 },
    acc: { label: 'COMMERCIAL ACC', params: PRESETS.accCommercial, amplification: 1.3 },
    controlled: { label: 'CONTROLLED AV', params: PRESETS.avControlled, amplification: 0.52 },
  } satisfies Record<string, { label: string; params: IDMParams; amplification: number }>,

  defaultMode: 'acc' as const,
} ;

/* ------------------------------------------------------------------ *
 * 02 · Mixed Traffic Control with AI — stop-and-go 파동 감쇠
 *
 * 링 도로. Sugiyama(2008) / Stern et al.(2018) 의 실험 구성 그대로다.
 * 사람만 있으면 정체 파동이 스스로 생기고, FollowerStopper AV 를 한두 대만
 * 섞으면 사라진다. 슬라이더로 AV 대수를 바꾸게 한다.
 * ------------------------------------------------------------------ */
export const RING = {
  track: 'ring' as const,
  length: 400, // 둘레 400 m — 평형 28 km/h
  count: 22,
  lanes: 1,
  v0: 7.7, // 평형 속도
  timeScale: 1.5,
  seed: 7,

  /** 파동이 자리잡기까지 걸리는 시간(s). 이 동안은 AV 를 넣지 않는다. */
  warmup: 90,

  /** AV 대수별 검증된 속도 변동(표준편차, m/s). HUD 에 표기해도 된다. */
  spreadByAV: { 0: 3.09, 1: 0.15, 2: 0.06 } as Record<number, number>,

  avMax: 3,
  defaultAV: 0,

  human: PRESETS.human,
  avBase: PRESETS.avBase,
  /** U(목표속도)는 런타임에 구간 평균으로 대체한다 — Stern et al. 방식. */
  fs: FS_DEFAULT satisfies FollowerStopperParams,
};

/* ------------------------------------------------------------------ *
 * 03 · AV Mobility Service — 배차
 * 04 · CAV and CDA — V2V 협조 합류
 *
 * 이 둘은 차량추종 물리가 주인공이 아니다(03은 배차 할당, 04는 통신 링크).
 * 차량 거동은 IDM 을 그대로 쓰되, 보여줄 것은 그 위에 얹히는 레이어다.
 * ------------------------------------------------------------------ */
export const DISPATCH = {
  track: 'network' as const,

  /* --- 도로망 -------------------------------------------------------
     교차로 4열 × 3행. **완전한 격자가 아니다** — 간선 두 개를 덜어낸다.
     자로 그은 격자는 도시가 아니라 모눈종이로 읽히고, 모든 경로의 길이가 같아
     "어디로 갈지 고른다"는 배차의 본질이 화면에서 사라진다. */
  cols: 6,
  rows: 3,
  /**
   * 교차로 간격(m). **도면의 가로세로비가 캔버스를 따라가야 한다** — 4×3 으로
   * 잡았더니 도면비 2.2 대 캔버스비 3.8 이라 좌우로 절반이 비었다. 6×3 이면 3.4 다.
   */
  spanX: 136,
  spanY: 84,
  /** 교차로를 흐트러뜨리는 폭(m). */
  jitter: 12,
  /** 격자에서 덜어낼 간선 — 노드 번호 쌍(행우선 색인). 연결은 유지된다. */
  cut: [
    [8, 14],
    [9, 10],
  ] as [number, number][],
  /** 도로 총연장(m) — 간선 25개의 근사 합. 표기용이다. */
  length: 2640,

  /**
   * 운행 차량 수. **수요보다 넉넉하면 안 된다** — 7대였을 때는 수요가 뜨는 즉시
   * 배차돼서 '기다리는 수요'가 화면에 한 번도 안 남았다. 기다리는 마커가 커지는
   * 것이 이 장면의 핵심이라 차를 조금 모자라게 둔다.
   */
  count: 7,
  /** 장면 속도(m/s) = 43 km/h. 프리셋의 30 m/s 를 도심 속도로 눌러 준다. */
  v0: 12,
  /**
   * 표시용 배속. 1.0 에서는 첫 운행 완료까지 20초가 넘게 걸려 방문자가
   * `TRIPS SERVED 0` 만 보고 떠난다. 물리는 그대로다.
   */
  timeScale: 2.8,
  seed: 11,

  /** 새 수요가 발생하는 평균 간격(s). */
  demandInterval: 2.6,
  /**
   * 동시에 살아 있을 수 있는 수요 수. **차량 수보다 하나 많게** 둔다 —
   * 같거나 적으면 뜨는 즉시 배차돼서 '기다리는 수요'가 화면에 안 남는다.
   */
  maxJobs: 8,
  /** 승하차 정차(s). */
  dwell: 1.1,
  /**
   * 운행 거리 범위(m). 아래가 없으면 한 블록짜리 운행이 뽑혀 배차로 안 보이고,
   * **위가 없으면 격자를 가로지르는 700m 운행이 뽑혀** 한 번 완료되는 데 1분이
   * 걸린다(실측). 그 사이 방문자는 `TRIPS SERVED 0` 만 보고 떠난다.
   */
  minTrip: 190,
  maxTrip: 430,

  params: { ...PRESETS.avControlled, v0: 12 } satisfies IDMParams,
};

export const V2V = {
  track: 'line' as const,
  length: 420,
  count: 9,
  lanes: 2, // 본선 + 합류로
  v0: 18,
  timeScale: 1,
  seed: 13,

  /** V2V 통신 반경 (m). 이 안에 들어온 차량끼리 링크가 그려진다. */
  range: 70,
  /** 합류 지점 (m). */
  mergeAt: 240,
  /** 희망속도를 장면 속도(18 m/s = 65 km/h)로 눌러준다. DISPATCH 주석 참조. */
  params: { ...PRESETS.avControlled, v0: 18 } satisfies IDMParams,
};

export const SCENARIOS = {
  platoon: PLATOON,
  shockwave: RING,
  dispatch: DISPATCH,
  v2v: V2V,
} satisfies Record<SimScenario, { track: Track; length: number; count: number; seed: number }>;
