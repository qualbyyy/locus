import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
import { convertTextLayersToOutlines } from '../../core/commands';
import { mapLayerTree } from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
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
  WarpEffect,
  WarpStyle,
} from '../../core/types';
import { hasActiveColorAdjust, hasVectorEffects } from '../../engine/effects';
import { HexColorRow } from '../InspectorControls';
import { Checkbox, Select, Slider } from '../controls';

export type EffectTarget =
  | { kind: 'warp'; initialWarpStyle?: WarpStyle }
  | { kind: 'zigzag' }
  | { kind: 'roughen' }
  | { kind: 'roundCorners' }
  | { kind: 'puckerBloat' }
  | { kind: '3d-rotate' }
  | { kind: '3d-extrude' }
  | { kind: 'blur' }
  | { kind: 'motionBlur' }
  | { kind: 'dropShadow' }
  | { kind: 'innerShadow' }
  | { kind: 'outerGlow' }
  | { kind: 'colorAdjust' };

export type EffectSectionId =
  | 'warp'
  | 'distort'
  | 'effect3d'
  | 'blur'
  | 'motionBlur'
  | 'dropShadow'
  | 'innerShadow'
  | 'outerGlow'
  | 'colorAdjust';

const BLUR_PRESETS = [8, 24, 60, 120];

export const DEFAULT_EFFECT_PATCH: Record<EffectTarget['kind'], Partial<LayerEffects>> = {
  warp: {
    warp: { style: 'flag', bend: 45, distortH: 0, distortV: 0 },
  },
  zigzag: {
    distort: { kind: 'zigzag', size: 8, ridges: 5, smooth: false },
  },
  roughen: {
    distort: { kind: 'roughen', size: 6, detail: 4, seed: 1 },
  },
  roundCorners: {
    distort: { kind: 'roundCorners', radius: 16 },
  },
  puckerBloat: {
    distort: { kind: 'puckerBloat', amount: 35 },
  },
  '3d-rotate': {
    effect3d: {
      kind: 'rotate',
      rotateX: 18,
      rotateY: -22,
      rotateZ: 0,
      perspective: 45,
      depth: 0,
      shade: 0.7,
    },
  },
  '3d-extrude': {
    effect3d: {
      kind: 'extrude',
      rotateX: 18,
      rotateY: -22,
      rotateZ: 0,
      perspective: 45,
      depth: 36,
      shade: 0.7,
    },
  },
  blur: { blur: 8 },
  motionBlur: { motionBlur: { amount: 18, angle: 0 } },
  dropShadow: {
    dropShadow: {
      color: '#000000',
      opacity: 0.35,
      offsetX: 6,
      offsetY: 10,
      blur: 12,
    },
  },
  innerShadow: {
    innerShadow: {
      color: '#000000',
      opacity: 0.45,
      offsetX: 0,
      offsetY: 4,
      blur: 10,
    },
  },
  outerGlow: {
    outerGlow: {
      color: '#da7756',
      opacity: 0.65,
      blur: 14,
    },
  },
  colorAdjust: {
    colorAdjust: {
      brightness: 0,
      contrast: 15,
      saturate: 20,
      hue: 0,
    },
  },
};

export function effectKindToSection(kind: EffectTarget['kind']): EffectSectionId {
  switch (kind) {
    case 'warp':
      return 'warp';
    case 'zigzag':
    case 'roughen':
    case 'roundCorners':
    case 'puckerBloat':
      return 'distort';
    case '3d-rotate':
    case '3d-extrude':
      return 'effect3d';
    case 'blur':
      return 'blur';
    case 'motionBlur':
      return 'motionBlur';
    case 'dropShadow':
      return 'dropShadow';
    case 'innerShadow':
      return 'innerShadow';
    case 'outerGlow':
      return 'outerGlow';
    case 'colorAdjust':
      return 'colorAdjust';
  }
}

