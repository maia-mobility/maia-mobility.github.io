import type { MouseEventHandler, ReactNode } from 'react';
import s from './Button.module.css';

export interface ButtonProps {
  children?: ReactNode;
  /** 주어지면 <a>, 없으면 <button>으로 렌더된다. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  /** 'hot' = 이미 점등된 상태(primary CTA). */
  tone?: 'idle' | 'hot';
  size?: 'sm' | 'md';
  /** 폭 100% — 좁은 뷰포트에서 쓴다. */
  block?: boolean;
  disabled?: boolean;
  /** ▸ 캐럿 숨김 (아이콘 전용 버튼 등) */
  caret?: boolean;
  target?: string;
  rel?: string;
  lang?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

/**
 * Button — 정적 컴포넌트. `client:` 지시어 없이 HTML로만 렌더된다.
 * onClick은 이 컴포넌트를 품은 아일랜드가 하이드레이트될 때만 동작한다.
 */
export default function Button({
  children,
  href,
  type = 'button',
  tone = 'idle',
  size = 'md',
  block = false,
  disabled = false,
  caret = true,
  target,
  rel,
  lang,
  id,
  className,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = [
    s.btn,
    tone === 'hot' ? s.hot : '',
    size === 'sm' ? s.sm : '',
    block ? s.block : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      {caret ? (
        <span className={s.caret} aria-hidden="true">
        </span>
      ) : null}
      <span>{children}</span>
    </>
  );

  if (href !== undefined) {
    return (
      <a
        className={classes}
        href={disabled ? undefined : href}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
        aria-disabled={disabled || undefined}
        lang={lang}
        id={id}
        onClick={onClick}
        {...rest}
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      disabled={disabled}
      lang={lang}
      id={id}
      onClick={onClick}
      {...rest}
    >
      {inner}
    </button>
  );
}
