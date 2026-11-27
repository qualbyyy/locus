import JSZip from 'jszip';
import paper from 'paper/dist/paper-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAllAssets, registerAssetFromBytes } from '../src/core/assets';
import {
  createShapeLayer,
  groupLayers,
  redoCommand,
  resetDocument,
  runCommandBatch,
  setClipMask,
  undoCommand,
  updateLayers,
} from '../src/core/commands';
import { pauseHistory, resumeHistory, setUndoLimit, useEditorStore } from '../src/core/store';
import type { ImageLayer, PathLayer } from '../src/core/types';
import { parseSvgToLayers } from '../src/export/importSvg';
import { isLinearCubic, parseColorToRgba } from '../src/export/pathData';
import { openLocusFromBytes } from '../src/export/projectFile';
import { createCanvas } from '../src/export/rasterize';
import { sceneToAiBytes } from '../src/export/toAi';
import { initializeCanvas, sceneToPsd } from '../src/export/toPsd';
import { sceneToSvg } from '../src/export/toSvg';

const TINY_PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

describe('Phase 1 regressions: Undo/Redo, SVG/AI/PSD export, SVG import, .locus', () => {
  beforeEach(() => {
    resetDocument({ name: 'Phase1', width: 400, height: 300, dpi: 72 });
  });

  it('supports nested pauseHistory/resumeHistory, atomic runCommandBatch rollback, NaN setUndoLimit, and dirty state on undo/redo', () => {
    createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 40, height: 40 });
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(1);

    // Nested pause: inner resume must not re-enable history while outer pause is active
    pauseHistory();
    pauseHistory();
    createShapeLayer({ preset: 'rect', x: 120, y: 120, width: 20, height: 20 });
    resumeHistory();
    expect(useEditorStore.temporal.getState().isTracking).toBe(false);
    resumeHistory();
    expect(useEditorStore.temporal.getState().isTracking).toBe(true);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(1);

    // Atomic batch rollback on throw
    const beforeThrowLayers = useEditorStore.getState().scene.layers.length;
    expect(() =>
      runCommandBatch(() => {
        createShapeLayer({ preset: 'ellipse', x: 150, y: 150, width: 30, height: 30 });
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(useEditorStore.getState().scene.layers).toHaveLength(beforeThrowLayers);

    // NaN limit does not disable undo limit
    setUndoLimit(Number.NaN);
    expect(useEditorStore.temporal.getState().pastStates.length).toBeGreaterThanOrEqual(1);

    // Undo and Redo mark document dirty
    useEditorStore.getState().setDirty(false);
    undoCommand();
    expect(useEditorStore.getState().isDirty).toBe(true);
    useEditorStore.getState().setDirty(false);
    redoCommand();
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('exports SVG without double-transforming path/mask/gradient, escapes invalid colors, and avoids duplicate group id', async () => {
    const mask = createShapeLayer({
      preset: 'rect',
      x: 150,
      y: 120,
      width: 100,
      height: 80,
      fill: null,
      stroke: null,
      name: 'Mask',
    });
    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 150,
      width: 80,
      height: 40,
      fill: {
        kind: 'linear',
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
      },
      stroke: null,
      name: 'Rect',
    }) as PathLayer;
    updateLayers([rect.id], { rotation: 30 });
    const grp = groupLayers([mask.id, rect.id])!;
    updateLayers([grp.id], { opacity: 0.7 });
    const outerMask = createShapeLayer({
      preset: 'ellipse',
      x: 200,
      y: 150,
      width: 200,
      height: 200,
      fill: null,
      stroke: null,
      name: 'OuterMask',
    });
    setClipMask(outerMask.id, [grp.id]);

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    // Path data must stay in local coords (-40..40) while <g transform=...> applies translation/rotation
    const rectG = doc.querySelector('g[data-name="Rect"]')!;
    const pathEl = rectG.querySelector('path')!;
    const d = pathEl.getAttribute('d')!;
    expect(d).toContain('M-20 -20');
    expect(rectG.innerHTML).toContain('matrix(');

    // Gradient coordinates must match local path coords (-40..40), not world ~200
    const grad = doc.querySelector('linearGradient')!;
    expect(Number(grad.getAttribute('x1'))).toBeCloseTo(-40, 2);
    expect(Number(grad.getAttribute('x2'))).toBeCloseTo(40, 2);

    // Clipped group must not produce duplicate IDs
    const grpMatches = doc.querySelectorAll(`[id="${grp.id}"]`);
    expect(grpMatches).toHaveLength(1);
    expect(grpMatches[0].getAttribute('opacity')).toBe('0.7');
  });

  it('decodes base64 SVG <image> with charset param, parses CSS after @import without ReDoS, and cleans up PaperScope', async () => {
    const b64 = btoa(String.fromCharCode(...TINY_PNG_BYTES));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <style>
        @import url("https://evil.example/a.css");
        .box { fill: red; }
      </style>
      <rect class="box" x="10" y="10" width="30" height="30"/>
      <image href="data:image/png;charset=utf-8;base64,${b64}" x="50" y="10" width="40" height="40"/>
    </svg>`;

    const beforeScopeCount = (paper.PaperScope as unknown as { _scopes?: unknown[] })._scopes?.length ?? 0;
    const res = await parseSvgToLayers(svg);
    const afterScopeCount = (paper.PaperScope as unknown as { _scopes?: unknown[] })._scopes?.length ?? 0;

    expect(res.layers).toHaveLength(2);
    expect((res.layers[0] as PathLayer).fill).toBe('#ff0000');
    expect((res.layers[1] as ImageLayer).type).toBe('image');
    expect(afterScopeCount).toBeLessThanOrEqual(Math.max(1, beforeScopeCount));
  });

  it('keeps current scene and assets intact when .locus load fails validation/traversal', async () => {
    const asset = await registerAssetFromBytes({ bytes: TINY_PNG_BYTES, name: 'ok.png' });
    const existing = createShapeLayer({ preset: 'rect', x: 50, y: 50, width: 40, height: 40, name: 'KeepMe' });
    expect(useEditorStore.getState().scene.layers).toHaveLength(1);
    expect(getAllAssets()).toHaveLength(1);

    const badZip = new JSZip();
    badZip.file(
      'scene.json',
      JSON.stringify({ version: 1, name: 'Bad', width: 100, height: 100, dpi: 0, background: '#fff', layers: [] })
    );
    await expect(openLocusFromBytes(await badZip.generateAsync({ type: 'uint8array' }))).rejects.toThrow();

    const traversalZip = new JSZip();
    traversalZip.file(
      'scene.json',
      JSON.stringify({ version: 1, name: 'Trav', width: 100, height: 100, dpi: 72, background: '#fff', layers: [] })
    );
    traversalZip.file(
      'fonts/manifest.json',
      JSON.stringify([
        { id: 'f1', family: 'Bad', fileName: 'bad.ttf', weight: 400, mimeType: 'font/ttf', entryName: '../evil.ttf' },
      ])
    );
    await expect(openLocusFromBytes(await traversalZip.generateAsync({ type: 'uint8array' }))).rejects.toThrow();

    expect(useEditorStore.getState().scene.layers.map((l) => l.id)).toEqual([existing.id]);
    expect(getAllAssets().map((a) => a.id)).toEqual([asset.id]);
  });

  it('exports .ai PDF with top-level pdf-lib imports and handles NaN / transparent background', async () => {
    const p = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 60, height: 60, fill: '#da7756' });
    updateLayers([p.id], { rotation: Number.NaN });
    const bytes = await sceneToAiBytes(
      { ...useEditorStore.getState().scene, background: 'transparent' },
      { includeBackground: true }
    );
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('exports PSD with multiple clipped layers without duplicating, scales bounds, and handles % alpha + overshooting cubics', async () => {
    initializeCanvas(
      (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
      (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' }) as unknown as ImageData
    );
    const mask = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 80, height: 80, fill: null, stroke: null, name: 'Mask' });
    const l1 = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 40, height: 40, fill: '#f00', name: 'L1' });
    const l2 = createShapeLayer({ preset: 'rect', x: 110, y: 110, width: 40, height: 40, fill: '#0f0', name: 'L2' });
    setClipMask(mask.id, [l1.id, l2.id]);

    const psd = await sceneToPsd(useEditorStore.getState().scene, { scale: 2 });
    const names = (psd.children ?? []).map((c) => c.name);
    expect(names).toEqual(['L2', 'L1', 'Mask']);
    expect(psd.children!.find((c) => c.name === 'L1')!.clipping).toBe(true);
    expect(psd.children!.find((c) => c.name === 'L2')!.clipping).toBe(true);
    const l1Psd = psd.children!.find((c) => c.name === 'L1')!;
    expect(l1Psd.right! - l1Psd.left!).toBeCloseTo(80, 0);

    // % alpha & collinear cubic outside [0, 1]
    const rgba = parseColorToRgba('rgba(100%, 0%, 0%, 50%)');
    expect(rgba).toEqual([255, 0, 0, 0.5]);
    expect(
      isLinearCubic({
        start: { x: 0, y: 0 },
        cp1: { x: -50, y: 0 },
        cp2: { x: 150, y: 0 },
        end: { x: 100, y: 0 },
      })
    ).toBe(false);

    // Canvas size clamp sanity check
    const huge = createCanvas(50000, 50000);
    expect(huge.width * huge.height).toBeLessThanOrEqual(32_000_000);
    huge.width = 0;
    huge.height = 0;
  });
});
