import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { convertTextLayersToOutlines } from '../../core/commands';
import { mapLayerTree } from '../../core/layerTree';
import { pauseHistory, resumeHistory, useEditorStore } from '../../core/store';
import type { Layer, LayerEffects, Scene } from '../../core/types';
import {
  BlurEffectFields,
  ColorAdjustEffectFields,
  DistortEffectFields,
  Effect3DFields,
  type EffectFieldCallbacks,
  type EffectTarget,
  getEffectTitle,
  isVectorEffectKind,
  MotionBlurEffectFields,
  OuterGlowEffectFields,
  resolveEffectTargetPatch,
  ShadowEffectFields,
  WarpEffectFields,
} from './EffectControls';

export interface EffectModalProps {
  target: EffectTarget | null;
  layers: Layer[];
  onClose: () => void;
  onApply: (
    layerIds: string[],
    patch: Partial<LayerEffects>,
    target: EffectTarget
  ) => void;
}

interface PreviewSession {
  baseScene: Scene;
  baseDirty: boolean;
  documentSessionId: number;
  ids: string[];
  needsTextOutline: boolean;
}

function applyPreviewPatchToStore(ids: string[], patch: Partial<LayerEffects>): void {
  const idSet = new Set(ids);
  useEditorStore.setState((state) => ({
    scene: {
      ...state.scene,
      layers: mapLayerTree(state.scene.layers, (layer) => {
        if (!idSet.has(layer.id)) return layer;
        return { ...layer, effects: { ...(layer.effects ?? {}), ...patch } };
      }),
    },
    isDirty: true,
  }));
}

