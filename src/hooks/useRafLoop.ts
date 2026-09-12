import { useEffect, useRef, type RefObject } from 'react';

export type RafCallback = (
  /** 직전 프레임으로부터 경과 시간(초). `maxDelta` 로 상한이 걸려 있다. */
  dt: number,
  /** 루프 시작 이후 누적 시간(초). 일시정지 동안은 흐르지 않는다. */
  elapsed: number,
) => void;

export interface RafLoopOptions {
  /** 외부 게이트. false 면 루프가 돌지 않는다. */
  active?: boolean;
  /** 이 요소가 화면 밖이면 자동 정지. 히어로·시뮬 캔버스에 반드시 지정할 것. */
  target?: RefObject<Element | null>;
  rootMargin?: string;
  /** OS "동작 줄이기" 설정 시 콜백을 딱 한 번만 호출하고 멈춘다(정지 프레임). */
  reducedMotion?: boolean;
  /** 탭 복귀 시 거대한 dt 가 튀는 것을 막는다. 기본 1/20초. */
  maxDelta?: number;
  /** 프레임률 상한. 모바일에서 30 으로 낮춰 배터리를 아낀다. 0 이면 무제한. */
  fps?: number;
}

/**
 * 캔버스 애니메이션용 rAF 루프.
 *
 * 설계 규칙 — 이 훅은 **React state 를 일절 건드리지 않는다.** 콜백도 그래야 한다.
 * 프레임마다 setState 를 호출하면 렌더 폭풍이 나고, 이 사이트에서는 그것을 버그로 취급한다.
 * 콜백은 캔버스에 직접 그리기만 할 것.
 *
 * 다음 세 경우에 자동으로 멈춘다:
 *   1. `target` 이 뷰포트를 벗어남
 *   2. 탭이 백그라운드로 감 (`document.hidden`)
 *   3. `reducedMotion` 이 true — 이때는 정지 프레임 1장만 그린다
 */
export function useRafLoop(cb: RafCallback, opts: RafLoopOptions = {}): void {
  const {
    active = true,
    target,
    rootMargin = '200px',
    reducedMotion = false,
    maxDelta = 1 / 20,
    fps = 0,
  } = opts;

  // 콜백 identity 가 바뀌어도 루프를 재시작하지 않는다.
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (!active) return;

    // 동작 줄이기: 정지 프레임 한 장만 그리고 끝낸다.
    if (reducedMotion) {
      const id = requestAnimationFrame(() => cbRef.current(0, 0));
      return () => cancelAnimationFrame(id);
    }

    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let accum = 0;
    let visible = !target; // target 이 없으면 항상 보이는 것으로 취급
    let running = false;

    const minStep = fps > 0 ? 1 / fps : 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);

      const t = now / 1000;
      if (last === 0) last = t;
      let dt = t - last;
      last = t;

      if (dt > maxDelta) dt = maxDelta;

      // fps 상한: 누적해서 임계에 도달했을 때만 그린다.
      // EPS 가 없으면 60Hz 에서 2프레임(33.3ms)이 1/30초에 머리카락만큼 못 미쳐
      // 한 프레임을 통째로 더 건너뛴다 — fps:30 요청이 실측 20fps 가 된다.
      if (minStep > 0) {
        accum += dt;
        if (accum < minStep - 0.002) return;
        dt = accum;
        accum = 0;
      }

      elapsed += dt;
      cbRef.current(dt, elapsed);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0; // 재개 시 dt 가 튀지 않도록
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const sync = () => {
      if (visible && !document.hidden) start();
      else stop();
    };

    document.addEventListener('visibilitychange', sync);

    let io: IntersectionObserver | undefined;
    const el = target?.current;
    if (target) {
      if (el && typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver(
          ([entry]) => {
            visible = !!entry?.isIntersecting;
            sync();
          },
          { rootMargin },
        );
        io.observe(el);
      } else {
        // 관찰할 수 없으면 보이는 것으로 간주 — 안 도는 것보다 낫다.
        visible = true;
      }
    }

    sync();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [active, reducedMotion, target, rootMargin, maxDelta, fps]);
}
