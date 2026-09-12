import { DEFAULT_LANG, LANGS, type I18nRich, type I18nText, type Lang } from './types';

export { DEFAULT_LANG, LANGS, mono } from './types';
export type { I18nRich, I18nText, Lang } from './types';

/* ------------------------------------------------------------------ *
 * 값 선택
 * ------------------------------------------------------------------ */

/** `t(lang)(text)` — 컴포넌트에서 한 번 바인딩해두고 반복 사용한다. */
export function t(lang: Lang) {
  return <T extends I18nText | I18nRich>(v: T): T['en'] => v[lang] as T['en'];
}

/** 단발성 선택. */
export const pick = <T extends I18nText | I18nRich>(v: T, lang: Lang): T['en'] =>
  v[lang] as T['en'];

/* ------------------------------------------------------------------ *
 * 라우팅
 *
 * prefixDefaultLocale: false 이므로
 *   en → `/publications`
 *   ko → `/ko/publications`
 *
 * **여기에 사이트가 놓인 하위 경로(base)가 앞에 붙는다.** 루트에 배포하면 base 가
 * `/` 라 아무것도 달라지지 않지만, GitHub Pages 의 프로젝트 저장소처럼
 * `https://계정.github.io/저장소/` 아래에 놓이면 base 가 `/저장소/` 가 된다.
 * 링크를 만들 때는 **붙이고**, 현재 주소를 읽을 때는 **떼어낸다** — 두 함수가
 * 짝이 맞지 않으면 언어 토글이 자기 자신을 가리키거나 404 로 간다.
 * ------------------------------------------------------------------ */

/** 사이트가 놓인 하위 경로. 항상 `/` 로 시작하고 `/` 로 끝난다. */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/*$/, '/');

/**
 * `public/` 자산과 base 를 붙인다 — `asset('/images/pi.jpg')`.
 * 하위 경로에 배포하면 `/images/...` 는 사이트 밖을 가리켜 404 가 된다.
 */
export const asset = (path: string): string => BASE + path.replace(/^\/+/, '');

/** 주소에서 base 를 떼어낸다. 로케일·라우트 키를 읽기 전에 반드시 한 번 거친다. */
const stripBase = (pathname: string): string =>
  BASE !== '/' && pathname.startsWith(BASE)
    ? '/' + pathname.slice(BASE.length)
    : BASE !== '/' && pathname === BASE.slice(0, -1)
      ? '/'
      : pathname;

/** URL(또는 Astro.url.pathname)에서 현재 로케일을 판별. */
export function langFromPath(pathname: string): Lang {
  const seg = stripBase(pathname).replace(/^\/+/, '').split('/')[0];
  return (LANGS as readonly string[]).includes(seg) && seg !== DEFAULT_LANG
    ? (seg as Lang)
    : DEFAULT_LANG;
}

/**
 * 로케일이 붙은 절대 경로를 만든다. base 가 앞에 붙는다.
 *   href('publications', 'ko') → '/ko/publications'      (base = '/')
 *                              → '/maia-lab/ko/publications'  (base = '/maia-lab/')
 *   href('', 'en')             → '/'
 */
export function href(path: string, lang: Lang): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const prefix = lang === DEFAULT_LANG ? '' : `${lang}/`;
  return BASE + prefix + clean;
}

/** 현재 경로에서 로케일 접두사를 떼어낸 "라우트 키". hreflang·언어 토글에 쓴다. */
export function routeKey(pathname: string): string {
  const parts = stripBase(pathname).replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] && (LANGS as readonly string[]).includes(parts[0]) && parts[0] !== DEFAULT_LANG) {
    parts.shift();
  }
  return parts.filter(Boolean).join('/');
}

/** 같은 페이지의 다른 로케일 주소. 언어 토글이 이걸 쓴다. */
export const altHref = (pathname: string, to: Lang): string => href(routeKey(pathname), to);

/** `<link rel="alternate" hreflang>` 목록. */
export function alternates(pathname: string): { lang: Lang; hreflang: string; path: string }[] {
  const key = routeKey(pathname);
  return [
    { lang: 'en' as Lang, hreflang: 'en-US', path: href(key, 'en') },
    { lang: 'ko' as Lang, hreflang: 'ko-KR', path: href(key, 'ko') },
  ];
}

/** `<html lang>` 속성값. */
export const htmlLang = (lang: Lang): string => (lang === 'ko' ? 'ko-KR' : 'en-US');
