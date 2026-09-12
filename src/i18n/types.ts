/** 사이트 전역에서 쓰는 로케일. astro.config.mjs 의 i18n.locales 와 일치해야 한다. */
export type Lang = 'en' | 'ko';

export const LANGS = ['en', 'ko'] as const satisfies readonly Lang[];
export const DEFAULT_LANG: Lang = 'en';

/**
 * 2개 국어 문자열. 모든 콘텐츠 데이터의 기본 단위다.
 *
 * 논문 제목·저자처럼 번역하지 않는 값은 `mono()` 로 감싼다 — 그러면
 * 한 번만 쓰고도 양쪽 로케일에서 동일하게 나온다.
 */
export interface I18nText {
  en: string;
  ko: string;
}

/** 번역이 필요 없는 값(고유명사, 논문 서지정보 등)을 I18nText 로 승격. */
export const mono = (s: string): I18nText => ({ en: s, ko: s });

/** 리치 텍스트(문단 배열). 긴 설명문에 쓴다. */
export interface I18nRich {
  en: string[];
  ko: string[];
}
