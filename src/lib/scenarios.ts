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
  length: 520,
  count: 10,
  lanes: 2,
  v0: 12,
  /**
   * 표시용 배속. 1.4 에서는 첫 운행 완료까지 25초가 걸려 방문자가 `TRIPS SERVED 0`
   * 만 보고 떠났다. 2.2 면 약 12초 안에 첫 완료가 찍힌다. 물리는 그대로다.
   */
  timeScale: 2.2,
  seed: 11,

  /** 수요 노드 개수. 차량이 배정되면 링크가 점멸한다. */
  nodes: 5,
  /** 새 수요가 발생하는 평균 간격(s). */
  demandInterval: 2.6,
  /**
   * 희망속도를 장면 속도(12 m/s = 43 km/h)로 눌러준다.
   * 프리셋의 30 m/s 를 그대로 쓰면 간격이 벌어졌을 때 108 km/h 까지 가속해
   * 도심 배차 장면과 맞지 않는 숫자가 HUD 에 찍힌다.
   */
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
