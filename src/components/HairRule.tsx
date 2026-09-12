import type { CSSProperties } from 'react';
import s from './HairRule.module.css';

export interface HairRuleProps {
  /** 'scan' = 점선 스캔 라인(기본, 하드 룰 6) · 'solid' = 실선 헤어라인 */
  variant?: 'scan' | 'solid';
  /** 'hot'이면 --accent로 점등된다. */
  tone?: 'idle' | 'hot';
  /** 수직 계측선 */
  vertical?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** HairRule — 정적 구분자. 장식이므로 접근성 트리에서 제외한다. */
export default function HairRule({
  variant = 'scan',
  tone = 'idle',
  vertical = false,
  className,
  style,
}: HairRuleProps) {
  const classes = [
    s.rule,
    variant === 'solid' ? s.solid : s.scan,
    tone === 'hot' ? s.hot : '',
    vertical ? s.vertical : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <hr className={classes} style={style} aria-hidden="true" />;
}
