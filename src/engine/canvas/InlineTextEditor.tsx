import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteLayers, updateLayers } from '../../core/commands';
import { findLayerById, getLayerWorldMatrix } from '../../core/layerTree';
import { applyMatrixToPoint, decomposeMatrix } from '../../core/math';
import { getPrimaryColor } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type { Scene, TextLayer } from '../../core/types';
import { computeTextOnPathLocalBBox, resolveHostPathLayer } from '../textOnPath';

export interface EditingTextState {
  layerId: string;
  draft: string;
  selectAll: boolean;
  caretIndex: number;
}

let textMeasureCtx: CanvasRenderingContext2D | null | undefined;

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (textMeasureCtx !== undefined) return textMeasureCtx;
  if (typeof document === 'undefined') {
    textMeasureCtx = null;
    return null;
  }
  try {
    textMeasureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    textMeasureCtx = null;
  }
  return textMeasureCtx;
}

function measureTextDraftWorldWidth(layer: TextLayer, draft: string): number {
  const lines = (draft || '').split('\n');
  const ctx = getTextMeasureContext();
  const tracking = layer.letterSpacing ?? 0;
  let maxW = layer.fontSize * 2.5;
  if (ctx) {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const w = ctx.measureText(line).width + trackingExtra;
      if (w > maxW) maxW = w;
    }
  } else {
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const w = line.length * layer.fontSize * 0.6 + trackingExtra;
      if (w > maxW) maxW = w;
    }
  }
  return maxW + layer.fontSize * 0.8;
}

