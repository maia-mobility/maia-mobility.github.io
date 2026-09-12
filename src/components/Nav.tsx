import { href, pick, routeKey, type Lang } from '../i18n';
import { NAV, UI } from '../i18n/ui';
import { SITE } from '../data/site';
import LangToggle from './LangToggle';
import s from './Nav.module.css';

export interface NavProps {
  lang: Lang;
  pathname: string;
}

/**
 * 사이트 내비게이션.
 *
 * **정적 컴포넌트다** — `client:` 지시어를 붙이지 마라. 모바일 메뉴 개폐는
 * `Page.astro` 의 인라인 바닐라 스크립트(약 20줄)가 `data-nav-*` 속성을 보고 처리한다.
 * 토글 하나 때문에 React 런타임 213KB 를 전 페이지에 실어 보낼 이유가 없다.
 *
 * 모바일에서는 전체화면 HUD 오버레이로 열린다. 햄버거 아이콘 대신 `▤ MENU` 텍스트 —
 * 하드 룰 7(둥근 SVG 아이콘 금지)에 맞춘 선택이다.
 */
export default function Nav({ lang, pathname }: NavProps) {
  const here = routeKey(pathname);
  const panelId = 'nav-panel';

  return (
    <header className={s.header}>
      <div className={s.bar}>
        <a className={s.brand} href={href('', lang)}>
          <span className={s.brandShort}>{SITE.short}</span>
          <span className={s.brandExpand}>{pick(SITE.expansion, lang)}</span>
        </a>

        <nav className={s.desktop} aria-label={pick(UI.menu, lang)}>
          <ul className={s.list}>
            {NAV.map((item) => {
              const current = item.key === here;
              return (
                <li key={item.key}>
                  <a
                    href={href(item.key, lang)}
                    className={current ? s.linkCurrent : s.link}
                    aria-current={current ? 'page' : undefined}
                  >
                    <span className={s.linkLabel}>{pick(item.label, lang)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={s.tail}>
          <LangToggle lang={lang} pathname={pathname} className={s.lang} />
          <button
            type="button"
            className={s.menuBtn}
            aria-expanded="false"
            aria-controls={panelId}
            data-nav-toggle
            data-label-open={pick(UI.menu, lang)}
            data-label-close={pick(UI.close, lang)}
          >
            <span aria-hidden="true" data-nav-glyph>
              ▤
            </span>
            <span className={s.menuLabel} data-nav-label>
              {pick(UI.menu, lang)}
            </span>
          </button>
        </div>
      </div>

      <div id={panelId} className={s.panel} data-nav-panel hidden>
        <ul className={s.panelList}>
          {NAV.map((item) => {
            const current = item.key === here;
            return (
              <li key={item.key} className={s.panelItem}>
                <a
                  href={href(item.key, lang)}
                  className={current ? s.panelLinkCurrent : s.panelLink}
                  aria-current={current ? 'page' : undefined}
                >
                  <span>{pick(item.label, lang)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </header>
  );
}
