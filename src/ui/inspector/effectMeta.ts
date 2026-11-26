import type { LayerEffects, WarpStyle } from '../../core/types';
import type { EffectTarget } from './EffectControls';

export const WARP_STYLES: Array<{ value: WarpStyle; label: string }> = [
  { value: 'flag', label: 'Флаг (Flag)' },
  { value: 'wave', label: 'Волна (Wave)' },
  { value: 'arc', label: 'Дуга (Arc)' },
  { value: 'arch', label: 'Арка (Arch)' },
  { value: 'bulge', label: 'Выпуклость (Bulge)' },
  { value: 'fisheye', label: 'Рыбий глаз (Fisheye)' },
  { value: 'twist', label: 'Скручивание (Twist)' },
  { value: 'squeeze', label: 'Сжатие (Squeeze)' },
  { value: 'rise', label: 'Подъём (Rise)' },
];

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
