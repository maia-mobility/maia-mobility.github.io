import { altHref, LANGS, type Lang } from '../i18n';
import { LANG_LABEL } from '../i18n/ui';
import s from './LangToggle.module.css';

export interface LangToggleProps {
  lang: Lang;
  /** 현재 경로 — 같은 페이지의 다른 로케일로 이동한다. */
  pathname: string;
  className?: string;
}

/**
 * EN / KO 전환. 자바스크립트가 필요 없는 순수 링크 두 개다 —
 * 그래서 `client:` 지시어 없이 정적으로 렌더된다.
 */
export default function LangToggle({ lang, pathname, className }: LangToggleProps) {
  return (
    <nav
      className={[s.toggle, className ?? ''].filter(Boolean).join(' ')}
      aria-label={lang === 'ko' ? '언어 선택' : 'Language'}
    >
      {LANGS.map((l, i) => {
        const current = l === lang;
        return (
          <span key={l} className={s.item}>
            {i > 0 && (
              <span className={s.sep} aria-hidden="true">
                /
              </span>
            )}
            <a
              href={altHref(pathname, l)}
              hrefLang={l}
              className={current ? s.current : s.link}
              aria-current={current ? 'true' : undefined}
            >
              {LANG_LABEL[l]}
            </a>
          </span>
        );
      })}
    </nav>
  );
}
