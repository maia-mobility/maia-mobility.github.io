import { useEffect, useRef, type RefObject } from 'react';

export interface Canvas2DView {
  ctx: CanvasRenderingContext2D | null;
  /** CSS 픽셀 기준 논리 크기. 그릴 때는 이 값을 쓴다. */
  width: number;
  height: number;
  dpr: number;
}

export interface Canvas2DOptions {
  /** DPR 상한. 3x 레티나에서 픽셀 수가 9배가 되는 것을 막는다. */
  maxDpr?: number;
  alpha?: boolean;
  /** 크기가 바뀔 때마다 호출 — 씬을 다시 만들어야 하는 경우에 쓴다. */
  onResize?: (view: Canvas2DView) => void;
}

/**
 * `<canvas>` 의 DPR 스케일링과 리사이즈를 처리하고, 그리기에 필요한 것을 ref 로 돌려준다.
 *
 * state 를 쓰지 않는다 — 리사이즈가 리렌더를 유발하지 않으므로 rAF 루프가 끊기지 않는다.
 * 컨텍스트에는 이미 `scale(dpr, dpr)` 이 걸려 있으니 콜백에서는 CSS 픽셀 좌표로만 그리면 된다.
 */
export function useCanvas2D(
  ref: RefObject<HTMLCanvasElement | null>,
  { maxDpr = 2, alpha = true, onResize }: Canvas2DOptions = {},
): RefObject<Canvas2DView> {
  const view = useRef<Canvas2DView>({ ctx: null, width: 0, height: 0, dpr: 1 });

  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha });
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      const pw = Math.round(width * dpr);
      const ph = Math.round(height * dpr);

      // 같은 크기면 건드리지 않는다 — 버퍼 재할당은 비싸고 화면이 한 번 깜빡인다.
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }

      // 버퍼 크기를 바꾸면 변환이 초기화되므로 매번 다시 건다.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      view.current = { ctx, width, height, dpr };
      onResizeRef.current?.(view.current);
    };

    resize();

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      view.current = { ctx: null, width: 0, height: 0, dpr: 1 };
    };
  }, [ref, maxDpr, alpha]);

  return view;
}
