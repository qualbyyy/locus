import {
  Copy,
  Crop,
  Download,
  FileCode2,
  FolderOpen,
  SlidersHorizontal,
  Trash2,
  Ungroup,
  Unlink,
} from 'lucide-react';
import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import type { AlignMode, TextCaseMode, TextSplitMode } from '../core/commands';
import type { ExportKind } from '../core/documentFile';
import { findLayerById, flattenLayers, getParentGroupId, getScopeLayers } from '../core/layerTree';
import type {
  Artboard,
  Layer,
  LayerEffects,
  PathLayer,
  Scene,
  SmartShapeOptions,
  ToolType,
} from '../core/types';
import type { BooleanOp } from '../engine/booleans';
import type { ImageTraceOptions } from '../engine/imageTrace';
import { collectDocumentColors, InspectorAppearance } from './inspector/InspectorAppearance';
import { InspectorArtboard } from './inspector/InspectorArtboard';
import { InspectorEffects, type EffectTarget } from './inspector/InspectorEffects';
import { InspectorImageTrace } from './inspector/InspectorImageTrace';
import { InspectorMultiSelect } from './inspector/InspectorMultiSelect';
import { InspectorText } from './inspector/InspectorText';
import { InspectorToolOptions } from './inspector/InspectorToolOptions';
import { InspectorTransform } from './inspector/InspectorTransform';
import { InspectorVectorOps } from './inspector/InspectorVectorOps';

interface InspectorProps {
  scene: Scene;
  selectedIds: string[];
  activeArtboardId: string;
  activeTool: ToolType;
  smartShapeOptions: SmartShapeOptions;
  pencilSmoothness: number;
  onChangeSmartShapeOptions: (patch: Partial<SmartShapeOptions>) => void;
  onChangePencilSmoothness: (val: number) => void;
  onSelectArtboard: (artboardId: string) => void;
  onAddArtboard: () => void;
  onDuplicateArtboard: (artboardId: string) => void;
  onDeleteArtboard: (artboardId: string) => void;
  onUpdateArtboard: (
    patch: Partial<Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>> & {
      dpi?: number;
    }
  ) => void;
  onExportArtboard?: (kind: ExportKind, artboardId: string) => void;
  onImportBackgroundImage: () => void;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onGroupLayers: (layerIds: string[]) => void;
  onUngroupLayers: (layerIds: string[]) => void;
  onEnterGroup: (groupId: string | null) => void;
  onUploadFont: () => void;
  onSmoothLayers: (layerIds: string[]) => void;
  onWobbleLayers: (layerIds: string[], intensity: number) => void;
  onDuplicateLayers: (layerIds: string[]) => void;
  onDeleteLayers: (layerIds: string[]) => void;
  onReorderLayer: (
    layerId: string,
    mode: 'front' | 'back' | 'forward' | 'backward'
  ) => void;
  onAlignLayers: (layerIds: string[], mode: AlignMode) => void;
  onFlipLayers: (layerIds: string[], axis: 'horizontal' | 'vertical') => void;
  onBooleanOp: (layerIds: string[], operation: BooleanOp) => void;
  onCreateClipMask: (layerIds: string[]) => void;
  onReleaseClipMask: (maskId: string) => void;
  onDetachFromMask: (layerId: string) => void;
  onReplaceImage: (layerId: string) => void;
  onTraceImage: (layerId: string, options: Partial<ImageTraceOptions>) => void;
  onEditTextOnCanvas: (layerId: string) => void;
  onTransformTextCase: (layerIds: string[], mode: TextCaseMode) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
  onSplitText?: (layerIds: string[], mode: TextSplitMode) => void;
  onAttachTextToPath: (textLayerId: string, pathLayerId: string) => void;
  onDetachTextFromPath: (textLayerId: string) => void;
  onApplyTextPathArc?: (textLayerId: string, arc: 'top' | 'bottom') => void;
  onCreateTextOnPath?: (pathLayerId: string) => void;
  onSplitCompound: (layerIds: string[]) => void;
  onCombineCompound: (layerIds: string[]) => void;
  onOffsetLayers: (layerIds: string[], distance: number, copyBehind: boolean) => void;
  onOutlineStroke: (layerIds: string[]) => void;
  onSimplifyLayers: (layerIds: string[]) => void;
  focusedEffect: EffectTarget | null;
  onConsumeFocusedEffect: () => void;
  onUpdateEffects: (layerIds: string[], patch: Partial<LayerEffects> | null) => void;
  onExpandAppearance: (layerIds: string[]) => void;
  onCopySvg: () => void;
  onExportSelectionRaster: () => void;
}

