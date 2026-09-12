import { useRef, useState } from 'react';
import { useTrafficSim, type PlatoonMode, type TrafficMetrics } from '../hooks/useTrafficSim';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import HudFrame from './HudFrame';
import { SIM_LEGEND, type SimScenario } from '../data/research';
import { DISPATCH, PLATOON, RING, V2V } from '../lib/scenarios';
import { pick, type Lang } from '../i18n';
import s from './TrafficSim.module.css';

/**
 * TrafficSim — 연구분야 옆에 붙는 실제 IDM 교통 시뮬레이션.
 *
 * 물리는 `src/lib/idm.ts`, 설정은 `src/lib/scenarios.ts`, 렌더링은 `useTrafficSim`.
 * 이 컴포넌트는 `<canvas ref>` 와 HUD 마크업, 그리고 토글만 갖는다.
 *
 * 계측값은 React state 를 거치지 않는다 — 훅이 프레임 안에서 `onMetrics` 로 넘겨주면
 * ref 로 잡아 둔 `<span>` 에 textContent 로 직접 찍는다. 리렌더 0회.
 * state 는 시나리오 토글(모드·AV 대수)에만 쓴다.
 */

export interface TrafficSimProps {
  scenario: SimScenario;
  lang: Lang;
  /**
   * 홈 덱용 간결 모드. 구성 표기(`12 VEH · LEAD BRAKE …`)와 축 라벨을 감춘다 —
   * 연구 페이지에서는 설정을 밝히는 것이 계측의 예의지만, 홈에서는 한 화면에
   * 네 분야가 차례로 오므로 그 줄들이 먼저 눈에 띈다.
   */
  compact?: boolean;
}

interface Readout {
  key: string;
  /** 계측 라벨 — 장비가 찍는 문자열이라 로케일 무관(히어로 HUD 와 같은 규칙). */
  label: string;
  unit?: string;
  /**
   * 사이클(또는 측정 창) 전체를 모아야 뜻이 생기는 값.
   * 확정 전에는 흐리게 찍어 옆의 실시간 값과 구분한다.
   */
  provisional?: boolean;
}

const READOUTS: Record<SimScenario, Readout[]> = {
  platoon: [
    { key: 'amp', label: 'Amplification', unit: '×' },
    { key: 'lead', label: 'Lead drop', unit: 'km/h' },
    { key: 'rear', label: 'Rear drop', unit: 'km/h', provisional: true },
    { key: 'spread', label: 'Spread', unit: 'm/s' },
  ],
  shockwave: [
    { key: 'spread', label: 'Speed spread', unit: 'm/s' },
    { key: 'reduction', label: 'Vs 0 AV', unit: '%', provisional: true },
    { key: 'band', label: 'Speed band', unit: 'km/h' },
    { key: 'av', label: 'AV share' },
  ],
  dispatch: [
    { key: 'assigned', label: 'Dispatched' },
    { key: 'served', label: 'Trips served' },
    { key: 'wait', label: 'Mean wait', unit: 's' },
    { key: 'mean', label: 'Fleet speed', unit: 'km/h' },
  ],
  v2v: [
    { key: 'links', label: 'Active links' },
    { key: 'merges', label: 'Merges' },
    { key: 'range', label: 'Link range', unit: 'm' },
    { key: 'mean', label: 'Mean speed', unit: 'km/h' },
  ],
};

const MODES: { key: PlatoonMode; label: string }[] = [
  { key: 'human', label: PLATOON.modes.human.label },
  { key: 'acc', label: PLATOON.modes.acc.label },
  { key: 'controlled', label: PLATOON.modes.controlled.label },
];

const AV_COUNTS = Array.from({ length: RING.avMax + 1 }, (_, i) => i);

/** 읽힌 값이 없다는 표기. */
const NO_READ = '—';

/** NaN 은 계측 전이라는 뜻이다 — 0 으로 속이지 않는다. */
const num = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : NO_READ);

