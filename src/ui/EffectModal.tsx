import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import {
  convertTextLayersToOutlines,
  updateLayerEffects,
} from '../core/commands';
import { useEditorStore } from '../core/store';
import type {
  DistortEffect,
  DropShadowEffect,
  Effect3D,
  Layer,
  LayerEffects,
  OuterGlowEffect,
  WarpEffect,
  WarpStyle,
} from '../core/types';
import { HexColorRow } from './InspectorControls';
import { Checkbox, Select, Slider } from './controls';

export type EffectModalTarget =
  | { kind: 'warp'; initialWarpStyle?: WarpStyle }
  | { kind: 'zigzag' }
  | { kind: 'roughen' }
  | { kind: 'roundCorners' }
  | { kind: '3d-rotate' }
  | { kind: '3d-extrude' }
  | { kind: 'blur' }
  | { kind: 'dropShadow' }
  | { kind: 'outerGlow' };

interface EffectModalProps {
  target: EffectModalTarget | null;
  selectedIds: string[];
  onClose: () => void;
  onApplied?: (label: string) => void;
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

const TITLES: Record<EffectModalTarget['kind'], string> = {
  warp: 'Деформация (Warp)',
  zigzag: 'Зигзаг (Zig Zag)',
  roughen: 'Загрубление (Roughen)',
  roundCorners: 'Скругление углов',
  '3d-rotate': '3D Поворот (перспектива)',
  '3d-extrude': '3D Выдавливание (Extrude)',
  blur: 'Размытие по Гауссу',
  dropShadow: 'Падающая тень',
  outerGlow: 'Внешнее свечение',
};

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-paper-muted">{label}</span>
        <span className="font-mono text-paper-ink">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        ariaLabel={label}
        onChange={onChange}
      />
    </div>
  );
}

