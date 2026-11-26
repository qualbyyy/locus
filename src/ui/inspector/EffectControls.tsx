import {
  DEFAULT_EFFECT_PATCH as BASE_DEFAULT_EFFECT_PATCH,
  WARP_STYLES,
} from './effectMeta';
import { HexColorRow } from '../InspectorControls';
import { Checkbox, Select, Slider } from '../controls';
import type {
  ColorAdjustEffect,
  DistortEffect,
  DropShadowEffect,
  Effect3D,
  LayerEffects,
  MotionBlurEffect,
  OuterGlowEffect,
  WarpEffect,
  WarpStyle,
} from '../../core/types';

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

export const BLUR_PRESETS = [8, 24, 60, 120];
export const DEFAULT_EFFECT_PATCH = BASE_DEFAULT_EFFECT_PATCH;
export { WARP_STYLES };

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
    case 'colorAdjust':
      return 'colorAdjust';
    case 'outerGlow':
      return 'outerGlow';
  }
}

export function isVectorEffectKind(kind: EffectTarget['kind']): boolean {
  return (
    kind !== 'blur' &&
    kind !== 'motionBlur' &&
    kind !== 'dropShadow' &&
    kind !== 'innerShadow' &&
    kind !== 'outerGlow' &&
    kind !== 'colorAdjust'
  );
}

export function getEffectTitle(target: EffectTarget): string {
  switch (target.kind) {
    case 'warp':
      return 'Деформация (Warp)';
    case 'zigzag':
      return 'Зигзаг (Zig Zag)';
    case 'roughen':
      return 'Загрубление (Roughen)';
    case 'roundCorners':
      return 'Скругление углов';
    case 'puckerBloat':
      return 'Втягивание и раздувание';
    case '3d-rotate':
      return '3D Поворот';
    case '3d-extrude':
      return '3D Выдавливание';
    case 'blur':
      return 'Размытие по Гауссу';
    case 'motionBlur':
      return 'Размытие в движении';
    case 'dropShadow':
      return 'Падающая тень';
    case 'innerShadow':
      return 'Внутренняя тень';
    case 'outerGlow':
      return 'Внешнее свечение';
    case 'colorAdjust':
      return 'Цветокоррекция';
  }
}

/** Возвращает начальный патч эффекта с учётом уже имеющихся настроек на слое. */
export function resolveEffectTargetPatch(
  target: EffectTarget,
  effects?: LayerEffects
): Partial<LayerEffects> {
  if (target.kind === 'warp') {
    const base = effects?.warp ?? (DEFAULT_EFFECT_PATCH.warp.warp as WarpEffect);
    return {
      warp: {
        ...base,
        style: target.initialWarpStyle ?? base.style,
      },
    };
  }
  if (target.kind === 'zigzag' || target.kind === 'roughen' || target.kind === 'roundCorners' || target.kind === 'puckerBloat') {
    return effects?.distort?.kind === target.kind
      ? { distort: effects.distort }
      : DEFAULT_EFFECT_PATCH[target.kind];
  }
  if (target.kind === '3d-rotate' || target.kind === '3d-extrude') {
    const def = DEFAULT_EFFECT_PATCH[target.kind].effect3d as Effect3D;
    return {
      effect3d: effects?.effect3d ? { ...effects.effect3d, kind: def.kind } : def,
    };
  }
  if (target.kind === 'blur') {
    return effects?.blur !== undefined && effects.blur > 0
      ? { blur: effects.blur }
      : DEFAULT_EFFECT_PATCH.blur;
  }
  if (target.kind === 'motionBlur') {
    return effects?.motionBlur
      ? { motionBlur: effects.motionBlur }
      : DEFAULT_EFFECT_PATCH.motionBlur;
  }
  if (target.kind === 'dropShadow') {
    return effects?.dropShadow
      ? { dropShadow: effects.dropShadow }
      : DEFAULT_EFFECT_PATCH.dropShadow;
  }
  if (target.kind === 'innerShadow') {
    return effects?.innerShadow
      ? { innerShadow: effects.innerShadow }
      : DEFAULT_EFFECT_PATCH.innerShadow;
  }
  if (target.kind === 'colorAdjust') {
    return effects?.colorAdjust
      ? { colorAdjust: effects.colorAdjust }
      : DEFAULT_EFFECT_PATCH.colorAdjust;
  }
  return effects?.outerGlow
    ? { outerGlow: effects.outerGlow }
    : DEFAULT_EFFECT_PATCH.outerGlow;
}