const WARP_STYLES: Array<{ value: WarpStyle; label: string }> = [
  { value: 'flag', label: 'Флаг' },
  { value: 'wave', label: 'Волна' },
  { value: 'arc', label: 'Дуга' },
  { value: 'arch', label: 'Арка' },
  { value: 'bulge', label: 'Выпуклость' },
  { value: 'fisheye', label: 'Рыбий глаз' },
  { value: 'twist', label: 'Скручивание' },
  { value: 'squeeze', label: 'Сжатие' },
  { value: 'rise', label: 'Подъём' },
];

type AddMenuItem = {
  kind: EffectTarget['kind'];
  label: string;
  vectorOnly?: boolean;
};

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

function isVectorEffectKind(kind: EffectTarget['kind']): boolean {
  return (
    kind !== 'blur' &&
    kind !== 'motionBlur' &&
    kind !== 'dropShadow' &&
    kind !== 'innerShadow' &&
    kind !== 'outerGlow' &&
    kind !== 'colorAdjust'
  );
}

function LiveSliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChangeStart,
  onChange,
  onChangeEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChangeStart: () => void;
  onChange: (val: number) => void;
  onChangeEnd: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-paper-muted">{label}</span>
        <span className="font-display text-paper-ink">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        ariaLabel={label}
        onChangeStart={onChangeStart}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
    </div>
  );
}

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

