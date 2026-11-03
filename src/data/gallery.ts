import type { I18nText } from '../i18n/types';

export interface GalleryPhoto {
  id: string;
  /** `public/` 기준 경로 — 쓸 때 `asset()` 을 거친다(DotPortrait 가 한다). */
  src: string;
  width: number;
  height: number;
  alt: I18nText;
  caption: I18nText;
}

export interface GalleryEvent {
  title: I18nText;
  photos: GalleryPhoto[];
}

/** 소식 페이지 맨 아래의 현장 사진. 새 행사는 배열 맨 앞에 추가. */
export const GALLERY: GalleryEvent[] = [
  {
    title: {
      en: 'ITS World Congress 2026 · Gangneung',
      ko: '2026 강릉 ITS 세계총회',
    },
    photos: [
      {
        id: 'its_panel',
        src: '/images/its/panel.jpg',
        width: 4,
        height: 3,
        alt: {
          en: 'Panel discussion in Room 310 at the ITS World Congress 2026 in Gangneung',
          ko: '2026 강릉 ITS 세계총회 310호 패널 토론',
        },
        caption: { en: 'Panel discussion', ko: '패널 토론' },
      },
      {
        id: 'its_poster',
        src: '/images/its/poster.jpg',
        width: 3,
        height: 4,
        alt: {
          en: 'A MAIA Lab member presenting a poster at the ITS World Congress 2026',
          ko: 'ITS 세계총회에서 포스터를 발표하는 MAIA 연구실 구성원',
        },
        caption: { en: 'Poster presentation', ko: '포스터 발표' },
      },
      {
        id: 'its_team',
        src: '/images/its/team.jpg',
        width: 3,
        height: 4,
        alt: {
          en: 'MAIA Lab members in front of the ITS World Congress 2026 Gangneung sign',
          ko: '2026 강릉 ITS 세계총회 표지판 앞의 MAIA 연구실 구성원',
        },
        caption: { en: 'MAIA Lab at the congress', ko: '연구실 구성원' },
      },
    ],
  },
];
