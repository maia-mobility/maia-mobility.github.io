import { useRef } from 'react';
import { usePointCloud } from '../hooks/usePointCloud';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import s from './RoadCanvas.module.css';

/**
 * RoadCanvas — 도로만. 히어로 카피가 없다.
 *
 * `PointCloudHero` 는 캔버스 + 첫 화면 카피를 같이 갖고 있어서, 도로를 **모든
 * 페이지의 배경**으로 깔려면 카피까지 딸려온다. 이 컴포넌트는 캔버스만 떼어낸다.
 *
 * 훅이 `<html>` 에 써 넣는 `--h`·`--p`·`--v`·`--a0`…`--a3` 는 그대로 나가므로,
 * 이 캔버스를 깐 페이지는 배경 진행도를 CSS 로 읽을 수 있다.
 */
export default function RoadCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  usePointCloud(canvasRef, { target: canvasRef, reducedMotion });
  return <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />;
}