export function Inspector({
  scene,
  selectedIds,
  activeArtboardId,
  activeTool,
  smartShapeOptions,
  pencilSmoothness,
  onChangeSmartShapeOptions,
  onChangePencilSmoothness,
  onSelectArtboard,
  onAddArtboard,
  onDuplicateArtboard,
  onDeleteArtboard,
  onUpdateArtboard,
  onExportArtboard,
  onImportBackgroundImage,
  onUpdateLayers,
  onGroupLayers,
  onUngroupLayers,
  onEnterGroup,
  onUploadFont,
  onSmoothLayers,
  onWobbleLayers,
  onDuplicateLayers,
  onDeleteLayers,
  onReorderLayer,
  onAlignLayers,
  onFlipLayers,
  onBooleanOp,
  onCreateClipMask,
  onReleaseClipMask,
  onDetachFromMask,
  onReplaceImage,
  onTraceImage,
  onEditTextOnCanvas,
  onTransformTextCase,
  onConvertToOutlines,
  onSplitText,
  onAttachTextToPath,
  onDetachTextFromPath,
  onApplyTextPathArc,
  onCreateTextOnPath,
  onSplitCompound,
  onCombineCompound,
  onOffsetLayers,
  onOutlineStroke,
  onSimplifyLayers,
  focusedEffect,
  onConsumeFocusedEffect,
  onUpdateEffects,
  onExpandAppearance,
  onCopySvg,
  onExportSelectionRaster,
}: InspectorProps) {
  const artboards = getSceneArtboards(scene);
  const activeArtboard = getActiveArtboard(scene, activeArtboardId);

  const selectedLayers: Layer[] = [];
  for (const id of selectedIds) {
    const found = findLayerById(scene.layers, id);
    if (found) selectedLayers.push(found);
  }
  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  const singleParentId = singleLayer ? getParentGroupId(scene.layers, singleLayer.id) : null;
  const singleScope = singleLayer ? getScopeLayers(scene.layers, singleParentId) : scene.layers;
  const singleIndex = singleLayer
    ? singleScope.findIndex((l) => l.id === singleLayer.id)
    : -1;

  const allFlatLayers = flattenLayers(scene.layers);
  const referencedMaskIds = new Set<string>();
  for (const layer of allFlatLayers) {
    if (layer.clipMaskId) {
      referencedMaskIds.add(layer.clipMaskId);
    }
  }
  const availablePaths = allFlatLayers
    .filter((l): l is PathLayer => l.type === 'path' && !l.locked)
    .map((l) => ({
      id: l.id,
      name: l.name,
      closed: l.subpaths.some((sp) => sp.closed),
    }));

  const isLayerActiveMask = (layer: Layer): boolean =>
    layer.type === 'path' &&
    (Boolean(layer.isClipMask) || referencedMaskIds.has(layer.id));

  const documentColors = collectDocumentColors(scene);

  return (
    <section
      data-tour="inspector.root"
      className="flex flex-1 flex-col overflow-y-auto bg-paper-panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-paper-border px-3">
        <SlidersHorizontal className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
        <span className="truncate text-[12px] font-semibold text-paper-ink">
          {selectedLayers.length === 0
            ? artboards.length > 1
              ? activeArtboard.name
              : 'Артборд'
            : selectedLayers.length === 1
              ? singleLayer?.name
              : `Выделено: ${selectedLayers.length}`}
        </span>
      </div>

      <InspectorToolOptions
        activeTool={activeTool}
        smartShapeOptions={smartShapeOptions}
        pencilSmoothness={pencilSmoothness}
        onChangeSmartShapeOptions={onChangeSmartShapeOptions}
        onChangePencilSmoothness={onChangePencilSmoothness}
      />

      {selectedLayers.length === 0 ? (
        <InspectorArtboard
          artboards={artboards}
          activeArtboard={activeArtboard}
          dpi={scene.dpi}
          onSelectArtboard={onSelectArtboard}
          onAddArtboard={onAddArtboard}
          onDuplicateArtboard={onDuplicateArtboard}
          onDeleteArtboard={onDeleteArtboard}
          onUpdateArtboard={onUpdateArtboard}
          onExportArtboard={onExportArtboard}
          onImportBackgroundImage={onImportBackgroundImage}
        />
      ) : singleLayer ? (
        <div className="flex flex-col gap-3 p-3">
          <InspectorTransform
            layer={singleLayer}
            layerIndex={singleIndex}
            totalLayers={singleScope.length}
            onUpdateLayers={onUpdateLayers}
            onAlignLayers={onAlignLayers}
            onFlipLayers={onFlipLayers}
            onReorderLayer={onReorderLayer}
          />

          {singleLayer.type === 'group' && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-paper-muted">Группа</span>
                <span className="font-display text-paper-ink">
                  {singleLayer.children.length} сл.
                </span>
              </div>
              <button
                type="button"
                onClick={() => onEnterGroup(singleLayer.id)}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <FolderOpen className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                <span>Войти в группу</span>
              </button>
              <button
                type="button"
                onClick={() => onUngroupLayers([singleLayer.id])}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <Ungroup className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                <span>Разгруппировать (Ctrl+Shift+G)</span>
              </button>
            </div>
          )}

          {singleLayer.type === 'path' && (
            <>
              <InspectorAppearance
                layer={singleLayer}
                documentColors={documentColors}
                onUpdateLayers={onUpdateLayers}
              />
              <InspectorVectorOps
                layer={singleLayer}
                onSmoothLayers={onSmoothLayers}
                onSimplifyLayers={onSimplifyLayers}
                onWobbleLayers={onWobbleLayers}
                onOffsetLayers={onOffsetLayers}
                onOutlineStroke={onOutlineStroke}
                onSplitCompound={onSplitCompound}
                onCreateTextOnPath={onCreateTextOnPath}
              />
            </>
          )}

          {singleLayer.type === 'text' && (
            <InspectorText
              layer={singleLayer}
              documentColors={documentColors}
              availablePaths={availablePaths}
              onUpdateLayers={onUpdateLayers}
              onEditTextOnCanvas={onEditTextOnCanvas}
              onTransformTextCase={onTransformTextCase}
              onConvertToOutlines={onConvertToOutlines}
              onSplitText={onSplitText}
              onAttachTextToPath={onAttachTextToPath}
              onDetachTextFromPath={onDetachTextFromPath}
              onApplyTextPathArc={onApplyTextPathArc}
              onUploadFont={onUploadFont}
            />
          )}

          {singleLayer.type === 'image' && (
            <InspectorImageTrace
              layer={singleLayer}
              onReplaceImage={onReplaceImage}
              onTraceImage={onTraceImage}
            />
          )}

          {(singleLayer.type === 'path' || singleLayer.clipMaskId) && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] font-medium text-paper-muted">
                Обтравочная маска
              </span>
              {singleLayer.type === 'path' &&
                (isLayerActiveMask(singleLayer) ? (
                  <button
                    type="button"
                    onClick={() => onReleaseClipMask(singleLayer.id)}
                    className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
                  >
                    <Unlink className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                    <span>Снять обтравочную маску</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={singleIndex <= 0}
                    onClick={() => onCreateClipMask([singleLayer.id])}
                    className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
                  >
                    <Crop className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                    <span>Сделать маской слоя ниже</span>
                  </button>
                ))}
              {singleLayer.clipMaskId && (
                <button
                  type="button"
                  onClick={() => onDetachFromMask(singleLayer.id)}
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
                >
                  <Unlink className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                  <span>Открепить от маски</span>
                </button>
              )}
            </div>
          )}

          <InspectorEffects
            layers={[singleLayer]}
            focusedEffect={focusedEffect}
            onConsumeFocus={onConsumeFocusedEffect}
            onUpdateEffects={onUpdateEffects}
            onExpandAppearance={onExpandAppearance}
          />

          <div data-tour="inspector.export" className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={onCopySvg}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <FileCode2 className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Копировать SVG</span>
            </button>
            <button
              type="button"
              onClick={onExportSelectionRaster}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <Download className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Экспорт PNG</span>
            </button>
          </div>

          <div className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={() => onDuplicateLayers([singleLayer.id])}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <Copy className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Дубль</span>
            </button>
            <button
              type="button"
              onClick={() => onDeleteLayers([singleLayer.id])}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-danger hover:bg-paper-hover"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      ) : (
        <InspectorMultiSelect
          selectedIds={selectedIds}
          selectedLayers={selectedLayers}
          documentColors={documentColors}
          isLayerActiveMask={isLayerActiveMask}
          focusedEffect={focusedEffect}
          onConsumeFocusedEffect={onConsumeFocusedEffect}
          onUpdateLayers={onUpdateLayers}
          onAlignLayers={onAlignLayers}
          onFlipLayers={onFlipLayers}
          onGroupLayers={onGroupLayers}
          onUngroupLayers={onUngroupLayers}
          onAttachTextToPath={onAttachTextToPath}
          onConvertToOutlines={onConvertToOutlines}
          onBooleanOp={onBooleanOp}
          onCombineCompound={onCombineCompound}
          onCreateClipMask={onCreateClipMask}
          onReleaseClipMask={onReleaseClipMask}
          onDetachFromMask={onDetachFromMask}
          onSmoothLayers={onSmoothLayers}
          onUpdateEffects={onUpdateEffects}
          onExpandAppearance={onExpandAppearance}
          onCopySvg={onCopySvg}
          onExportSelectionRaster={onExportSelectionRaster}
          onDuplicateLayers={onDuplicateLayers}
          onDeleteLayers={onDeleteLayers}
        />
      )}
    </section>
  );
}
