import { href, pick, type Lang } from '../i18n';
import { NAV, UI } from '../i18n/ui';
import { SITE } from '../data/site';
import s from './Footer.module.css';

export interface FooterProps {
  lang: Lang;
}

/**
 * 페이지를 닫는 줄. 정적 컴포넌트 — `client:` 지시어 없이 HTML 로만 렌더된다.
 *
 * 예전 푸터는 3열짜리 사이트맵이었다(워드마크 + 확장명 + 모집 문안 + 연락처 +
 * 주소 + 메뉴 + 저작권). **홈에서 그 전부가 바로 위 닫는 구역의 복사본**이었다 —
 * 같은 모집 문장이 한 화면 안에 두 번 나왔고, 주소도 두 번 나왔다.
 *
 * 그래서 역할을 갈랐다:
 *   · 모집 문안은 **홈의 닫는 구역과 구성원 페이지**가 맡는다. 푸터에서 뺐다.
 *   · 연락처·주소는 푸터가 맡는다 — 홈 말고 다섯 페이지에는 그 정보가 여기뿐이다.
 *   · **홈에서는 연락 블록이 통째로 접힌다**(`html[data-page='home']`, Footer.module.css).
 *     바로 위 `.join` 이 같은 주소와 메일을 이미 더 크게 보여 주기 때문이다.
 *     Footer 는 `lang` 말고 아무것도 받지 않으므로, 이 판단은 레이아웃을 고치지
 *     않고 `<html data-page>` 를 CSS 가 읽어서 한다.
 *
 * 메뉴를 남긴 이유: 모서리 색인(`CornerIndex`)은 **내려갈 때 비킨다.** 페이지
 * 바닥에 도착한 사람은 방금 내려온 사람이라 색인이 화면에 없다 — 여기서 다음
 * 곳으로 갈 수 있어야 한다. 열로 쌓지 않고 색인과 같은 **한 줄**로 둔다.
 */
export default function Footer({ lang }: FooterProps) {
  const c = SITE.contact;
  const items = NAV.filter((n) => n.key);

  return (
    <footer className={s.footer} data-quiet>
      <div className={s.inner}>
        <div className={s.reach}>
          <p className={s.mark}>{SITE.short}</p>
          <p className={s.expand}>{pick(SITE.expansion, lang)}</p>

          <address className={s.where} lang={lang}>
            {pick(c.address, lang)}
            <span className={s.lines}>
              <a className={s.mailto} href={`mailto:${c.email}`}>
                {c.email}
              </a>
              <a className={s.mailto} href={`tel:${c.office.replace(/-/g, '')}`}>
                {c.office}
              </a>
            </span>
          </address>
        </div>

        <div className={s.base}>
          <nav className={s.links} aria-label={pick(UI.menu, lang)}>
            {items.map((n) => (
              <a key={n.key} href={href(n.key, lang)}>
                {pick(n.label, lang)}
              </a>
            ))}
          </nav>

          <p className={s.colophon}>
            <span>
              © {new Date().getFullYear()} {pick(SITE.name, lang)}
            </span>
            <span className={s.dot} aria-hidden="true">
              ·
            </span>
            <span>{pick(SITE.university, lang)}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