function ShadowEffectFields({
  shadow,
  onCommit,
  onBeginDrag,
  onLiveChange,
  onEndDrag,
}: {
  shadow: DropShadowEffect;
  onCommit: (next: DropShadowEffect) => void;
  onBeginDrag: () => void;
  onLiveChange: (next: DropShadowEffect) => void;
  onEndDrag: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Цвет тени</span>
        <HexColorRow
          value={shadow.color}
          onChange={(color) => onCommit({ ...shadow, color })}
        />
      </div>
      <LiveSliderRow
        label="Непрозрачность"
        value={Math.round(shadow.opacity * 100)}
        min={0}
        max={100}
        unit="%"
        onChangeStart={onBeginDrag}
        onChange={(v) => onLiveChange({ ...shadow, opacity: v / 100 })}
        onChangeEnd={onEndDrag}
      />
      <LiveSliderRow
        label="Смещение X"
        value={shadow.offsetX}
        min={-60}
        max={60}
        unit=" px"
        onChangeStart={onBeginDrag}
        onChange={(offsetX) => onLiveChange({ ...shadow, offsetX })}
        onChangeEnd={onEndDrag}
      />
      <LiveSliderRow
        label="Смещение Y"
        value={shadow.offsetY}
        min={-60}
        max={60}
        unit=" px"
        onChangeStart={onBeginDrag}
        onChange={(offsetY) => onLiveChange({ ...shadow, offsetY })}
        onChangeEnd={onEndDrag}
      />
      <LiveSliderRow
        label="Размытие"
        value={shadow.blur}
        min={0}
        max={50}
        unit=" px"
        onChangeStart={onBeginDrag}
        onChange={(blur) => onLiveChange({ ...shadow, blur })}
        onChangeEnd={onEndDrag}
      />
    </>
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
    ids: string[];
    latestPatch: Partial<LayerEffects> | null;
  } | null>(null);

  // Resume temporal history safely if unmounted mid-drag
  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        useEditorStore.temporal.getState().resume();
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

      let patch: Partial<LayerEffects>;
      if (target.kind === 'warp') {
        const base = effects?.warp ?? (DEFAULT_EFFECT_PATCH.warp.warp as WarpEffect);
        patch = {
          warp: target.initialWarpStyle
            ? { ...base, style: target.initialWarpStyle }
            : base,
        };
      } else if (target.kind === 'zigzag') {
        patch = effects?.distort?.kind === 'zigzag'
          ? { distort: effects.distort }
          : DEFAULT_EFFECT_PATCH.zigzag;
      } else if (target.kind === 'roughen') {
        patch = effects?.distort?.kind === 'roughen'
          ? { distort: effects.distort }
          : DEFAULT_EFFECT_PATCH.roughen;
      } else if (target.kind === 'roundCorners') {
        patch = effects?.distort?.kind === 'roundCorners'
          ? { distort: effects.distort }
          : DEFAULT_EFFECT_PATCH.roundCorners;
      } else if (target.kind === 'puckerBloat') {
        patch = effects?.distort?.kind === 'puckerBloat'
          ? { distort: effects.distort }
          : DEFAULT_EFFECT_PATCH.puckerBloat;
      } else if (target.kind === '3d-rotate' || target.kind === '3d-extrude') {
        const def = DEFAULT_EFFECT_PATCH[target.kind].effect3d as Effect3D;
        patch = {
          effect3d: effects?.effect3d
            ? { ...effects.effect3d, kind: def.kind }
            : def,
        };
      } else if (target.kind === 'blur') {
        patch = effects?.blur !== undefined ? { blur: effects.blur } : DEFAULT_EFFECT_PATCH.blur;
      } else if (target.kind === 'motionBlur') {
        patch = effects?.motionBlur
          ? { motionBlur: effects.motionBlur }
          : DEFAULT_EFFECT_PATCH.motionBlur;
      } else if (target.kind === 'dropShadow') {
        patch = effects?.dropShadow
          ? { dropShadow: effects.dropShadow }
          : DEFAULT_EFFECT_PATCH.dropShadow;
      } else if (target.kind === 'innerShadow') {
        patch = effects?.innerShadow
          ? { innerShadow: effects.innerShadow }
          : DEFAULT_EFFECT_PATCH.innerShadow;
      } else if (target.kind === 'colorAdjust') {
        patch = effects?.colorAdjust
          ? { colorAdjust: effects.colorAdjust }
          : DEFAULT_EFFECT_PATCH.colorAdjust;
      } else {
        patch = effects?.outerGlow
          ? { outerGlow: effects.outerGlow }
          : DEFAULT_EFFECT_PATCH.outerGlow;
      }

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
    const baseScene = useEditorStore.getState().scene;
    useEditorStore.temporal.getState().pause();
    dragStateRef.current = { baseScene, ids: [...layerIds], latestPatch: null };
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
    useEditorStore.setState({ scene: active.baseScene });
    useEditorStore.temporal.getState().resume();
    if (active.latestPatch) {
      onUpdateEffects(active.ids, active.latestPatch);
    }
  }, [onUpdateEffects]);

  const toggleSection = (sec: EffectSectionId) => {
    setExpanded((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const isItemAvailable = (item: AddMenuItem): boolean => {
    if (item.vectorOnly && !hasPath) return false;
    if (item.kind === 'warp') return !effects?.warp;
    if (
      item.kind === 'zigzag' ||
      item.kind === 'roughen' ||
      item.kind === 'roundCorners' ||
      item.kind === 'puckerBloat'
    ) {
      return !effects?.distort;
    }
    if (item.kind === '3d-rotate' || item.kind === '3d-extrude') return !effects?.effect3d;
    if (item.kind === 'blur') return !(effects?.blur !== undefined && effects.blur > 0);
    if (item.kind === 'motionBlur') return !effects?.motionBlur;
    if (item.kind === 'dropShadow') return !effects?.dropShadow;
    if (item.kind === 'innerShadow') return !effects?.innerShadow;
    if (item.kind === 'colorAdjust') return !effects?.colorAdjust;
    return !effects?.outerGlow;
  };

  const availableCategories = ADD_MENU_CATEGORIES.map((cat) => ({
    title: cat.title,
    items: cat.items.filter(isItemAvailable),
  })).filter((cat) => cat.items.length > 0);

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

  const warp: WarpEffect | undefined = effects?.warp;
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
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Стиль</span>
                <Select
                  value={warp.style}
                  options={WARP_STYLES}
                  ariaLabel="Стиль деформации"
                  onChange={(style) =>
                    onUpdateEffects(layerIds, {
                      warp: { ...warp, style: style as WarpStyle },
                    })
                  }
                />
              </div>
              <LiveSliderRow
                label="Изгиб"
                value={warp.bend}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(bend) => applyLivePatch({ warp: { ...warp, bend } })}
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Искажение X"
                value={warp.distortH}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(distortH) => applyLivePatch({ warp: { ...warp, distortH } })}
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Искажение Y"
                value={warp.distortV}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(distortV) => applyLivePatch({ warp: { ...warp, distortV } })}
                onChangeEnd={commitLiveDrag}
              />
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
              {distort.kind === 'zigzag' && (
                <>
                  <LiveSliderRow
                    label="Размер"
                    value={distort.size}
                    min={1}
                    max={50}
                    unit=" px"
                    onChangeStart={beginLiveDrag}
                    onChange={(size) => applyLivePatch({ distort: { ...distort, size } })}
                    onChangeEnd={commitLiveDrag}
                  />
                  <LiveSliderRow
                    label="Складок на сегмент"
                    value={distort.ridges}
                    min={1}
                    max={20}
                    onChangeStart={beginLiveDrag}
                    onChange={(ridges) => applyLivePatch({ distort: { ...distort, ridges } })}
                    onChangeEnd={commitLiveDrag}
                  />
                  <Checkbox
                    checked={distort.smooth}
                    onChange={(smooth) =>
                      onUpdateEffects(layerIds, { distort: { ...distort, smooth } })
                    }
                    label="Сглаженные волны"
                  />
                </>
              )}
              {distort.kind === 'roughen' && (
                <>
                  <LiveSliderRow
                    label="Размер"
                    value={distort.size}
                    min={1}
                    max={40}
                    unit=" px"
                    onChangeStart={beginLiveDrag}
                    onChange={(size) => applyLivePatch({ distort: { ...distort, size } })}
                    onChangeEnd={commitLiveDrag}
                  />
                  <LiveSliderRow
                    label="Детализация"
                    value={distort.detail}
                    min={1}
                    max={15}
                    onChangeStart={beginLiveDrag}
                    onChange={(detail) => applyLivePatch({ distort: { ...distort, detail } })}
                    onChangeEnd={commitLiveDrag}
                  />
                  <LiveSliderRow
                    label="Вариант (seed)"
                    value={distort.seed}
                    min={1}
                    max={50}
                    onChangeStart={beginLiveDrag}
                    onChange={(seed) => applyLivePatch({ distort: { ...distort, seed } })}
                    onChangeEnd={commitLiveDrag}
                  />
                </>
              )}
              {distort.kind === 'roundCorners' && (
                <LiveSliderRow
                  label="Радиус"
                  value={distort.radius}
                  min={0}
                  max={80}
                  unit=" px"
                  onChangeStart={beginLiveDrag}
                  onChange={(radius) =>
                    applyLivePatch({ distort: { kind: 'roundCorners', radius } })
                  }
                  onChangeEnd={commitLiveDrag}
                />
              )}
              {distort.kind === 'puckerBloat' && (
                <LiveSliderRow
                  label="Степень"
                  value={distort.amount}
                  min={-100}
                  max={100}
                  unit="%"
                  onChangeStart={beginLiveDrag}
                  onChange={(amount) =>
                    applyLivePatch({ distort: { kind: 'puckerBloat', amount } })
                  }
                  onChangeEnd={commitLiveDrag}
                />
              )}
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
              <LiveSliderRow
                label="Наклон X"
                value={effect3d.rotateX}
                min={-75}
                max={75}
                unit="°"
                onChangeStart={beginLiveDrag}
                onChange={(rotateX) => applyLivePatch({ effect3d: { ...effect3d, rotateX } })}
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Поворот Y"
                value={effect3d.rotateY}
                min={-75}
                max={75}
                unit="°"
                onChangeStart={beginLiveDrag}
                onChange={(rotateY) => applyLivePatch({ effect3d: { ...effect3d, rotateY } })}
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Поворот Z"
                value={effect3d.rotateZ}
                min={-180}
                max={180}
                unit="°"
                onChangeStart={beginLiveDrag}
                onChange={(rotateZ) => applyLivePatch({ effect3d: { ...effect3d, rotateZ } })}
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Перспектива"
                value={effect3d.perspective}
                min={0}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(perspective) =>
                  applyLivePatch({ effect3d: { ...effect3d, perspective } })
                }
                onChangeEnd={commitLiveDrag}
              />
              {effect3d.kind === 'extrude' && (
                <>
                  <LiveSliderRow
                    label="Глубина"
                    value={effect3d.depth}
                    min={0}
                    max={120}
                    unit=" px"
                    onChangeStart={beginLiveDrag}
                    onChange={(depth) => applyLivePatch({ effect3d: { ...effect3d, depth } })}
                    onChangeEnd={commitLiveDrag}
                  />
                  <LiveSliderRow
                    label="Интенсивность теней"
                    value={Math.round(effect3d.shade * 100)}
                    min={0}
                    max={100}
                    unit="%"
                    onChangeStart={beginLiveDrag}
                    onChange={(v) => applyLivePatch({ effect3d: { ...effect3d, shade: v / 100 } })}
                    onChangeEnd={commitLiveDrag}
                  />
                </>
              )}
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
              <LiveSliderRow
                label="Радиус"
                value={blurVal}
                min={0.5}
                max={150}
                step={0.5}
                unit=" px"
                onChangeStart={beginLiveDrag}
                onChange={(blur) => applyLivePatch({ blur })}
                onChangeEnd={commitLiveDrag}
              />
              <div className="grid grid-cols-4 gap-1">
                {BLUR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onUpdateEffects(layerIds, { blur: preset })}
                    className={`h-6 rounded border font-display text-[10px] transition-colors ${
                      Math.abs(blurVal - preset) < 0.25
                        ? 'border-paper-accent bg-paper-accent/15 text-paper-ink'
                        : 'border-paper-border bg-paper-panel text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                    }`}
                  >
                    {preset} px
                  </button>
                ))}
              </div>
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
              <LiveSliderRow
                label="Сила"
                value={motionBlur.amount}
                min={1}
                max={100}
                unit=" px"
                onChangeStart={beginLiveDrag}
                onChange={(amount) =>
                  applyLivePatch({ motionBlur: { ...motionBlur, amount } })
                }
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Угол"
                value={motionBlur.angle}
                min={0}
                max={360}
                unit="°"
                onChangeStart={beginLiveDrag}
                onChange={(angle) =>
                  applyLivePatch({ motionBlur: { ...motionBlur, angle } })
                }
                onChangeEnd={commitLiveDrag}
              />
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
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Цвет свечения</span>
                <HexColorRow
                  value={outerGlow.color}
                  onChange={(color) =>
                    onUpdateEffects(layerIds, {
                      outerGlow: { ...outerGlow, color },
                    })
                  }
                />
              </div>
              <LiveSliderRow
                label="Непрозрачность"
                value={Math.round(outerGlow.opacity * 100)}
                min={0}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(v) =>
                  applyLivePatch({ outerGlow: { ...outerGlow, opacity: v / 100 } })
                }
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Радиус"
                value={outerGlow.blur}
                min={0}
                max={50}
                unit=" px"
                onChangeStart={beginLiveDrag}
                onChange={(blur) => applyLivePatch({ outerGlow: { ...outerGlow, blur } })}
                onChangeEnd={commitLiveDrag}
              />
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
              <LiveSliderRow
                label="Яркость"
                value={colorAdjust.brightness}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(brightness) =>
                  applyLivePatch({ colorAdjust: { ...colorAdjust, brightness } })
                }
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Контраст"
                value={colorAdjust.contrast}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(contrast) =>
                  applyLivePatch({ colorAdjust: { ...colorAdjust, contrast } })
                }
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Насыщенность"
                value={colorAdjust.saturate}
                min={-100}
                max={100}
                unit="%"
                onChangeStart={beginLiveDrag}
                onChange={(saturate) =>
                  applyLivePatch({ colorAdjust: { ...colorAdjust, saturate } })
                }
                onChangeEnd={commitLiveDrag}
              />
              <LiveSliderRow
                label="Оттенок"
                value={colorAdjust.hue}
                min={-180}
                max={180}
                unit="°"
                onChangeStart={beginLiveDrag}
                onChange={(hue) =>
                  applyLivePatch({ colorAdjust: { ...colorAdjust, hue } })
                }
                onChangeEnd={commitLiveDrag}
              />
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