export function useInlineTextEditing(scene: Scene) {
  const [editingText, setEditingText] = useState<EditingTextState | null>(null);
  const editingTextRef = useRef<EditingTextState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const committingTextRef = useRef(false);
  const lastFocusedTextIdRef = useRef<string | null>(null);

  editingTextRef.current = editingText;

  const commitTextEditing = useCallback(() => {
    if (committingTextRef.current) return;
    const current = editingTextRef.current;
    if (!current) return;
    committingTextRef.current = true;
    try {
      editingTextRef.current = null;
      setEditingText(null);
      const found = findLayerById(
        useEditorStore.getState().scene.layers,
        current.layerId
      );
      const layer = found?.type === 'text' ? found : null;
      if (!layer) return;
      if (current.draft.trim().length === 0) {
        deleteLayers([layer.id]);
      } else if (current.draft !== layer.content) {
        updateLayers([layer.id], { content: current.draft });
      }
    } finally {
      committingTextRef.current = false;
    }
  }, []);

  const startTextEditing = useCallback(
    (layerId: string, selectAll = false) => {
      if (
        editingTextRef.current &&
        editingTextRef.current.layerId !== layerId
      ) {
        commitTextEditing();
      }
      const found = findLayerById(
        useEditorStore.getState().scene.layers,
        layerId
      );
      const layer = found?.type === 'text' ? found : null;
      if (!layer || layer.locked) return;
      const nextState: EditingTextState = {
        layerId: layer.id,
        draft: layer.content,
        selectAll,
        caretIndex: layer.content.length,
      };
      editingTextRef.current = nextState;
      setEditingText(nextState);
    },
    [commitTextEditing]
  );

  useEffect(() => {
    if (!editingText) return;
    const found = findLayerById(scene.layers, editingText.layerId);
    if (!found || found.type !== 'text' || found.locked) {
      editingTextRef.current = null;
      setEditingText(null);
    }
  }, [editingText, scene]);

  useEffect(() => {
    if (!editingText) {
      lastFocusedTextIdRef.current = null;
      return;
    }
    if (lastFocusedTextIdRef.current === editingText.layerId) {
      return;
    }
    lastFocusedTextIdRef.current = editingText.layerId;
    const shouldSelectAll = editingText.selectAll;
    const raf = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (shouldSelectAll) {
        el.select();
      } else {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [editingText?.layerId]);

  return {
    editingText,
    setEditingText,
    editingTextRef,
    textareaRef,
    commitTextEditing,
    startTextEditing,
  };
}

interface InlineTextEditorProps {
  scope: paper.PaperScope | null;
  scene: Scene;
  editingText: EditingTextState | null;
  setEditingText: React.Dispatch<React.SetStateAction<EditingTextState | null>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  viewTick: number;
  commitTextEditing: () => void;
}

export function InlineTextEditor({
  scope,
  scene,
  editingText,
  setEditingText,
  textareaRef,
  viewTick,
  commitTextEditing,
}: InlineTextEditorProps) {
  void viewTick;
  if (!editingText || !scope) return null;

  const foundEditing = findLayerById(scene.layers, editingText.layerId);
  const editingLayer = foundEditing?.type === 'text' ? foundEditing : null;
  if (!editingLayer) return null;

  const zoom = Math.max(0.05, scope.view.zoom);
  const worldM = getLayerWorldMatrix(scene.layers, editingLayer.id);
  const worldTransform = decomposeMatrix(worldM);
  const hostPath = resolveHostPathLayer(scene.layers, editingLayer.pathId);
  const pathBox = hostPath
    ? computeTextOnPathLocalBBox(editingLayer, hostPath, scene.layers)
    : null;
  const lines = (editingText.draft || '').split('\n');
  const worldWidth = measureTextDraftWorldWidth(editingLayer, editingText.draft);
  const boxWidthPx = Math.max(80, worldWidth * zoom);
  const lineStepPx = editingLayer.fontSize * editingLayer.lineHeight * zoom;
  const boxHeightPx = Math.max(lineStepPx, lines.length * lineStepPx + 4);
  const anchorWorld = pathBox
    ? applyMatrixToPoint(worldM, {
        x: pathBox.x + pathBox.width / 2,
        y: pathBox.y + pathBox.height / 2 - lineStepPx / (2 * zoom),
      })
    : { x: worldTransform.x, y: worldTransform.y };
  const viewPt = scope.view.projectToView(
    new scope.Point(anchorWorld.x, anchorWorld.y)
  );
  const offsetX =
    pathBox || editingLayer.align === 'center'
      ? -boxWidthPx / 2
      : editingLayer.align === 'right'
        ? -boxWidthPx
        : 0;
  const originX = -offsetX;

  const isPathText = Boolean(hostPath);
  const syncCaretFromInput = (el: HTMLTextAreaElement) => {
    const nextIdx = el.selectionStart ?? el.value.length;
    setEditingText((prev) =>
      prev && prev.caretIndex !== nextIdx
        ? { ...prev, caretIndex: nextIdx, selectAll: false }
        : prev
    );
  };

  return (
    <textarea
      ref={textareaRef}
      value={editingText.draft}
      onChange={(e) => {
        const nextDraft = e.target.value;
        const nextCaret = e.target.selectionStart ?? nextDraft.length;
        setEditingText((prev) =>
          prev
            ? {
                ...prev,
                draft: nextDraft,
                selectAll: false,
                caretIndex: nextCaret,
              }
            : prev
        );
      }}
      onKeyUp={(e) => syncCaretFromInput(e.currentTarget)}
      onSelect={(e) => syncCaretFromInput(e.currentTarget)}
      onBlur={commitTextEditing}
      onKeyDown={(e) => {
        if (
          e.key === 'Escape' ||
          (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (isPathText && !e.shiftKey)))
        ) {
          e.preventDefault();
          e.stopPropagation();
          commitTextEditing();
        }
      }}
      spellCheck={false}
      style={
        isPathText
          ? {
              left: `${viewPt.x}px`,
              top: `${viewPt.y}px`,
              width: '2px',
              height: '20px',
              opacity: 0,
              pointerEvents: 'none',
            }
          : {
              left: `${viewPt.x + offsetX}px`,
              top: `${viewPt.y}px`,
              width: `${boxWidthPx}px`,
              height: `${boxHeightPx}px`,
              fontFamily: `"${editingLayer.fontFamily}", sans-serif`,
              fontWeight: editingLayer.fontWeight,
              fontSize: `${editingLayer.fontSize * zoom}px`,
              lineHeight: String(editingLayer.lineHeight),
              letterSpacing: `${(editingLayer.letterSpacing ?? 0) * zoom}px`,
              textAlign: editingLayer.align,
              color: getPrimaryColor(editingLayer.fill, '#1c1b1a'),
              transformOrigin: `${originX}px 0px`,
              transform: `rotate(${worldTransform.rotation}deg) scale(${worldTransform.scaleX}, ${worldTransform.scaleY})`,
              outline: '1px dashed var(--color-paper-accent)',
              outlineOffset: '2px',
            }
      }
      className="absolute z-20 m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0"
    />
  );
}
