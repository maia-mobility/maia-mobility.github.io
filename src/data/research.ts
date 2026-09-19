import type { I18nText } from '../i18n/types';

/** TrafficSim 훅이 구동할 시나리오 키. 분야마다 다른 거동을 보여준다. */
export type SimScenario = 'platoon' | 'shockwave' | 'dispatch' | 'v2v';

export interface ResearchArea {
  id: string;
  /**
   * 화면에 찍히는 번호. **배열 순서와 같아야 한다** — 순서를 바꾸면 여기도 바꾼다.
   * 배경 도로의 연출(`usePointCloud` 의 `ACT_MIX`·`ACT_PLATOON`…)과 카메라 표
   * (`ACT_CAM`)도 이 배열과 같은 순서다. 세 곳을 함께 고쳐야 한다.
   */
  index: string;
  title: I18nText;
  /** 이 분야를 대표하는 키워드 — 모노 칩으로 렌더. 설명문을 대신한다. */
  keywords: string[];
  scenario: SimScenario;
}

/**
 * NOTE 1 — 기존 Wix 사이트에도 4개 분야의 **제목만** 있었고, 교수님 요청에 따라
 * 설명문은 두지 않는다. 각 분야는 `scenario` 가 지정하는 **실제 IDM 교통 시뮬레이션**과
 * 키워드 칩으로 표현된다. (설명문이 필요해지면 여기에 필드를 추가하면 된다.)
 *
 * NOTE 2 — 기존 사이트의 분야별 이미지 4장은 DALL-E 생성 스톡 이미지(빛나는 파란 링,
 * wifi 아이콘, 깨진 글자)라서 쓰지 않는다. `_archive/wix-images/` 에 보관만 해 뒀다.
 */
export const RESEARCH: ResearchArea[] = [
  {
    id: 'mixed-traffic',
    index: '01',
    title: {
      en: 'Mixed Traffic Control with AI',
      ko: 'AI 기반 혼합교통 제어',
    },
    keywords: ['Reinforcement Learning', 'Signal Control', 'Ramp Metering', 'Stop-and-go Waves'],
    scenario: 'shockwave',
  },
  {
    id: 'av-control',
    index: '02',
    title: {
      en: 'AV Control and Behavior',
      ko: '자율주행차 제어와 거동',
    },
    keywords: ['Adaptive Cruise Control', 'String Stability', 'Car-following', 'Vehicle Dynamics'],
    scenario: 'platoon',
  },
  {
    id: 'mobility-service',
    index: '03',
    title: {
      en: 'AV Mobility Service with AI',
      ko: 'AI 기반 자율주행 모빌리티 서비스',
    },
    keywords: ['Fleet Dispatch', 'Travel Time Estimation', 'Road Geometry', 'Service Design'],
    scenario: 'dispatch',
  },
  {
    id: 'cav-cda',
    index: '04',
    title: {
      en: 'CAV and CDA',
      ko: '협력 자율주행 (CAV·CDA)',
    },
    keywords: ['V2V / V2I', 'Cooperative Merging', 'Platooning', 'Connected Vehicles'],
    scenario: 'v2v',
  },
];

/**
 * 시뮬레이션 화면에 얹히는 범례.
 *
 * `readout` 은 **이 계측기가 지금 무엇을 보여주는지** 한 문장으로 적는다.
 * 연구 설명문이 아니다(연구분야에 설명문을 두지 않는다: 교수님 결정) — 화면에서
 * 실제로 벌어지는 일을 가리키는 캡션이고, 그래서 연구 페이지에만 붙는다.
 *
 * 한때 `AV PENETRATION → WAVE DAMPING` 같은 **"A → B" 공식**을 전부 대문자로
 * 세워 두었다. 네 개가 같은 꼴이라 계측기가 아니라 슬라이드 제목으로 읽혔고,
 * "너무 AI 스럽다"는 말을 들은 자리 가운데 하나다. 문장 케이스·자간 0·마침표 없음.
 *
 * `axis` 는 토글 묶음의 이름이다(그 묶음의 `aria-label` 이기도 하다).
 * 토글이 없는 시나리오에는 두지 않는다 — 가리킬 것이 없는 라벨은 라벨이 아니다.
 */
export const SIM_LEGEND: Record<SimScenario, { readout: I18nText; axis?: I18nText }> = {
  platoon: {
    readout: {
      en: 'The lead car brakes and the disturbance travels back through the platoon, growing or fading with the driver model',
      ko: '선두 차가 제동하면 그 교란이 대열을 거슬러 전해지고, 주행 모델에 따라 커지거나 잦아든다',
    },
    axis: { en: 'Driver model', ko: '주행 모델' },
  },
  shockwave: {
    readout: {
      en: 'A stop-and-go wave on a ring, and what a few automated vehicles do to it',
      ko: '링 도로를 도는 정체 파동과, 자율주행차 몇 대가 그것을 잦아들게 하는 과정',
    },
    axis: { en: 'Automated vehicles', ko: '자율주행차 대수' },
  },
  dispatch: {
    readout: {
      en: 'Requests appear across a grid of streets and the nearest idle vehicle drives over to pick them up',
      ko: '격자 도로망에 호출이 뜨면 가장 가까운 유휴 차량이 그 자리로 태우러 간다',
    },
  },
  v2v: {
    readout: {
      en: 'Two vehicles open a link once they are within range, and use it to make room for a merge',
      ko: '통신 범위에 든 두 차가 링크를 맺고, 그 링크로 합류할 자리를 내준다',
    },
  },
};

/*
 * 홈 연구 무대에 배경 도로의 실시간 계측판(`ACT_READOUT`)을 두었던 적이 있다.
 * 같은 화면의 시뮬레이션(검증된 12대·54km/h)과 배경 도로(장면인 6대·12km/h)가
 * **같은 이름의 값을 서로 다른 수로** 내놓아, 읽는 사람이 둘을 맞춰 보려 했다.
 * 계측은 시뮬레이션 한 곳에서만 한다. 되살리지 말 것.
 */
