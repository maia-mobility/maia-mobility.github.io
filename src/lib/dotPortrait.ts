/**
 * 사진을 점군으로 분해했다가 다시 사진으로 "해상"시킨다.
 *
 * 물체 검출이 확정되는 순간의 은유다 — 화면에 들어오면 흩어진 점들이 제자리를 찾아가며
 * 얼굴이 드러난다. 사이트 전체가 쓰는 dot 언어를 사람 사진에도 적용한 것.
 *
 * **프레임워크 없이 작성한다.** People 페이지의 유일한 인터랙션이 이것뿐이라
 * React 런타임 213KB 를 싣는 것은 명백한 낭비다 (AGENTS.md "아일랜드 최소화").
 * Nav 의 모바일 메뉴와 같은 판단이다.
 */

export interface DotPortraitOptions {
  /** 점 격자 간격(px). 작을수록 촘촘하고 느리다. */
  cell?: number;
  /** 해상에 걸리는 시간(초). */
  duration?: number;
  /** 이 밝기를 넘으면 배경으로 보고 버린다 (스튜디오 흰 배경 제거). */
  bgLuma?: number;
  maxDpr?: number;
}

interface Dot {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** 미리 만들어 둔 색 문자열 — 프레임마다 템플릿 리터럴을 만들지 않는다 */
  rgb: string;
  delay: number;
  size: number;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * 캔버스 하나에 효과를 붙인다. 정리 함수를 돌려준다.
 *
 * `canvas` 의 `data-src` 로 이미지를 지정한다.
 */
export function mountDotPortrait(
  canvas: HTMLCanvasElement,
  { cell = 5, duration = 1.4, bgLuma = 226, maxDpr = 2 }: DotPortraitOptions = {},
): () => void {
  const ctx = canvas.getContext('2d', { alpha: true });
  const src = canvas.dataset.src;
  if (!ctx || !src) return () => {};

  const wrap = canvas.closest<HTMLElement>('[data-dot-wrap]');

  let dots: Dot[] = [];
  let ready = false;
  let progress = 0;
  let raf = 0;
  let running = false;
  let visible = false;
  let last = 0;
  let W = 0;
  let H = 0;

  const reduced =
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 캔버스 크기를 CSS 픽셀에 맞추고 DPR 스케일을 건다. */
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** 사진을 읽어 점 격자로 분해한다. */
  const build = (img: HTMLImageElement) => {
    if (W < 2 || H < 2) return;

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(W / cell));
    off.height = Math.max(1, Math.floor(H / cell));
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;

    // 비율 유지하며 꽉 채운다(cover)
    const ar = img.width / img.height;
    const tAr = off.width / off.height;
    let dw = off.width;
    let dh = off.height;
    let dx = 0;
    let dy = 0;
    if (ar > tAr) {
      dw = off.height * ar;
      dx = (off.width - dw) / 2;
    } else {
      dh = off.width / ar;
      dy = (off.height - dh) / 2;
    }
    octx.drawImage(img, dx, dy, dw, dh);

    const data = octx.getImageData(0, 0, off.width, off.height).data;
    const out: Dot[] = [];

    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const i = (y * off.width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;

        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // 흰 배경은 버린다 — 인물만 점으로 남는다.
        if (lum > bgLuma) continue;

        // 점은 사진의 원래 색을 그대로 쓴다 — 최종 사진도 컬러이므로
        // 해상이 끝나는 순간 색이 튀지 않는다.

        const tx = x * cell + cell / 2;
        const ty = y * cell + cell / 2;

        // 위쪽일수록 멀리서 모여든다 — 스캔이 위에서부터 수렴하는 느낌.
        const spread = 40 + (1 - y / off.height) * 90;
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * spread;

        out.push({
          tx,
          ty,
          sx: tx + Math.cos(ang) * dist,
          sy: ty + Math.sin(ang) * dist * 0.6,
          rgb: `${r},${g},${b}`,
          delay: Math.random() * 0.45,
          size: cell - 1,
        });
      }
    }

    dots = out;
    ready = true;
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    const p = progress;

    for (const d of dots) {
      const local = Math.max(0, Math.min(1, (p - d.delay) / (1 - d.delay || 1)));
      const e = easeOut(local);

      // 정사각 점 — arc() 금지 (하드 룰 1)
      ctx.fillStyle = `rgba(${d.rgb},${0.25 + 0.75 * e})`;
      ctx.fillRect(d.sx + (d.tx - d.sx) * e, d.sy + (d.ty - d.sy) * e, d.size, d.size);
    }
  };

  const frame = (now: number) => {
    if (!ready) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const t = now / 1000;
    if (last === 0) last = t;
    const dt = Math.min(t - last, 1 / 20);
    last = t;

    progress = Math.min(1, progress + dt / duration);
    draw();

    if (progress >= 1) {
      // 다 왔으면 멈춘다. 래퍼에 표시를 남겨 CSS 가 사진으로 넘겨받는다.
      running = false;
      wrap?.setAttribute('data-resolved', 'true');
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || progress >= 1) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  // ── 초기화 ──────────────────────────────────────────────
  resize();

  // 스크립트가 붙었다는 표시. CSS 는 이 플래그가 있을 때만 <img> 를 감춘다 —
  // JS 가 꺼져 있으면 사진이 그냥 보여야 하기 때문이다.
  wrap?.setAttribute('data-dot-active', 'true');

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    build(img);
    if (reduced) {
      // 동작 줄이기: 완성된 상태로 한 장만 그린다
      progress = 1;
      draw();
      wrap?.setAttribute('data-resolved', 'true');
      return;
    }
    if (visible) start();
  };
  img.src = src;

  let io: IntersectionObserver | undefined;
  if (!reduced && typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) {
          start();
          io?.disconnect(); // 한 번 해상되면 다시 흩어지지 않는다
        }
      },
      { rootMargin: '-10% 0px' },
    );
    io.observe(canvas);
  } else if (!reduced) {
    visible = true;
    start();
  }

  const onVisibility = () => {
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stop();
    io?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** 페이지 안의 모든 dot portrait 를 붙인다. */
export function mountAllDotPortraits(root: ParentNode = document): () => void {
  const cleanups = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-dot-portrait]')].map(
    (c) => mountDotPortrait(c),
  );
  return () => cleanups.forEach((fn) => fn());
}
