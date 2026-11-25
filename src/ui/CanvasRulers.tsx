import { useCallback, useEffect, useRef } from 'react';
import { Ruler } from 'lucide-react';
import type { Point2D } from '../core/types';

export const RULER_SIZE = 20;

const RULER_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000,
];

function pickRulerStep(pxPerUnit: number): number {
  const safeScale = Math.max(1e-4, pxPerUnit);
  for (const step of RULER_STEPS) {
    if (step * safeScale >= 56) {
      return step;
    }
  }
  return RULER_STEPS[RULER_STEPS.length - 1];
}

function getSubdivisions(step: number): number {
  const leading = Number(String(step)[0]);
  if (leading === 2) return 4;
  return 5;
}

export interface CanvasRulersProps {
  viewToProject: (vx: number, vy: number) => Point2D | null;
  projectToView: (px: number, py: number) => Point2D | null;
  viewTick: number;
  cursorProjectPos: Point2D | null;
  showGuides: boolean;
  onToggleGuides: () => void;
  onPreviewGuide: (
    preview: { orientation: 'horizontal' | 'vertical'; position: number } | null
  ) => void;
  onCreateGuide: (orientation: 'horizontal' | 'vertical', position: number) => void;
}

export function CanvasRulers({
  viewToProject,
  projectToView,
  viewTick,
  cursorProjectPos,
  showGuides,
  onToggleGuides,
  onPreviewGuide,
  onCreateGuide,
}: CanvasRulersProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawRulers = useCallback(() => {
    const topCanvas = topCanvasRef.current;
    const leftCanvas = leftCanvasRef.current;
    const rootEl = rootRef.current;
    if (!topCanvas || !leftCanvas || !rootEl) return;

    const dpr = window.devicePixelRatio || 1;
    const style = getComputedStyle(document.documentElement);
    const panelBg = style.getPropertyValue('--color-paper-panel').trim() || '#f7f5f0';
    const borderColor = style.getPropertyValue('--color-paper-border').trim() || '#ded8ce';
    const mutedColor = style.getPropertyValue('--color-paper-muted').trim() || '#78716c';
    const accentColor = style.getPropertyValue('--color-paper-accent').trim() || '#da7756';

    // Top horizontal ruler (project X)
    {
      const rect = topCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = RULER_SIZE;
      if (topCanvas.width !== Math.round(w * dpr) || topCanvas.height !== Math.round(h * dpr)) {
        topCanvas.width = Math.round(w * dpr);
        topCanvas.height = Math.round(h * dpr);
      }
      const ctx = topCanvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = panelBg;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = borderColor;
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5);
        ctx.lineTo(w, h - 0.5);
        ctx.stroke();

        const pStart = viewToProject(RULER_SIZE, RULER_SIZE);
        const pEnd = viewToProject(RULER_SIZE + w, RULER_SIZE);
        if (pStart && pEnd && Math.abs(pEnd.x - pStart.x) > 1e-4) {
          const minWorldX = Math.min(pStart.x, pEnd.x);
          const maxWorldX = Math.max(pStart.x, pEnd.x);
          const pxPerUnit = w / (maxWorldX - minWorldX);
          const step = pickRulerStep(pxPerUnit);
          const subs = getSubdivisions(step);
          const minorStep = step / subs;

          const firstMinor = Math.floor(minWorldX / minorStep) * minorStep;
          ctx.font = '9px sans-serif';
          ctx.textBaseline = 'top';
          ctx.fillStyle = mutedColor;

          for (let wx = firstMinor; wx <= maxWorldX + minorStep; wx += minorStep) {
            const snappedMajor = Math.round(wx / step) * step;
            const isMajor = Math.abs(wx - snappedMajor) < minorStep * 0.15;
            const vp = projectToView(wx, pStart.y);
            if (!vp) continue;
            const rx = vp.x - RULER_SIZE;
            if (rx < -2 || rx > w + 2) continue;

            ctx.strokeStyle = isMajor ? mutedColor : borderColor;
            ctx.beginPath();
            ctx.moveTo(Math.round(rx) + 0.5, isMajor ? 5 : h - 5);
            ctx.lineTo(Math.round(rx) + 0.5, h);
            ctx.stroke();

            if (isMajor) {
              ctx.fillText(String(Math.round(snappedMajor)), rx + 3, 2);
            }
          }

          if (cursorProjectPos) {
            const cvp = projectToView(cursorProjectPos.x, cursorProjectPos.y);
            if (cvp) {
              const crx = cvp.x - RULER_SIZE;
              if (crx >= 0 && crx <= w) {
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(crx, 0);
                ctx.lineTo(crx, h);
                ctx.stroke();
              }
            }
          }
        }
        ctx.restore();
      }
    }

    // Left vertical ruler (project Y)
    {
      const rect = leftCanvas.getBoundingClientRect();
      const w = RULER_SIZE;
      const h = Math.max(1, Math.round(rect.height));
      if (leftCanvas.width !== Math.round(w * dpr) || leftCanvas.height !== Math.round(h * dpr)) {
        leftCanvas.width = Math.round(w * dpr);
        leftCanvas.height = Math.round(h * dpr);
      }
      const ctx = leftCanvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = panelBg;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = borderColor;
        ctx.beginPath();
        ctx.moveTo(w - 0.5, 0);
        ctx.lineTo(w - 0.5, h);
        ctx.stroke();

        const pStart = viewToProject(RULER_SIZE, RULER_SIZE);
        const pEnd = viewToProject(RULER_SIZE, RULER_SIZE + h);
        if (pStart && pEnd && Math.abs(pEnd.y - pStart.y) > 1e-4) {
          const minWorldY = Math.min(pStart.y, pEnd.y);
          const maxWorldY = Math.max(pStart.y, pEnd.y);
          const pxPerUnit = h / (maxWorldY - minWorldY);
          const step = pickRulerStep(pxPerUnit);
          const subs = getSubdivisions(step);
          const minorStep = step / subs;

          const firstMinor = Math.floor(minWorldY / minorStep) * minorStep;
          ctx.font = '9px sans-serif';
          ctx.textBaseline = 'top';
          ctx.fillStyle = mutedColor;

          for (let wy = firstMinor; wy <= maxWorldY + minorStep; wy += minorStep) {
            const snappedMajor = Math.round(wy / step) * step;
            const isMajor = Math.abs(wy - snappedMajor) < minorStep * 0.15;
            const vp = projectToView(pStart.x, wy);
            if (!vp) continue;
            const ry = vp.y - RULER_SIZE;
            if (ry < -2 || ry > h + 2) continue;

            ctx.strokeStyle = isMajor ? mutedColor : borderColor;
            ctx.beginPath();
            ctx.moveTo(isMajor ? 5 : w - 5, Math.round(ry) + 0.5);
            ctx.lineTo(w, Math.round(ry) + 0.5);
            ctx.stroke();

            if (isMajor) {
              ctx.save();
              ctx.translate(2, ry + 3);
              ctx.rotate(-Math.PI / 2);
              ctx.textAlign = 'right';
              ctx.fillText(String(Math.round(snappedMajor)), -2, 0);
              ctx.restore();
            }
          }

          if (cursorProjectPos) {
            const cvp = projectToView(cursorProjectPos.x, cursorProjectPos.y);
            if (cvp) {
              const cry = cvp.y - RULER_SIZE;
              if (cry >= 0 && cry <= h) {
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, cry);
                ctx.lineTo(w, cry);
                ctx.stroke();
              }
            }
          }
        }
        ctx.restore();
      }
    }
  }, [cursorProjectPos, projectToView, viewToProject]);

  useEffect(() => {
    drawRulers();
  }, [drawRulers, viewTick]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => drawRulers());
    ro.observe(root);
    return () => ro.disconnect();
  }, [drawRulers]);

  const startGuideDrag = (
    orientation: 'horizontal' | 'vertical',
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const computePos = (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;
      const pt = viewToProject(vx, vy);
      if (!pt) return null;
      const position = Math.round(orientation === 'vertical' ? pt.x : pt.y);
      const insideCanvas =
        orientation === 'vertical'
          ? vx >= RULER_SIZE && vx <= rect.width && vy >= 0 && vy <= rect.height
          : vy >= RULER_SIZE && vy <= rect.height && vx >= 0 && vx <= rect.width;
      return { position, insideCanvas };
    };

    const onMove = (ev: PointerEvent) => {
      const res = computePos(ev.clientX, ev.clientY);
      if (res) {
        onPreviewGuide({ orientation, position: res.position });
      }
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      onPreviewGuide(null);
      const res = computePos(ev.clientX, ev.clientY);
      if (res?.insideCanvas) {
        onCreateGuide(orientation, res.position);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10">
      <button
        type="button"
        onClick={onToggleGuides}
        title={showGuides ? 'Скрыть направляющие' : 'Показать направляющие'}
        aria-label={showGuides ? 'Скрыть направляющие' : 'Показать направляющие'}
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
        className={`pointer-events-auto absolute left-0 top-0 flex items-center justify-center border-b border-r border-paper-border bg-paper-panel transition-colors hover:bg-paper-hover ${
          showGuides ? 'text-paper-accent' : 'text-paper-muted'
        }`}
      >
        <Ruler className="h-3 w-3" strokeWidth={1.75} />
      </button>

      <canvas
        ref={topCanvasRef}
        onPointerDown={(e) => startGuideDrag('horizontal', e)}
        title="Потяните вниз для создания горизонтальной направляющей"
        style={{ left: RULER_SIZE, height: RULER_SIZE, width: `calc(100% - ${RULER_SIZE}px)` }}
        className="pointer-events-auto absolute top-0 cursor-ns-resize select-none"
      />

      <canvas
        ref={leftCanvasRef}
        onPointerDown={(e) => startGuideDrag('vertical', e)}
        title="Потяните вправо для создания вертикальной направляющей"
        style={{ top: RULER_SIZE, width: RULER_SIZE, height: `calc(100% - ${RULER_SIZE}px)` }}
        className="pointer-events-auto absolute left-0 cursor-ew-resize select-none"
      />
    </div>
  );
}
