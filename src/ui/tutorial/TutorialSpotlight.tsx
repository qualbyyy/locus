import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { useSettingsStore } from '../../core/settings';
import { formatShortcutCombo, getEffectiveShortcut } from '../../core/shortcuts';
import { TUTORIAL_STEP_BY_ID } from '../../tutorial/content';
import { useTutorialStore } from '../../tutorial/store';
import { TUTORIAL_TARGETS, type TutorialTargetDefinition } from '../../tutorial/targets';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  fallbackUsed: boolean;
}

function resolveTargetRect(targetId: keyof typeof TUTORIAL_TARGETS): SpotlightRect | null {
  const def = TUTORIAL_TARGETS[targetId];
  let el = document.querySelector(def.selector);
  let fallbackUsed = false;

  if (!el && def.panel === 'inspector') {
    el = document.querySelector(TUTORIAL_TARGETS['inspector.root'].selector);
    fallbackUsed = Boolean(el);
  }
  if (!el) return null;

  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    fallbackUsed,
  };
}

export function TutorialSpotlight({
  onEnsurePanel,
}: {
  onEnsurePanel: (panel: TutorialTargetDefinition['panel']) => void;
}) {
  const highlight = useTutorialStore((state) => state.highlight);
  const clearHighlight = useTutorialStore((state) => state.clearHighlight);
  const openAcademy = useTutorialStore((state) => state.openAcademy);
  const customShortcuts = useSettingsStore((state) => state.settings.customShortcuts);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!highlight) {
      setRect(null);
      return;
    }

    const def = TUTORIAL_TARGETS[highlight.targetId];
    onEnsurePanel(def.panel);

    const measure = () => {
      setRect(resolveTargetRect(highlight.targetId));
    };

    const raf = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [highlight, onEnsurePanel]);

  useEffect(() => {
    if (!highlight) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clearHighlight();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearHighlight, highlight]);

  if (!highlight) return null;

  const step = highlight.stepId ? TUTORIAL_STEP_BY_ID[highlight.stepId] : undefined;
  const combo = step?.shortcutActionId
    ? formatShortcutCombo(
        getEffectiveShortcut(step.shortcutActionId, customShortcuts)
      )
    : null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardWidth = 300;
  const cardLeft = rect
    ? Math.max(12, Math.min(vw - cardWidth - 12, rect.left))
    : Math.max(12, vw / 2 - cardWidth / 2);
  const placeAbove = rect ? rect.top + rect.height + 160 > vh && rect.top > 160 : false;
  const cardTop = rect
    ? placeAbove
      ? Math.max(12, rect.top - 148)
      : Math.min(vh - 150, rect.top + rect.height + 10)
    : 72;

  return (
    <div
      data-testid="tutorial-spotlight"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) clearHighlight();
      }}
      className="fixed inset-0 z-[70] bg-paper-ink/20"
    >
      {rect && (
        <div
          aria-hidden="true"
          style={{
            top: Math.max(0, rect.top - 4),
            left: Math.max(0, rect.left - 4),
            width: rect.width + 8,
            height: rect.height + 8,
          }}
          className="pointer-events-none fixed rounded border-2 border-paper-accent bg-paper-accent/10 shadow-[0_0_0_9999px_rgba(28,27,26,0.18)] transition-all duration-150"
        />
      )}

      <div
        role="dialog"
        aria-label="Подсказка обучения"
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
        className="animate-rise fixed z-[71] rounded border border-paper-border bg-paper-panel p-3 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Eye className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={1.75} />
            <span className="text-[12px] font-semibold text-paper-ink">
              {step?.title ?? 'Элемент интерфейса'}
            </span>
            {combo && (
              <kbd className="rounded border border-paper-border bg-paper-bg px-1.5 py-0.5 font-display text-[10px] text-paper-muted">
                {combo}
              </kbd>
            )}
          </div>
          <button
            type="button"
            onClick={clearHighlight}
            aria-label="Скрыть подсказку"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {step?.body && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-paper-muted">
            {step.body}
          </p>
        )}
        {rect?.fallbackUsed && (
          <p className="mt-1 text-[11px] text-paper-accent">
            Выдели подходящий слой на холсте, чтобы раскрыть этот блок инспектора.
          </p>
        )}

        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openAcademy()}
            className="h-6 rounded border border-paper-border bg-paper-bg px-2 text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            К уроку
          </button>
          <button
            type="button"
            onClick={clearHighlight}
            className="h-6 rounded bg-paper-accent px-2.5 text-[11px] font-medium text-white hover:bg-paper-accent-hover"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
