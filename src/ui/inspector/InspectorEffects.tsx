import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
import { convertTextLayersToOutlines } from '../../core/commands';
import { mapLayerTree } from '../../core/layerTree';
import { pauseHistory, resumeHistory, useEditorStore } from '../../core/store';
import type {
  ColorAdjustEffect,
  DistortEffect,
  DropShadowEffect,
  Effect3D,
  Layer,
  LayerEffects,
  MotionBlurEffect,
  OuterGlowEffect,
  Scene,
} from '../../core/types';
import { hasActiveColorAdjust, hasVectorEffects } from '../../engine/effects';
import {
  BlurEffectFields,
  ColorAdjustEffectFields,
  DEFAULT_EFFECT_PATCH,
  DistortEffectFields,
  Effect3DFields,
  type EffectFieldCallbacks,
  type EffectSectionId,
  type EffectTarget,
  effectKindToSection,
  isVectorEffectKind,
  MotionBlurEffectFields,
  OuterGlowEffectFields,
  resolveEffectTargetPatch,
  ShadowEffectFields,
  WarpEffectFields,
} from './EffectControls';

export type { EffectSectionId, EffectTarget };
export { DEFAULT_EFFECT_PATCH, effectKindToSection };

interface AddMenuItem {
  kind: EffectTarget['kind'];
  label: string;
  vectorOnly?: boolean;
}

const ADD_MENU_CATEGORIES: Array<{
  title: string;
  items: AddMenuItem[];
}> = [
  {
    title: 'Размытие',
    items: [
      { kind: 'blur', label: 'Размытие по Гауссу' },
      { kind: 'motionBlur', label: 'Размытие в движении (Motion)' },
    ],
  },
  {
    title: 'Свет и тень',
    items: [
      { kind: 'dropShadow', label: 'Падающая тень' },
      { kind: 'innerShadow', label: 'Внутренняя тень' },
      { kind: 'outerGlow', label: 'Внешнее свечение' },
    ],
  },
  {
    title: 'Деформация и форма',
    items: [
      { kind: 'warp', label: 'Деформация (Warp)', vectorOnly: true },
      { kind: 'zigzag', label: 'Зигзаг (Zig Zag)', vectorOnly: true },
      { kind: 'roughen', label: 'Загрубление (Roughen)', vectorOnly: true },
      { kind: 'roundCorners', label: 'Скругление углов', vectorOnly: true },
      { kind: 'puckerBloat', label: 'Втягивание и раздувание', vectorOnly: true },
    ],
  },
  {
    title: '3D и объём',
    items: [
      { kind: '3d-rotate', label: '3D Поворот', vectorOnly: true },
      { kind: '3d-extrude', label: '3D Выдавливание', vectorOnly: true },
    ],
  },
  {
    title: 'Цвет и фото',
    items: [{ kind: 'colorAdjust', label: 'Цветокоррекция' }],
  },
];

