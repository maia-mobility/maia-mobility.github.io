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
 * ------------------------------------------------------------------ */

/** URL(또는 Astro.url.pathname)에서 현재 로케일을 판별. */
export function langFromPath(pathname: string): Lang {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  return (LANGS as readonly string[]).includes(seg) && seg !== DEFAULT_LANG
    ? (seg as Lang)
    : DEFAULT_LANG;
}

/**
 * 로케일이 붙은 절대 경로를 만든다.
 *   href('publications', 'ko') → '/ko/publications'
 *   href('', 'en')             → '/'
 */
export function href(path: string, lang: Lang): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const prefix = lang === DEFAULT_LANG ? '' : `/${lang}`;
  return clean ? `${prefix}/${clean}` : `${prefix}/`;
}

/** 현재 경로에서 로케일 접두사를 떼어낸 "라우트 키". hreflang·언어 토글에 쓴다. */
export function routeKey(pathname: string): string {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
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