export function EffectModal({ target, layers, onClose, onApply }: EffectModalProps) {
  const [draftPatch, setDraftPatch] = useState<Partial<LayerEffects>>({});
  const sessionRef = useRef<PreviewSession | null>(null);
  const draftRef = useRef<Partial<LayerEffects>>({});

  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const hasPath = useMemo(() => layers.some((l) => l.type === 'path'), [layers]);
  const hasText = useMemo(() => layers.some((l) => l.type === 'text'), [layers]);

  const restoreSession = useCallback((): PreviewSession | null => {
    const active = sessionRef.current;
    if (!active) return null;
    sessionRef.current = null;
    if (useEditorStore.getState().documentSessionId === active.documentSessionId) {
      useEditorStore.setState({ scene: active.baseScene, isDirty: active.baseDirty });
    }
    resumeHistory();
    return active;
  }, []);

  useEffect(() => {
    if (!target || layerIds.length === 0) return;

    const state = useEditorStore.getState();
    pauseHistory();

    const needsTextOutline =
      isVectorEffectKind(target.kind) && !hasPath && hasText;
    const initialPatch = resolveEffectTargetPatch(target, layers[0]?.effects);

    sessionRef.current = {
      baseScene: state.scene,
      baseDirty: state.isDirty,
      documentSessionId: state.documentSessionId,
      ids: [...layerIds],
      needsTextOutline,
    };
    draftRef.current = initialPatch;
    setDraftPatch(initialPatch);

    if (!needsTextOutline) {
      applyPreviewPatchToStore(layerIds, initialPatch);
    }

    return () => {
      restoreSession();
    };
    // Инициализируем сессию только при открытии новой цели эффекта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const updatePatch = useCallback((patch: Partial<LayerEffects>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraftPatch(next);
    const active = sessionRef.current;
    if (active && !active.needsTextOutline) {
      applyPreviewPatchToStore(active.ids, next);
    }
  }, []);

  const handleCancel = useCallback(() => {
    restoreSession();
    onClose();
  }, [onClose, restoreSession]);

  const handleConfirm = useCallback(() => {
    if (!target) return;
    const finalPatch = draftRef.current;
    const session = restoreSession();
    const ids = session?.ids ?? layerIds;
    if (ids.length === 0) {
      onClose();
      return;
    }

    if (session?.needsTextOutline) {
      void convertTextLayersToOutlines(ids).then((converted) => {
        if (converted.length > 0) {
          onApply(
            converted.map((c) => c.id),
            finalPatch,
            target
          );
        }
      });
    } else {
      onApply(ids, finalPatch, target);
    }
    onClose();
  }, [layerIds, onApply, onClose, restoreSession, target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter' && !e.isComposing) {
        const el = e.target as HTMLElement | null;
        if (el?.closest('button, [role="listbox"], textarea')) return;
        e.preventDefault();
        e.stopPropagation();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleCancel, handleConfirm, target]);

  if (!target || layers.length === 0) return null;

  const callbacks: EffectFieldCallbacks = {
    onCommit: updatePatch,
    onBeginDrag: () => {},
    onLiveChange: updatePatch,
    onEndDrag: () => {},
  };

  const title = getEffectTitle(target);
  const needsTextOutlineNotice =
    isVectorEffectKind(target.kind) && !hasPath && hasText;
  const targetLabel =
    layers.length === 1
      ? `Слой: ${layers[0].name}`
      : `Выбрано слоёв: ${layers.length}`;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-ink/30 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise flex w-full max-w-sm flex-col overflow-hidden rounded-md border border-paper-border bg-paper-panel shadow-xl"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-paper-border px-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal
              className="h-3.5 w-3.5 shrink-0 text-paper-accent"
              strokeWidth={1.75}
            />
            <span className="truncate text-[13px] font-semibold text-paper-ink">
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            title="Отмена (Esc)"
            aria-label="Закрыть"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="text-[11px] text-paper-muted">{targetLabel}</div>

          {needsTextOutlineNotice && (
            <div className="rounded border border-paper-border bg-paper-bg px-2.5 py-1.5 text-[11px] text-paper-muted">
              Текстовый слой будет преобразован в кривые после нажатия «Применить».
            </div>
          )}

          {draftPatch.warp && (
            <WarpEffectFields warp={draftPatch.warp} callbacks={callbacks} />
          )}
          {draftPatch.distort && (
            <DistortEffectFields distort={draftPatch.distort} callbacks={callbacks} />
          )}
          {draftPatch.effect3d && (
            <Effect3DFields effect3d={draftPatch.effect3d} callbacks={callbacks} />
          )}
          {draftPatch.blur !== undefined && (
            <BlurEffectFields blur={draftPatch.blur} callbacks={callbacks} />
          )}
          {draftPatch.motionBlur && (
            <MotionBlurEffectFields
              motionBlur={draftPatch.motionBlur}
              callbacks={callbacks}
            />
          )}
          {draftPatch.dropShadow && (
            <ShadowEffectFields
              shadow={draftPatch.dropShadow}
              onCommit={(dropShadow) => updatePatch({ dropShadow })}
              onBeginDrag={() => {}}
              onLiveChange={(dropShadow) => updatePatch({ dropShadow })}
              onEndDrag={() => {}}
            />
          )}
          {draftPatch.innerShadow && (
            <ShadowEffectFields
              shadow={draftPatch.innerShadow}
              onCommit={(innerShadow) => updatePatch({ innerShadow })}
              onBeginDrag={() => {}}
              onLiveChange={(innerShadow) => updatePatch({ innerShadow })}
              onEndDrag={() => {}}
            />
          )}
          {draftPatch.outerGlow && (
            <OuterGlowEffectFields
              outerGlow={draftPatch.outerGlow}
              callbacks={callbacks}
            />
          )}
          {draftPatch.colorAdjust && (
            <ColorAdjustEffectFields
              colorAdjust={draftPatch.colorAdjust}
              callbacks={callbacks}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-paper-border bg-paper-bg/60 px-4 py-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="h-7 rounded border border-paper-border bg-paper-panel px-3 text-[12px] text-paper-ink hover:bg-paper-hover"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="h-7 rounded bg-paper-accent px-3.5 text-[12px] font-medium text-white hover:bg-paper-accent-hover"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