function EffectCard({
  title,
  badge,
  expanded,
  onToggle,
  onRemove,
  children,
}: {
  title: string;
  badge?: string;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-paper-border bg-paper-bg">
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-medium text-paper-ink hover:text-paper-accent"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-paper-muted" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-paper-muted" strokeWidth={1.75} />
          )}
          <span className="truncate">{title}</span>
          {badge && (
            <span className="ml-auto shrink-0 font-display text-[10px] font-normal text-paper-muted">
              {badge}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Удалить эффект"
          aria-label={`Удалить ${title}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:text-paper-danger"
        >
          <X className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-paper-border/70 px-2.5 py-2">
          {children}
        </div>
      )}
    </div>
  );
}

export interface InspectorEffectsProps {
  layers: Layer[];
  focusedEffect: EffectTarget | null;
  onConsumeFocus: () => void;
  onUpdateEffects: (layerIds: string[], patch: Partial<LayerEffects> | null) => void;
  onExpandAppearance?: (layerIds: string[]) => void;
}

export function InspectorEffects({
  layers,
  focusedEffect,
  onConsumeFocus,
  onUpdateEffects,
  onExpandAppearance,
}: InspectorEffectsProps) {
  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const primary = layers[0];
  const effects = primary?.effects;
  const hasPath = layers.some((l) => l.type === 'path');

  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Partial<Record<EffectSectionId, boolean>>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  const dragStateRef = useRef<{
    baseScene: Scene;
    documentSessionId: number;
    ids: string[];
    latestPatch: Partial<LayerEffects> | null;
  } | null>(null);

  // Resume temporal history safely if unmounted mid-drag
  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        resumeHistory();
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen]);

  const applyEffectTarget = useCallback(
    (target: EffectTarget) => {
      if (layerIds.length === 0) return;
      const section = effectKindToSection(target.kind);
      setExpanded((prev) => ({ ...prev, [section]: true }));
      const patch = resolveEffectTargetPatch(target, effects);

      if (isVectorEffectKind(target.kind) && !hasPath && layers.some((l) => l.type === 'text')) {
        void convertTextLayersToOutlines(layerIds).then((converted) => {
          if (converted.length > 0) {
            onUpdateEffects(
              converted.map((c) => c.id),
              patch
            );
          }
        });
        return;
      }

      onUpdateEffects(layerIds, patch);
    },
    [effects, hasPath, layerIds, layers, onUpdateEffects]
  );

  useEffect(() => {
    if (!focusedEffect || layerIds.length === 0) return;
    applyEffectTarget(focusedEffect);
    onConsumeFocus();
  }, [applyEffectTarget, focusedEffect, layerIds.length, onConsumeFocus]);

  const beginLiveDrag = useCallback(() => {
    if (dragStateRef.current || layerIds.length === 0) return;
    const st = useEditorStore.getState();
    pauseHistory();
    dragStateRef.current = {
      baseScene: st.scene,
      documentSessionId: st.documentSessionId,
      ids: [...layerIds],
      latestPatch: null,
    };
  }, [layerIds]);

  const applyLivePatch = useCallback(
    (patch: Partial<LayerEffects>) => {
      if (!dragStateRef.current) {
        onUpdateEffects(layerIds, patch);
        return;
      }
      dragStateRef.current.latestPatch = patch;
      const idSet = new Set(dragStateRef.current.ids);
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
    },
    [layerIds, onUpdateEffects]
  );

  const commitLiveDrag = useCallback(() => {
    const active = dragStateRef.current;
    if (!active) return;
    dragStateRef.current = null;
    const sameSession =
      useEditorStore.getState().documentSessionId === active.documentSessionId;
    if (sameSession) {
      useEditorStore.setState({ scene: active.baseScene });
    }
    resumeHistory();
    if (sameSession && active.latestPatch) {
      onUpdateEffects(active.ids, active.latestPatch);
    }
  }, [onUpdateEffects]);

  const fieldCallbacks: EffectFieldCallbacks = useMemo(
    () => ({
      onCommit: (patch) => onUpdateEffects(layerIds, patch),
      onBeginDrag: beginLiveDrag,
      onLiveChange: applyLivePatch,
      onEndDrag: commitLiveDrag,
    }),
    [applyLivePatch, beginLiveDrag, commitLiveDrag, layerIds, onUpdateEffects]
  );

  const toggleSection = (sec: EffectSectionId) => {
    setExpanded((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const canUseVectorEffects = hasPath || layers.some((l) => l.type === 'text');

  const isAvailableItem = (item: AddMenuItem): boolean => {
    if (item.vectorOnly && !canUseVectorEffects) return false;
    if (item.kind === 'warp') return !effects?.warp;
    if (
      item.kind === 'zigzag' ||
      item.kind === 'roughen' ||
      item.kind === 'roundCorners' ||
      item.kind === 'puckerBloat'
    ) {
      return effects?.distort?.kind !== item.kind;
    }
    if (item.kind === '3d-rotate') return effects?.effect3d?.kind !== 'rotate';
    if (item.kind === '3d-extrude') return effects?.effect3d?.kind !== 'extrude';
    if (item.kind === 'blur') return !(effects?.blur !== undefined && effects.blur > 0);
    if (item.kind === 'motionBlur') return !effects?.motionBlur;
    if (item.kind === 'dropShadow') return !effects?.dropShadow;
    if (item.kind === 'innerShadow') return !effects?.innerShadow;
    if (item.kind === 'colorAdjust') return !effects?.colorAdjust;
    return !effects?.outerGlow;
  };

  const availableCategories = ADD_MENU_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter(isAvailableItem),
  })).filter((category) => category.items.length > 0);
  const hasAvailableItems = availableCategories.length > 0;

  const hasAny = Boolean(
    effects &&
      (effects.warp ||
        effects.distort ||
        effects.effect3d ||
        (effects.blur !== undefined && effects.blur > 0) ||
        effects.motionBlur ||
        effects.dropShadow ||
        effects.innerShadow ||
        effects.outerGlow ||
        effects.colorAdjust)
  );

  const warp = effects?.warp;
  const distort: DistortEffect | undefined = effects?.distort;
  const effect3d: Effect3D | undefined = effects?.effect3d;
  const blurVal = effects?.blur !== undefined && effects.blur > 0 ? effects.blur : null;
  const motionBlur: MotionBlurEffect | undefined = effects?.motionBlur;
  const dropShadow: DropShadowEffect | undefined = effects?.dropShadow;
  const innerShadow: DropShadowEffect | undefined = effects?.innerShadow;
  const outerGlow: OuterGlowEffect | undefined = effects?.outerGlow;
  const colorAdjust: ColorAdjustEffect | undefined = effects?.colorAdjust;

  return (
    <div
      data-tour="inspector.effects"
      className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-paper-muted">Эффекты</span>
        <div className="flex items-center gap-2">
          {hasAny && (
            <button
              type="button"
              onClick={() => onUpdateEffects(layerIds, null)}
              className="text-[11px] text-paper-muted hover:text-paper-danger"
            >
              Очистить
            </button>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              disabled={!hasAvailableItems}
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex h-5 items-center gap-0.5 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
            >
              <Plus className="h-3 w-3 text-paper-accent" strokeWidth={1.75} />
              <span>Добавить</span>
            </button>
            {menuOpen && hasAvailableItems && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded border border-paper-border bg-paper-panel py-1 shadow-lg">
                {availableCategories.map((category, idx) => (
                  <div
                    key={category.title}
                    className={idx > 0 ? 'mt-1 border-t border-paper-border/60 pt-1' : ''}
                  >
                    <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper-muted">
                      {category.title}
                    </div>
                    {category.items.map((item) => (
                      <button
                        key={item.kind}
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          applyEffectTarget(
                            item.kind === 'warp' ? { kind: 'warp' } : { kind: item.kind }
                          );
                        }}
                        className="flex w-full items-center px-2.5 py-1 text-left text-[11px] text-paper-ink hover:bg-paper-hover"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasAny && (
        <div className="flex flex-col gap-1">
          {warp && (
            <EffectCard
              title="Деформация (Warp)"
              badge={`${warp.bend}%`}
              expanded={Boolean(expanded.warp)}
              onToggle={() => toggleSection('warp')}
              onRemove={() => onUpdateEffects(layerIds, { warp: undefined })}
            >
              <WarpEffectFields warp={warp} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {distort && (
            <EffectCard
              title={
                distort.kind === 'zigzag'
                  ? 'Зигзаг (Zig Zag)'
                  : distort.kind === 'roughen'
                    ? 'Загрубление'
                    : distort.kind === 'puckerBloat'
                      ? 'Втягивание и раздувание'
                      : 'Скругление углов'
              }
              badge={
                distort.kind === 'roundCorners'
                  ? `${distort.radius} px`
                  : distort.kind === 'puckerBloat'
                    ? `${distort.amount}%`
                    : `${distort.size} px`
              }
              expanded={Boolean(expanded.distort)}
              onToggle={() => toggleSection('distort')}
              onRemove={() => onUpdateEffects(layerIds, { distort: undefined })}
            >
              <DistortEffectFields distort={distort} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {effect3d && (
            <EffectCard
              title={effect3d.kind === 'extrude' ? '3D Выдавливание' : '3D Поворот'}
              badge={`${effect3d.rotateX}° / ${effect3d.rotateY}°`}
              expanded={Boolean(expanded.effect3d)}
              onToggle={() => toggleSection('effect3d')}
              onRemove={() => onUpdateEffects(layerIds, { effect3d: undefined })}
            >
              <Effect3DFields effect3d={effect3d} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {blurVal !== null && (
            <EffectCard
              title="Размытие по Гауссу"
              badge={`${blurVal} px`}
              expanded={Boolean(expanded.blur)}
              onToggle={() => toggleSection('blur')}
              onRemove={() => onUpdateEffects(layerIds, { blur: undefined })}
            >
              <BlurEffectFields blur={blurVal} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {motionBlur && (
            <EffectCard
              title="Размытие в движении"
              badge={`${motionBlur.amount} px`}
              expanded={Boolean(expanded.motionBlur)}
              onToggle={() => toggleSection('motionBlur')}
              onRemove={() => onUpdateEffects(layerIds, { motionBlur: undefined })}
            >
              <MotionBlurEffectFields motionBlur={motionBlur} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {dropShadow && (
            <EffectCard
              title="Падающая тень"
              badge={`${dropShadow.blur} px`}
              expanded={Boolean(expanded.dropShadow)}
              onToggle={() => toggleSection('dropShadow')}
              onRemove={() => onUpdateEffects(layerIds, { dropShadow: undefined })}
            >
              <ShadowEffectFields
                shadow={dropShadow}
                onCommit={(next) => onUpdateEffects(layerIds, { dropShadow: next })}
                onBeginDrag={beginLiveDrag}
                onLiveChange={(next) => applyLivePatch({ dropShadow: next })}
                onEndDrag={commitLiveDrag}
              />
            </EffectCard>
          )}

          {innerShadow && (
            <EffectCard
              title="Внутренняя тень"
              badge={`${innerShadow.blur} px`}
              expanded={Boolean(expanded.innerShadow)}
              onToggle={() => toggleSection('innerShadow')}
              onRemove={() => onUpdateEffects(layerIds, { innerShadow: undefined })}
            >
              <ShadowEffectFields
                shadow={innerShadow}
                onCommit={(next) => onUpdateEffects(layerIds, { innerShadow: next })}
                onBeginDrag={beginLiveDrag}
                onLiveChange={(next) => applyLivePatch({ innerShadow: next })}
                onEndDrag={commitLiveDrag}
              />
            </EffectCard>
          )}

          {outerGlow && (
            <EffectCard
              title="Внешнее свечение"
              badge={`${outerGlow.blur} px`}
              expanded={Boolean(expanded.outerGlow)}
              onToggle={() => toggleSection('outerGlow')}
              onRemove={() => onUpdateEffects(layerIds, { outerGlow: undefined })}
            >
              <OuterGlowEffectFields outerGlow={outerGlow} callbacks={fieldCallbacks} />
            </EffectCard>
          )}

          {colorAdjust && (
            <EffectCard
              title="Цветокоррекция"
              badge={hasActiveColorAdjust(colorAdjust) ? 'Активно' : '0'}
              expanded={Boolean(expanded.colorAdjust)}
              onToggle={() => toggleSection('colorAdjust')}
              onRemove={() => onUpdateEffects(layerIds, { colorAdjust: undefined })}
            >
              <ColorAdjustEffectFields colorAdjust={colorAdjust} callbacks={fieldCallbacks} />
            </EffectCard>
          )}
        </div>
      )}

      {onExpandAppearance &&
        layers.some((l) => l.type === 'path' && hasVectorEffects(l.effects)) && (
          <button
            type="button"
            onClick={() => onExpandAppearance(layerIds)}
            className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
          >
            <Sparkles className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
            <span>Разобрать оформление</span>
          </button>
        )}
    </div>
  );
}
