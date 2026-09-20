/**
 * 시공도(time–space diagram)의 **자**.
 *
 * 캔버스에는 글자를 쓰지 않는다(하드 룰: `<canvas>` 는 aria-hidden 이고, 읽는 값은
 * HTML 이 맡는다). 그래서 눈금 숫자와 축 제목은 캔버스 **위에 절대 배치된 HTML** 이다.
 * 그 둘이 어긋나지 않으려면 그림을 그리는 쪽(`useTrafficSim`)과 라벨을 놓는 쪽
 * (`TrafficSim.tsx` + CSS)이 **같은 좌표**를 읽어야 한다 — 이 파일이 그 하나의 출처다.
 *
 * 훅은 `plotRect()` 로 플롯 영역을 잡아 거기에 축과 궤적을 그리고, 같은 값을
 * `--plot-x0…--plot-y1` 로 캔버스의 부모(`<figure>`)에 쓴다. CSS 는 그 변수로
 * 눈금 라벨을 `calc()` 에 얹는다. 프레임마다 쓰지 않는다 — 크기가 바뀔 때만이다.
 */
import { RING } from './scenarios';
import type { SimScenario } from '../data/research';

/**
 * 플롯 여백(CSS px) — 눈금 숫자와 축 제목이 앉는 자리다.
 * 왼쪽 50 = 세로 제목(13) + 숫자 `−600`(26) + 사이 여백. 아래 38 = 숫자 한 줄 + 제목 한 줄.
 */
export const PLOT_MARGIN = { left: 50, right: 10, top: 8, bottom: 38 } as const;

/** 장면(평면도)이 도표에게 내주지 않는 몫. */
export const SCENE = {
  /** 01 넓을 때 — 링 인셋이 가로로 차지하는 몫 */
  ringWide: 0.34,
  /** 01 좁을 때 — 링 인셋이 세로로 차지하는 몫 */
  ringStack: 0.44,
  /** 02 — 차로 평면도 띠가 세로로 차지하는 몫 */
  road: 0.3,
} as const;

/** 장면과 도표를 **가로로** 나란히 놓을 수 있는 최소 캔버스 폭(CSS px). */
export const WIDE_MIN = 520;
/** 좁은 캔버스에서 장면 아래에 도표를 **세로로** 쌓을 수 있는 최소 높이. */
export const STACK_MIN_H = 230;
/** 02 의 평면도 띠와 도표가 같이 설 수 있는 최소 높이. */
export const PLOT_MIN_H = 150;

export interface Axis {
  min: number;
  max: number;
  /** 눈금 값. 개수가 고정이라 라벨 요소도 고정이다 — 프레임마다 DOM 을 건드리지 않는다. */
  ticks: number[];
}

/**
 * 시나리오별 축. 없는 시나리오(03·04)는 도표가 없다 — 축 마크업도 붙지 않는다.
 *
 * 02 의 세로축이 **선두차 기준 상대 위치**인 이유: 이 대열은 순항하지 않는다.
 * 프리셋의 희망속도가 30 m/s 라 선두가 계속 가속해(실측 54 → 107 km/h) 한 주기에
 * `x − v₀t` 가 650 m 넘게 떠내려간다. 고정 속도 좌표계로는 꺾임이 전부 화면 밖으로
 * 밀려난다. 선두를 기준으로 잡으면 12줄이 거의 수평으로 놓이고, **줄 사이의 세로
 * 간격이 곧 차간거리**라 제동파가 뒤로 가며 간격이 벌어지는 것이 그대로 보인다.
 *
 * 가로축이 주기(45 s) 전체가 아니라 30 s 인 것도 실측 때문이다 — 증폭률은 사람·상용
 * ACC 에서 t+26 s 에 확정되고, 그 뒤 15 s 는 선두가 자유가속하며 대열이 늘어나기만
 * 한다(후미가 선두 뒤 830 m 까지 처진다). 실험은 앞의 30 s 다.
 */
export const AXIS: Partial<Record<SimScenario, { x: Axis; y: Axis }>> = {
  shockwave: {
    x: { min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60] },
    y: { min: 0, max: RING.length, ticks: [0, 100, 200, 300, 400] },
  },
  platoon: {
    x: { min: 0, max: 30, ticks: [0, 10, 20, 30] },
    y: { min: -600, max: 0, ticks: [-600, -400, -200, 0] },
  },
};

/** 눈금 값이 축에서 차지하는 자리(0…1). CSS 가 `calc()` 에 곱한다. */
export const frac = (v: number, a: Axis): number => (v - a.min) / (a.max - a.min);

export interface PlotRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 캔버스 안에서 도표가 앉는 사각형(CSS px). 도표가 없으면 null.
 *
 * 01 은 캔버스가 넓으면 링 인셋 오른쪽에, 좁고 높으면 링 인셋 아래에 앉는다.
 * 좁고 낮으면(홈 패널 176px) 도표를 포기하고 장면만 그린다 — 80px 안에 60초 × 400 m
 * 를 넣으면 궤적이 아니라 얼룩이 된다.
 */
export function plotRect(scenario: SimScenario, W: number, H: number): PlotRect | null {
  const m = PLOT_MARGIN;
  if (scenario === 'shockwave') {
    if (W >= WIDE_MIN) {
      return {
        x0: Math.round(W * SCENE.ringWide) + m.left,
        y0: m.top,
        x1: W - m.right,
        y1: H - m.bottom,
      };
    }
    if (H >= STACK_MIN_H) {
      return {
        x0: m.left,
        y0: Math.round(H * SCENE.ringStack) + m.top,
        x1: W - m.right,
        y1: H - m.bottom,
      };
    }
    return null;
  }
  if (scenario === 'platoon') {
    if (H < PLOT_MIN_H) return null;
    return {
      x0: m.left,
      y0: Math.round(H * SCENE.road) + m.top,
      x1: W - m.right,
      y1: H - m.bottom,
    };
  }
  return null;
}