/** 상태 표시등. 둥근 점이 아니라 사각 틱이다(하드 룰 1·7). */
const ANNUNCIATOR = '▪';

/** 기준값 대비 증감률. 0 에는 부호를 붙이지 않는다(−0% 같은 표기를 막는다). */
const signed = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  const n = Math.round(v);
  return n === 0 ? '0' : `${n > 0 ? '\u2212' : '+'}${Math.abs(n)}`;
};

export default function TrafficSim({ scenario, lang, compact = false }: TrafficSimProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cells = useRef<Record<string, HTMLSpanElement | null>>({});
  const hudRef = useRef<HTMLDListElement>(null);
  const stateRef = useRef<HTMLParagraphElement>(null);
  const stateTextRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [mode, setMode] = useState<PlatoonMode>(PLATOON.defaultMode);
  const [avCount, setAvCount] = useState<number>(RING.defaultAV);

  const put = (key: string, text: string): void => {
    const el = cells.current[key];
    if (el && el.textContent !== text) el.textContent = text;
  };

  /**
   * 측정 상태를 찍는다. `data-state` 는 CSS 가 읽어 확정 전의 값을 흐리게 만든다.
   * 여기도 textContent 직접 쓰기다 — rAF 안에서 setState 하지 않는다.
   */
  const putState = (settled: boolean, text: string): void => {
    const state = settled ? 'settled' : 'measuring';
    const dl = hudRef.current;
    if (dl && dl.dataset.state !== state) dl.dataset.state = state;
    const el = stateRef.current;
    if (el && el.dataset.state !== state) el.dataset.state = state;
    const txt = stateTextRef.current;
    if (txt && txt.textContent !== text) txt.textContent = text;
  };

  const onMetrics = (m: TrafficMetrics): void => {
    if (m.scenario === 'platoon') {
      // 확정 전에는 증폭률 자리를 비운다. 과도구간의 값은 아직 교란이 후미에
      // 닿지 않아서 작을 뿐인데, 그대로 찍으면 사람이 제어AV 보다 나아 보인다.
      put('amp', m.settled ? num(m.amp, 2) : NO_READ);
      put('lead', num(m.leadDropKmh));
      put('rear', num(m.rearDropKmh));
      put('spread', num(m.spread, 2));
      putState(
        m.settled,
        m.settled
          ? `SETTLED AT T+${Math.round(m.settledAtS)} s`
          : `MEASURING · WAVE AT VEH ${m.waveVeh}/${PLATOON.count}` +
              (Number.isFinite(m.lastAmp) ? ` · LAST CYCLE ${m.lastAmp.toFixed(2)}×` : ''),
      );
    } else if (m.scenario === 'shockwave') {
      put('spread', num(m.spread, 2));
      put('reduction', signed(m.reductionPct));
      put('band', `${Math.round(m.minKmh)}–${Math.round(m.maxKmh)}`);
      put('av', `${m.avCount}/${RING.count}`);
      putState(
        m.settled,
        m.settled
          ? `SETTLED AT T+${Math.round(m.settledAtS)} s`
          : `SETTLING · 2-LAP WINDOW ${Math.round(Math.min(m.t, m.windowS))}/${Math.round(m.windowS)} s`,
      );
    } else if (m.scenario === 'dispatch') {
      put('assigned', `${m.assigned}/${DISPATCH.count}`);
      put('served', String(m.served));
      put('wait', num(m.meanWaitS));
      put('mean', num(m.meanKmh, 0));
    } else {
      put('links', String(m.links));
      put('merges', String(m.merges));
      put('range', String(V2V.range));
      put('mean', num(m.meanKmh, 0));
    }
  };

  useTrafficSim(canvasRef, {
    scenario,
    mode,
    avCount,
    target: wrapRef,
    reducedMotion,
    onMetrics,
  });

  const legend = SIM_LEGEND[scenario];
  const axis = pick(legend.axis, lang);

  const setup =
    scenario === 'platoon'
      ? `${PLATOON.count} VEH · LEAD BRAKE ${String(PLATOON.perturb.accel).replace('-', '\u2212')} m/s² × ${PLATOON.perturb.duration} s · CYCLE ${PLATOON.cycle} s`
      : scenario === 'shockwave'
        ? `${RING.count} VEH · RING ${RING.length} m · FOLLOWERSTOPPER AV × ${avCount}`
        : scenario === 'dispatch'
          ? `${DISPATCH.count} VEH · ${DISPATCH.cols}×${DISPATCH.rows} GRID · ${DISPATCH.length} m NETWORK`
          : `${V2V.count} VEH · LINK RANGE ${V2V.range} m · MERGE AT ${V2V.mergeAt} m`;

  return (
    <div ref={wrapRef} className={s.wrap}>
      <HudFrame
        edges={['top', 'left']}
        ticks
        label={`SIM · ${scenario.toUpperCase()}`}
        className={[s.frame, compact ? s.compact : ''].filter(Boolean).join(' ')}
      >
        <div className={s.head}>
          <p className={s.readout}>{pick(legend.readout, lang)}</p>

          {scenario === 'platoon' || scenario === 'shockwave' ? (
            <div className={s.controls} role="group" aria-label={axis}>
              {compact ? null : (
                <span className={s.axis} aria-hidden="true">
                  {axis}
                </span>
              )}
              {scenario === 'platoon'
                ? MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={s.ctrl}
                      aria-pressed={mode === m.key}
                      onClick={() => setMode(m.key)}
                    >
                      <span className={s.caret} aria-hidden="true">
                        ▸
                      </span>
                      {m.label}
                    </button>
                  ))
                : AV_COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={s.ctrl}
                      aria-pressed={avCount === n}
                      aria-label={`${n} AV`}
                      onClick={() => setAvCount(n)}
                    >
                      <span className={s.caret} aria-hidden="true">
                        ▸
                      </span>
                      {`AV ${n}`}
                    </button>
                  ))}
            </div>
          ) : compact ? null : (
            <p className={s.axis}>{axis}</p>
          )}
        </div>

        <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />

        {/* 모드·AV 대수를 바꾸면 측정이 처음부터 다시 시작한다. key 를 갈아 끼워
            수치판을 통째로 새로 마운트하면 이전 측정의 숫자가 한 프레임도 남지 않는다. */}
        <div className={s.readings} key={`${scenario}:${mode}:${avCount}`}>
          <dl className={s.hud} ref={hudRef} data-sim={scenario} data-state="measuring">
          {READOUTS[scenario].map((r, i) => (
            <div
              key={r.key}
              className={[s.cell, i === 0 ? s.cellLead : '', r.provisional ? s.provisional : '']
                .filter(Boolean)
                .join(' ')}
            >
              <dt className={s.cellLabel}>{r.label}</dt>
              <dd className={s.cellValue}>
                <span
                  className={s.figure}
                  ref={(el) => {
                    cells.current[r.key] = el;
                  }}
                >
                  —
                </span>
                {r.unit ? (
                  <span className={s.unit} aria-hidden="true">
                    {r.unit}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
          </dl>

          {/* 측정 상태 — 확정 전의 숫자를 확정값으로 읽지 않게 하는 표시등.
              03·04 는 확정을 기다리는 결론값이 없어 이 줄이 없다. */}
          {scenario === 'platoon' || scenario === 'shockwave' ? (
            <p className={s.state} ref={stateRef} data-state="measuring">
              <span className={s.tick} aria-hidden="true">
                {ANNUNCIATOR}
              </span>
              <span ref={stateTextRef}>MEASURING</span>
            </p>
          ) : null}
        </div>

        {compact ? null : <p className={s.setup}>{setup}</p>}
      </HudFrame>
    </div>
  );
}