export function EffectModal({
  target,
  selectedIds,
  onClose,
  onApplied,
}: EffectModalProps) {
  const snapshotRef = useRef<Map<string, LayerEffects | undefined>>(new Map());
  const previewIdsRef = useRef<string[]>([]);

  const [warp, setWarp] = useState<WarpEffect>({
    style: 'flag',
    bend: 45,
    distortH: 0,
    distortV: 0,
  });
  const [zigzag, setZigzag] = useState<Extract<DistortEffect, { kind: 'zigzag' }>>({
    kind: 'zigzag',
    size: 8,
    ridges: 5,
    smooth: false,
  });
  const [roughen, setRoughen] = useState<Extract<DistortEffect, { kind: 'roughen' }>>({
    kind: 'roughen',
    size: 6,
    detail: 4,
    seed: 1,
  });
  const [roundRadius, setRoundRadius] = useState(16);
  const [effect3d, setEffect3d] = useState<Effect3D>({
    kind: 'extrude',
    rotateX: 18,
    rotateY: -22,
    rotateZ: 0,
    perspective: 45,
    depth: 36,
    shade: 0.7,
  });
  const [blur, setBlur] = useState(8);
  const [dropShadow, setDropShadow] = useState<DropShadowEffect>({
    color: '#000000',
    opacity: 0.35,
    offsetX: 6,
    offsetY: 10,
    blur: 12,
  });
  const [outerGlow, setOuterGlow] = useState<OuterGlowEffect>({
    color: '#da7756',
    opacity: 0.65,
    blur: 14,
  });

  const isVectorKind = useMemo(
    () =>
      target !== null &&
      target.kind !== 'blur' &&
      target.kind !== 'dropShadow' &&
      target.kind !== 'outerGlow',
    [target]
  );

  const hasTextSelected = useMemo(() => {
    const layers = useEditorStore.getState().scene.layers;
    const idSet = new Set(selectedIds);
    return layers.some((l) => idSet.has(l.id) && l.type === 'text');
  }, [selectedIds]);

  // Захватываем исходное состояние эффектов при открытии
  useEffect(() => {
    if (!target || selectedIds.length === 0) return;
    const state = useEditorStore.getState();
    const idSet = new Set(selectedIds);
    const snap = new Map<string, LayerEffects | undefined>();
    const activeIds: string[] = [];

    let firstLayer: Layer | undefined;
    for (const l of state.scene.layers) {
      if (!idSet.has(l.id)) continue;
      if (!firstLayer) firstLayer = l;
      snap.set(l.id, l.effects ? structuredClone(l.effects) : undefined);
      activeIds.push(l.id);
    }
    snapshotRef.current = snap;
    previewIdsRef.current = activeIds;

    const existing = firstLayer?.effects;
    if (target.kind === 'warp') {
      setWarp(
        existing?.warp ?? {
          style: target.initialWarpStyle ?? 'flag',
          bend: 45,
          distortH: 0,
          distortV: 0,
        }
      );
      if (target.initialWarpStyle && existing?.warp) {
        setWarp({ ...existing.warp, style: target.initialWarpStyle });
      }
    } else if (target.kind === 'zigzag') {
      setZigzag(
        existing?.distort?.kind === 'zigzag'
          ? existing.distort
          : { kind: 'zigzag', size: 8, ridges: 5, smooth: false }
      );
    } else if (target.kind === 'roughen') {
      setRoughen(
        existing?.distort?.kind === 'roughen'
          ? existing.distort
          : { kind: 'roughen', size: 6, detail: 4, seed: 1 }
      );
    } else if (target.kind === 'roundCorners') {
      setRoundRadius(
        existing?.distort?.kind === 'roundCorners' ? existing.distort.radius : 16
      );
    } else if (target.kind === '3d-rotate' || target.kind === '3d-extrude') {
      const defKind = target.kind === '3d-extrude' ? 'extrude' : 'rotate';
      setEffect3d(
        existing?.effect3d
          ? { ...existing.effect3d, kind: defKind }
          : {
              kind: defKind,
              rotateX: 18,
              rotateY: -22,
              rotateZ: 0,
              perspective: 45,
              depth: defKind === 'extrude' ? 36 : 0,
              shade: 0.7,
            }
      );
    } else if (target.kind === 'blur') {
      setBlur(existing?.blur ?? 8);
    } else if (target.kind === 'dropShadow') {
      setDropShadow(
        existing?.dropShadow ?? {
          color: '#000000',
          opacity: 0.35,
          offsetX: 6,
          offsetY: 10,
          blur: 12,
        }
      );
    } else if (target.kind === 'outerGlow') {
      setOuterGlow(
        existing?.outerGlow ?? {
          color: '#da7756',
          opacity: 0.65,
          blur: 14,
        }
      );
    }
  }, [target, selectedIds]);

  const currentPatch: Partial<LayerEffects> | null = useMemo(() => {
    if (!target) return null;
    switch (target.kind) {
      case 'warp':
        return { warp };
      case 'zigzag':
        return { distort: zigzag };
      case 'roughen':
        return { distort: roughen };
      case 'roundCorners':
        return { distort: { kind: 'roundCorners', radius: roundRadius } };
      case '3d-rotate':
      case '3d-extrude':
        return { effect3d };
      case 'blur':
        return { blur };
      case 'dropShadow':
        return { dropShadow };
      case 'outerGlow':
        return { outerGlow };
    }
  }, [blur, dropShadow, effect3d, outerGlow, roughen, roundRadius, target, warp, zigzag]);

  // Живой предпросмотр без записи в Undo-историю
  useEffect(() => {
    if (!target || !currentPatch || previewIdsRef.current.length === 0) return;
    const temporal = useEditorStore.temporal.getState();
    temporal.pause();
    const idSet = new Set(previewIdsRef.current);
    useEditorStore.setState((state) => ({
      scene: {
        ...state.scene,
        layers: state.scene.layers.map((layer) => {
          if (!idSet.has(layer.id)) return layer;
          const base = snapshotRef.current.get(layer.id) ?? {};
          return { ...layer, effects: { ...base, ...currentPatch } };
        }),
      },
    }));
    temporal.resume();
  }, [currentPatch, target]);

  const restoreSnapshot = () => {
    const snap = snapshotRef.current;
    if (snap.size === 0) return;
    const temporal = useEditorStore.temporal.getState();
    temporal.pause();
    useEditorStore.setState((state) => ({
      scene: {
        ...state.scene,
        layers: state.scene.layers.map((layer) => {
          if (!snap.has(layer.id)) return layer;
          const orig = snap.get(layer.id);
          if (!orig) {
            const copy = { ...layer };
            delete copy.effects;
            return copy;
          }
          return { ...layer, effects: orig };
        }),
      },
    }));
    temporal.resume();
  };

  const handleCancel = () => {
    restoreSnapshot();
    onClose();
  };

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!target) return null;

  const handleApply = async () => {
    if (!currentPatch) return;
    restoreSnapshot();

    let applyIds = [...previewIdsRef.current];
    if (isVectorKind && hasTextSelected) {
      const converted = await convertTextLayersToOutlines(applyIds);
      const convertedIds = converted.map((l) => l.id);
      const currentSceneIds = new Set(
        useEditorStore.getState().scene.layers.map((l) => l.id)
      );
      applyIds = [
        ...applyIds.filter((id) => currentSceneIds.has(id)),
        ...convertedIds,
      ];
    }

    updateLayerEffects(applyIds, currentPatch);
    onApplied?.(TITLES[target.kind]);
    onClose();
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-lg border border-paper-border bg-paper-panel text-paper-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-paper-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-paper-accent" strokeWidth={1.75} />
            <h2 className="text-[13px] font-semibold">{TITLES[target.kind]}</h2>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {isVectorKind && hasTextSelected && (
            <p className="rounded border border-paper-border bg-paper-bg px-2.5 py-1.5 text-[11px] text-paper-muted">
              Текстовый слой при применении будет преобразован в векторные кривые.
            </p>
          )}

          {target.kind === 'warp' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Стиль деформации</span>
                <Select
                  value={warp.style}
                  options={WARP_STYLES}
                  ariaLabel="Стиль деформации"
                  onChange={(value) =>
                    setWarp({ ...warp, style: value as WarpStyle })
                  }
                />
              </div>
              <SliderRow
                label="Изгиб"
                value={warp.bend}
                min={-100}
                max={100}
                unit="%"
                onChange={(bend) => setWarp({ ...warp, bend })}
              />
              <SliderRow
                label="Искажение по горизонтали"
                value={warp.distortH}
                min={-100}
                max={100}
                unit="%"
                onChange={(distortH) => setWarp({ ...warp, distortH })}
              />
              <SliderRow
                label="Искажение по вертикали"
                value={warp.distortV}
                min={-100}
                max={100}
                unit="%"
                onChange={(distortV) => setWarp({ ...warp, distortV })}
              />
            </>
          )}

          {target.kind === 'zigzag' && (
            <>
              <SliderRow
                label="Размер"
                value={zigzag.size}
                min={1}
                max={50}
                unit=" px"
                onChange={(size) => setZigzag({ ...zigzag, size })}
              />
              <SliderRow
                label="Складок на сегмент"
                value={zigzag.ridges}
                min={1}
                max={20}
                onChange={(ridges) => setZigzag({ ...zigzag, ridges })}
              />
              <Checkbox
                checked={zigzag.smooth}
                onChange={(smooth) => setZigzag({ ...zigzag, smooth })}
                label="Сглаженные волны"
              />
            </>
          )}

          {target.kind === 'roughen' && (
            <>
              <SliderRow
                label="Размер"
                value={roughen.size}
                min={1}
                max={40}
                unit=" px"
                onChange={(size) => setRoughen({ ...roughen, size })}
              />
              <SliderRow
                label="Детализация"
                value={roughen.detail}
                min={1}
                max={15}
                onChange={(detail) => setRoughen({ ...roughen, detail })}
              />
              <SliderRow
                label="Вариант (seed)"
                value={roughen.seed}
                min={1}
                max={50}
                onChange={(seed) => setRoughen({ ...roughen, seed })}
              />
            </>
          )}

          {target.kind === 'roundCorners' && (
            <SliderRow
              label="Радиус скругления"
              value={roundRadius}
              min={0}
              max={80}
              unit=" px"
              onChange={setRoundRadius}
            />
          )}

          {(target.kind === '3d-rotate' || target.kind === '3d-extrude') && (
            <>
              <SliderRow
                label="Наклон X"
                value={effect3d.rotateX}
                min={-75}
                max={75}
                unit="°"
                onChange={(rotateX) => setEffect3d({ ...effect3d, rotateX })}
              />
              <SliderRow
                label="Поворот Y"
                value={effect3d.rotateY}
                min={-75}
                max={75}
                unit="°"
                onChange={(rotateY) => setEffect3d({ ...effect3d, rotateY })}
              />
              <SliderRow
                label="Поворот Z"
                value={effect3d.rotateZ}
                min={-180}
                max={180}
                unit="°"
                onChange={(rotateZ) => setEffect3d({ ...effect3d, rotateZ })}
              />
              <SliderRow
                label="Перспектива"
                value={effect3d.perspective}
                min={0}
                max={100}
                unit="%"
                onChange={(perspective) => setEffect3d({ ...effect3d, perspective })}
              />
              {target.kind === '3d-extrude' && (
                <>
                  <SliderRow
                    label="Глубина выдавливания"
                    value={effect3d.depth}
                    min={0}
                    max={120}
                    unit=" px"
                    onChange={(depth) => setEffect3d({ ...effect3d, depth })}
                  />
                  <SliderRow
                    label="Интенсивность теней"
                    value={Math.round(effect3d.shade * 100)}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(v) => setEffect3d({ ...effect3d, shade: v / 100 })}
                  />
                </>
              )}
            </>
          )}

          {target.kind === 'blur' && (
            <SliderRow
              label="Радиус размытия"
              value={blur}
              min={0}
              max={60}
              step={0.5}
              unit=" px"
              onChange={setBlur}
            />
          )}

          {target.kind === 'dropShadow' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Цвет тени</span>
                <HexColorRow
                  value={dropShadow.color}
                  onChange={(color) => setDropShadow({ ...dropShadow, color })}
                />
              </div>
              <SliderRow
                label="Непрозрачность"
                value={Math.round(dropShadow.opacity * 100)}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => setDropShadow({ ...dropShadow, opacity: v / 100 })}
              />
              <SliderRow
                label="Смещение X"
                value={dropShadow.offsetX}
                min={-60}
                max={60}
                unit=" px"
                onChange={(offsetX) => setDropShadow({ ...dropShadow, offsetX })}
              />
              <SliderRow
                label="Смещение Y"
                value={dropShadow.offsetY}
                min={-60}
                max={60}
                unit=" px"
                onChange={(offsetY) => setDropShadow({ ...dropShadow, offsetY })}
              />
              <SliderRow
                label="Размытие"
                value={dropShadow.blur}
                min={0}
                max={50}
                unit=" px"
                onChange={(blurVal) => setDropShadow({ ...dropShadow, blur: blurVal })}
              />
            </>
          )}

          {target.kind === 'outerGlow' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Цвет свечения</span>
                <HexColorRow
                  value={outerGlow.color}
                  onChange={(color) => setOuterGlow({ ...outerGlow, color })}
                />
              </div>
              <SliderRow
                label="Непрозрачность"
                value={Math.round(outerGlow.opacity * 100)}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => setOuterGlow({ ...outerGlow, opacity: v / 100 })}
              />
              <SliderRow
                label="Радиус свечения"
                value={outerGlow.blur}
                min={0}
                max={50}
                unit=" px"
                onChange={(blurVal) => setOuterGlow({ ...outerGlow, blur: blurVal })}
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-paper-border px-4 py-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="h-7 rounded border border-paper-border px-3 text-[12px] text-paper-ink hover:bg-paper-hover"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            className="h-7 rounded bg-paper-accent px-3.5 text-[12px] font-medium text-white hover:opacity-90"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
