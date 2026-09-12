import type { I18nText } from '../i18n/types';

export const SITE = {
  /** 약칭. 로고·히어로에 쓰인다. */
  short: 'MAIA',

  /**
   * 브라우저 UI(주소창)에 쓰이는 배경색. `global.css` 의 `--bg` 와 같은 값이어야 한다.
   * `<meta name="theme-color">` 는 `var()` 를 받지 못해서 값이 한 군데는 있어야 한다 —
   * 그 유일한 자리가 여기다. 하드 룰 8(색상 하드코딩 금지)의 명시적 예외.
   */
  themeColor: '#08090B',

  name: {
    en: 'MAIA Lab',
    ko: 'MAIA 연구실',
  } satisfies I18nText,

  /** 풀네임 — 기존 사이트 표기 그대로. */
  expansion: {
    en: 'Mobility, AI & Autonomous System',
    ko: 'Mobility, AI & Autonomous System',
  } satisfies I18nText,

  tagline: {
    en: 'Engineering the Future of Intelligent Urban Mobility',
    ko: '지능형 도시 모빌리티의 미래를 설계합니다',
  } satisfies I18nText,

  /** 히어로 한 줄. */
  hero: {
    en: 'We develop data-driven, AI-powered, and autonomous mobility systems to create safer, more stable, and more efficient transportation networks.',
    ko: '데이터 기반·AI·자율주행 모빌리티 시스템을 개발해 더 안전하고, 더 안정적이며, 더 효율적인 교통 네트워크를 만듭니다.',
  } satisfies I18nText,

  mission: {
    en: 'At MAIA Lab, we aim to advance intelligent mobility systems through artificial intelligence, autonomous technologies, and transportation system dynamics. We focus on understanding and improving how autonomous vehicles interact within urban environments — enhancing traffic stability, safety, and system-level performance.',
    ko: 'MAIA 연구실은 인공지능, 자율주행 기술, 교통 시스템 동역학을 통해 지능형 모빌리티 시스템을 발전시키는 것을 목표로 합니다. 자율주행차가 도시 환경 속에서 어떻게 상호작용하는지를 이해하고 개선함으로써 교통 흐름의 안정성, 안전성, 그리고 시스템 전체의 성능을 높이는 데 집중합니다.',
  } satisfies I18nText,

  recruiting: {
    en: 'We are continuously recruiting graduate/undergraduate students who are interested in building the MAIA Lab together. If you are interested, please feel free to contact us at the email address below.',
    ko: 'MAIA 연구실을 함께 만들어갈 대학원생 및 학부연구생을 상시 모집하고 있습니다. 아래의 메일로 연락주시기 바랍니다.',
  } satisfies I18nText,

  affiliation: {
    en: 'Smart Mobility Engineering Major, Division of Smart Infrastructure Engineering, Myongji University',
    ko: '명지대학교 스마트인프라공학부 스마트모빌리티공학전공',
  } satisfies I18nText,

  university: {
    en: 'Myongji University',
    ko: '명지대학교',
  } satisfies I18nText,

  /*
   * 공개 페이지에 싣는 연락처는 **기관 연락처만** 둔다.
   * 기존 Wix 사이트에는 개인 휴대번호가 푸터에 박혀 있었고 그대로 옮겨 왔었는데,
   * 정적 사이트는 통째로 긁히기 때문에 한 번 공개되면 되돌릴 수 없다. 뺐다.
   * 다시 넣지 말 것 — 개인 연락은 메일로 받는다.
   */
  contact: {
    email: 'yupeace@mju.ac.kr',
    office: '031-330-6500',
    room: {
      en: 'Y5322, 5th Engineering Building',
      ko: '5공학관 5322호',
    } satisfies I18nText,
    address: {
      en: 'Y5322, 116, Myongji-ro, Cheoin-gu, Yongin-si, Gyeonggi-do, 17058, Republic of Korea',
      ko: '(17058) 경기도 용인시 처인구 명지로 116 명지대학교 5공학관 5322호',
    } satisfies I18nText,
    /** 캠퍼스 미니 포인트클라우드 지도의 중심 좌표 (명지대 자연캠퍼스 5공학관). */
    geo: { lat: 37.2226, lng: 127.1877 },
  },
};