export interface EffectFieldCallbacks {
  onCommit: (patch: Partial<LayerEffects>) => void;
  onBeginDrag: () => void;
  onLiveChange: (patch: Partial<LayerEffects>) => void;
  onEndDrag: () => void;
}

export function LiveSliderRow({
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

export function WarpEffectFields({
  warp,
  callbacks,
}: {
  warp: WarpEffect;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Стиль</span>
        <Select
          value={warp.style}
          options={WARP_STYLES}
          ariaLabel="Стиль деформации"
          onChange={(style) =>
            callbacks.onCommit({ warp: { ...warp, style: style as WarpStyle } })
          }
        />
      </div>
      <LiveSliderRow
        label="Изгиб"
        value={warp.bend}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(bend) => callbacks.onLiveChange({ warp: { ...warp, bend } })}
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Искажение X"
        value={warp.distortH}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(distortH) => callbacks.onLiveChange({ warp: { ...warp, distortH } })}
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Искажение Y"
        value={warp.distortV}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(distortV) => callbacks.onLiveChange({ warp: { ...warp, distortV } })}
        onChangeEnd={callbacks.onEndDrag}
      />
    </>
  );
}

export function DistortEffectFields({
  distort,
  callbacks,
}: {
  distort: DistortEffect;
  callbacks: EffectFieldCallbacks;
}) {
  if (distort.kind === 'zigzag') {
    return (
      <>
        <LiveSliderRow
          label="Размер"
          value={distort.size}
          min={1}
          max={50}
          unit=" px"
          onChangeStart={callbacks.onBeginDrag}
          onChange={(size) => callbacks.onLiveChange({ distort: { ...distort, size } })}
          onChangeEnd={callbacks.onEndDrag}
        />
        <LiveSliderRow
          label="Складок на сегмент"
          value={distort.ridges}
          min={1}
          max={20}
          onChangeStart={callbacks.onBeginDrag}
          onChange={(ridges) => callbacks.onLiveChange({ distort: { ...distort, ridges } })}
          onChangeEnd={callbacks.onEndDrag}
        />
        <Checkbox
          checked={distort.smooth}
          onChange={(smooth) => callbacks.onCommit({ distort: { ...distort, smooth } })}
          label="Сглаженные волны"
        />
      </>
    );
  }
  if (distort.kind === 'roughen') {
    return (
      <>
        <LiveSliderRow
          label="Размер"
          value={distort.size}
          min={1}
          max={40}
          unit=" px"
          onChangeStart={callbacks.onBeginDrag}
          onChange={(size) => callbacks.onLiveChange({ distort: { ...distort, size } })}
          onChangeEnd={callbacks.onEndDrag}
        />
        <LiveSliderRow
          label="Детализация"
          value={distort.detail}
          min={1}
          max={15}
          onChangeStart={callbacks.onBeginDrag}
          onChange={(detail) => callbacks.onLiveChange({ distort: { ...distort, detail } })}
          onChangeEnd={callbacks.onEndDrag}
        />
        <LiveSliderRow
          label="Вариант (seed)"
          value={distort.seed}
          min={1}
          max={50}
          onChangeStart={callbacks.onBeginDrag}
          onChange={(seed) => callbacks.onLiveChange({ distort: { ...distort, seed } })}
          onChangeEnd={callbacks.onEndDrag}
        />
      </>
    );
  }
  if (distort.kind === 'roundCorners') {
    return (
      <LiveSliderRow
        label="Радиус"
        value={distort.radius}
        min={0}
        max={80}
        unit=" px"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(radius) =>
          callbacks.onLiveChange({ distort: { kind: 'roundCorners', radius } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
    );
  }
  return (
    <LiveSliderRow
      label="Степень"
      value={distort.amount}
      min={-100}
      max={100}
      unit="%"
      onChangeStart={callbacks.onBeginDrag}
      onChange={(amount) =>
        callbacks.onLiveChange({ distort: { kind: 'puckerBloat', amount } })
      }
      onChangeEnd={callbacks.onEndDrag}
    />
  );
}

export function Effect3DFields({
  effect3d,
  callbacks,
}: {
  effect3d: Effect3D;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <LiveSliderRow
        label="Наклон X"
        value={effect3d.rotateX}
        min={-75}
        max={75}
        unit="°"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(rotateX) =>
          callbacks.onLiveChange({ effect3d: { ...effect3d, rotateX } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Поворот Y"
        value={effect3d.rotateY}
        min={-75}
        max={75}
        unit="°"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(rotateY) =>
          callbacks.onLiveChange({ effect3d: { ...effect3d, rotateY } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Поворот Z"
        value={effect3d.rotateZ}
        min={-180}
        max={180}
        unit="°"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(rotateZ) =>
          callbacks.onLiveChange({ effect3d: { ...effect3d, rotateZ } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Перспектива"
        value={effect3d.perspective}
        min={0}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(perspective) =>
          callbacks.onLiveChange({ effect3d: { ...effect3d, perspective } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      {effect3d.kind === 'extrude' && (
        <>
          <LiveSliderRow
            label="Глубина"
            value={effect3d.depth}
            min={0}
            max={120}
            unit=" px"
            onChangeStart={callbacks.onBeginDrag}
            onChange={(depth) =>
              callbacks.onLiveChange({ effect3d: { ...effect3d, depth } })
            }
            onChangeEnd={callbacks.onEndDrag}
          />
          <LiveSliderRow
            label="Интенсивность теней"
            value={Math.round(effect3d.shade * 100)}
            min={0}
            max={100}
            unit="%"
            onChangeStart={callbacks.onBeginDrag}
            onChange={(v) =>
              callbacks.onLiveChange({ effect3d: { ...effect3d, shade: v / 100 } })
            }
            onChangeEnd={callbacks.onEndDrag}
          />
        </>
      )}
    </>
  );
}

export function BlurEffectFields({
  blur,
  callbacks,
}: {
  blur: number;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <LiveSliderRow
        label="Радиус"
        value={blur}
        min={0.5}
        max={150}
        step={0.5}
        unit=" px"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(val) => callbacks.onLiveChange({ blur: val })}
        onChangeEnd={callbacks.onEndDrag}
      />
      <div className="grid grid-cols-4 gap-1">
        {BLUR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => callbacks.onCommit({ blur: preset })}
            className={`h-6 rounded border font-display text-[10px] transition-colors ${
              Math.abs(blur - preset) < 0.25
                ? 'border-paper-accent bg-paper-accent/15 text-paper-ink'
                : 'border-paper-border bg-paper-panel text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
            }`}
          >
            {preset} px
          </button>
        ))}
      </div>
    </>
  );
}

export function MotionBlurEffectFields({
  motionBlur,
  callbacks,
}: {
  motionBlur: MotionBlurEffect;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <LiveSliderRow
        label="Сила"
        value={motionBlur.amount}
        min={1}
        max={100}
        unit=" px"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(amount) =>
          callbacks.onLiveChange({ motionBlur: { ...motionBlur, amount } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Угол"
        value={motionBlur.angle}
        min={0}
        max={360}
        unit="°"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(angle) =>
          callbacks.onLiveChange({ motionBlur: { ...motionBlur, angle } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
    </>
  );
}

export function ShadowEffectFields({
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

export function OuterGlowEffectFields({
  outerGlow,
  callbacks,
}: {
  outerGlow: OuterGlowEffect;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Цвет свечения</span>
        <HexColorRow
          value={outerGlow.color}
          onChange={(color) => callbacks.onCommit({ outerGlow: { ...outerGlow, color } })}
        />
      </div>
      <LiveSliderRow
        label="Непрозрачность"
        value={Math.round(outerGlow.opacity * 100)}
        min={0}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(v) =>
          callbacks.onLiveChange({ outerGlow: { ...outerGlow, opacity: v / 100 } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Радиус"
        value={outerGlow.blur}
        min={0}
        max={50}
        unit=" px"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(blur) =>
          callbacks.onLiveChange({ outerGlow: { ...outerGlow, blur } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
    </>
  );
}

export function ColorAdjustEffectFields({
  colorAdjust,
  callbacks,
}: {
  colorAdjust: ColorAdjustEffect;
  callbacks: EffectFieldCallbacks;
}) {
  return (
    <>
      <LiveSliderRow
        label="Яркость"
        value={colorAdjust.brightness}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(brightness) =>
          callbacks.onLiveChange({ colorAdjust: { ...colorAdjust, brightness } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Контраст"
        value={colorAdjust.contrast}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(contrast) =>
          callbacks.onLiveChange({ colorAdjust: { ...colorAdjust, contrast } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Насыщенность"
        value={colorAdjust.saturate}
        min={-100}
        max={100}
        unit="%"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(saturate) =>
          callbacks.onLiveChange({ colorAdjust: { ...colorAdjust, saturate } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
      <LiveSliderRow
        label="Оттенок"
        value={colorAdjust.hue}
        min={-180}
        max={180}
        unit="°"
        onChangeStart={callbacks.onBeginDrag}
        onChange={(hue) =>
          callbacks.onLiveChange({ colorAdjust: { ...colorAdjust, hue } })
        }
        onChangeEnd={callbacks.onEndDrag}
      />
    </>
  );
}
