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
 * 시뮬레이션 화면에 얹히는 HUD 라벨.
 * 연구 설명문이 아니라 **지금 화면에서 무엇이 벌어지고 있는지** 알려주는 계측 표기다.
 */
export const SIM_LEGEND: Record<SimScenario, { readout: I18nText; axis: I18nText }> = {
  platoon: {
    readout: { en: 'LEAD BRAKE → UPSTREAM RESPONSE', ko: '선두 감속 → 후속 반응 전파' },
    axis: { en: 'HEADWAY', ko: '차간거리' },
  },
  shockwave: {
    readout: { en: 'AV PENETRATION → WAVE DAMPING', ko: '자율주행차 침투율 → 파동 감쇠' },
    axis: { en: 'AV SHARE', ko: '자율주행 비율' },
  },
  dispatch: {
    readout: { en: 'DEMAND NODE → VEHICLE ASSIGNMENT', ko: '수요 노드 → 차량 배차' },
    axis: { en: 'WAIT TIME', ko: '대기시간' },
  },
  v2v: {
    readout: { en: 'V2V LINK → COOPERATIVE MERGE', ko: 'V2V 링크 → 협조 합류' },
    axis: { en: 'LINK RANGE', ko: '통신 범위' },
  },
};

/*
 * 홈 연구 무대에 배경 도로의 실시간 계측판(`ACT_READOUT`)을 두었던 적이 있다.
 * 같은 화면의 시뮬레이션(검증된 12대·54km/h)과 배경 도로(장면인 6대·12km/h)가
 * **같은 이름의 값을 서로 다른 수로** 내놓아, 읽는 사람이 둘을 맞춰 보려 했다.
 * 계측은 시뮬레이션 한 곳에서만 한다. 되살리지 말 것.
 */
