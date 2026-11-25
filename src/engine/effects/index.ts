import { clamp } from '../../core/math';
import { getPrimaryColor } from '../../core/paint';
import type { LayerEffects, PathLayer, SubPath } from '../../core/types';
import { parseColorToRgba } from '../../export/pathData';
import { apply3DEffect, type ExtrudeFace } from './effects3d';
import { applyDistortToSubPaths, applyWarpToSubPaths } from './warp';

export type { ExtrudeFace } from './effects3d';
export { apply3DEffect } from './effects3d';
export { applyDistortToSubPaths, applyWarpToSubPaths } from './warp';

export function hasVectorEffects(effects?: LayerEffects): boolean {
  if (!effects) return false;
  return Boolean(effects.warp || effects.distort || effects.effect3d);
}

export function hasRasterEffects(effects?: LayerEffects): boolean {
  if (!effects) return false;
  return Boolean(
    (effects.blur && effects.blur > 0.1) ||
      effects.dropShadow ||
      effects.outerGlow
  );
}

export function hasAnyEffects(effects?: LayerEffects): boolean {
  return hasVectorEffects(effects) || hasRasterEffects(effects);
}

export function resolveEffectivePathGeometry(layer: PathLayer): {
  subpaths: SubPath[];
  extrudeFaces: ExtrudeFace[];
} {
  const eff = layer.effects;
  if (!eff || !hasVectorEffects(eff)) {
    return { subpaths: layer.subpaths, extrudeFaces: [] };
  }

  let subpaths = layer.subpaths;
  if (eff.distort) {
    subpaths = applyDistortToSubPaths(subpaths, eff.distort);
  }
  if (eff.warp) {
    subpaths = applyWarpToSubPaths(subpaths, eff.warp);
  }
  let extrudeFaces: ExtrudeFace[] = [];
  if (eff.effect3d) {
    const baseFill = getPrimaryColor(layer.fill ?? layer.stroke?.color, '#da7756');
    const res = apply3DEffect(subpaths, eff.effect3d, baseFill);
    subpaths = res.front;
    extrudeFaces = res.faces;
  }

  return { subpaths, extrudeFaces };
}

export function colorWithOpacity(color: string, opacity: number): string {
  const rgba = parseColorToRgba(color);
  const a = clamp(opacity, 0, 1);
  if (!rgba) return color;
  return `rgba(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])}, ${(rgba[3] * a).toFixed(3)})`;
}

export function getEffectsPadding(effects?: LayerEffects): number {
  if (!effects) return 0;
  const blurPad = (effects.blur ?? 0) * 3;
  const shadowPad = effects.dropShadow
    ? effects.dropShadow.blur * 3 +
      Math.max(Math.abs(effects.dropShadow.offsetX), Math.abs(effects.dropShadow.offsetY))
    : 0;
  const glowPad = effects.outerGlow ? effects.outerGlow.blur * 3 : 0;
  const pad = Math.ceil(Math.max(blurPad, shadowPad, glowPad));
  return pad > 0 ? pad + 8 : 0;
}
