import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import s from './HudFrame.module.css';

export type HudEdge = 'top' | 'right' | 'bottom' | 'left';
export type HudCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface HudFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children?: ReactNode;
  /** 1px 선을 그을 변. 기본은 전체 테두리가 아니라 상단+좌측 두 변이다. */
  edges?: HudEdge[];
  /** 코너 틱. true = 네 모서리, 배열 = 지정한 모서리만, false = 없음. */
  ticks?: boolean | HudCorner[];
  /** 프레임 상단 선에 걸터앉는 모노 캡션. */
  label?: string;
  /** 'hot'이면 테두리·틱·라벨이 --accent로 점등된 상태로 고정된다. */
  tone?: 'idle' | 'hot';
  /** hover/focus-within 시 --line → --accent 로 점등하는 변형. */
  interactive?: boolean;
  as?: ElementType;
  className?: string;
}

const EDGE_CLASS: Record<HudEdge, string> = {
  top: s.edgeTop,
  right: s.edgeRight,
  bottom: s.edgeBottom,
  left: s.edgeLeft,
};

const TICK_CLASS: Record<HudCorner, string> = {
  tl: s.tickTl,
  tr: s.tickTr,
  bl: s.tickBl,
  br: s.tickBr,
};

const ALL_CORNERS: HudCorner[] = ['tl', 'tr', 'bl', 'br'];

/**
 * HudFrame — 카드 대체 컨테이너. 정적 컴포넌트이므로 `client:` 지시어 없이
 * HTML로만 렌더된다 (JS 0KB). 상태·이펙트를 절대 들이지 말 것.
 */
export default function HudFrame({
  children,
  edges = ['top', 'left'],
  ticks = true,
  label,
  tone = 'idle',
  interactive = false,
  as,
  className,
  ...rest
}: HudFrameProps) {
  const Tag = (as ?? 'div') as ElementType;

  const corners: HudCorner[] = ticks === true ? ALL_CORNERS : ticks === false ? [] : ticks;

  const classes = [
    s.frame,
    ...edges.map((e) => EDGE_CLASS[e]),
    tone === 'hot' ? s.hot : '',
    interactive ? s.interactive : '',
    label ? s.hasLabel : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classes} {...rest}>
      {label ? <span className={s.label}>{label}</span> : null}
      {children}
      {corners.map((c) => (
        <span key={c} className={`${s.tick} ${TICK_CLASS[c]}`} aria-hidden="true" />
      ))}
    </Tag>
  );
}
