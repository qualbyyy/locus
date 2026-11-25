import { beforeEach, describe, expect, it } from 'vitest';
import { clearAssets, getAsset } from '../src/core/assets';
import {
  addLayers,
  combineCompoundPathLayers,
  createShapeLayer,
  createTextLayer,
  resetDocument,
  setClipMask,
  undoCommand,
  updateLayers,
} from '../src/core/commands';
import { computeCombinedWorldBBox, computeLayerWorldBBox } from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { ImageLayer, PathLayer, TextLayer } from '../src/core/types';
import { parseSvgToLayers } from '../src/export/importSvg';
import { sceneToSvg } from '../src/export/toSvg';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('SVG import to editable Locus layers', () => {
  beforeEach(() => {
    clearAssets();
    resetDocument({
      name: 'SVG Import Test',
      width: 1000,
      height: 1000,
      dpi: 72,
      background: '#ffffff',
    });
  });

  it('imports basic shapes and keeps line without fill', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect id="card" x="10" y="10" width="80" height="40" rx="8" fill="#da7756" stroke="#1c1b1a" stroke-width="2"/>
      <circle cx="140" cy="40" r="20" fill="#2563eb"/>
      <ellipse cx="50" cy="120" rx="30" ry="15" fill="#16a34a"/>
      <polygon points="120,90 160,90 140,140" fill="#f59e0b"/>
      <line id="divider" x1="20" y1="170" x2="180" y2="170" stroke="#112233" stroke-width="4" stroke-linecap="square" stroke-linejoin="bevel"/>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(5);
    expect(result.layers.every((l) => l.type === 'path')).toBe(true);

    const card = result.layers[0] as PathLayer;
    expect(card.name).toBe('card');
    expect(card.fill).toBe('#da7756');
    expect(card.stroke?.color).toBe('#1c1b1a');
    expect(card.stroke?.width).toBe(2);
    expect(card.subpaths[0].closed).toBe(true);

    const line = result.layers[4] as PathLayer;
    expect(line.name).toBe('divider');
    expect(line.fill).toBeNull();
    expect(line.stroke).toEqual({
      color: '#112233',
      width: 4,
      lineCap: 'square',
      lineJoin: 'bevel',
    });
    expect(line.subpaths[0].closed).toBe(false);
    expect(line.subpaths[0].anchors).toHaveLength(2);
  });

  it('inlines <style>, resolves currentColor/named colors, and imports linear gradients', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" color="#334155">
      <defs>
        <linearGradient id="g1"><stop offset="0%" stop-color="#ec4899"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient>
      </defs>
      <style>
        .box { fill: red; stroke: currentColor; stroke-width: 3; }
      </style>
      <rect class="box" style="fill: #e11d48;" x="10" y="10" width="40" height="40"/>
      <rect class="box" x="60" y="10" width="40" height="40"/>
      <rect x="110" y="10" width="40" height="40" fill="transparent" stroke="red" stroke-width="2"/>
      <rect x="10" y="70" width="80" height="40" fill="url(#g1)"/>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(4);

    const inlineOverride = result.layers[0] as PathLayer;
    expect(inlineOverride.fill).toBe('#e11d48');
    expect(inlineOverride.stroke?.color).toBe('#334155');
    expect(inlineOverride.stroke?.width).toBe(3);

    const styledBox = result.layers[1] as PathLayer;
    expect(styledBox.fill).toBe('#ff0000');
    expect(styledBox.stroke?.color).toBe('#334155');

    const transparentFill = result.layers[2] as PathLayer;
    expect(transparentFill.fill).toBeNull();
    expect(transparentFill.stroke?.color).toBe('#ff0000');

    const gradBox = result.layers[3] as PathLayer;
    expect(typeof gradBox.fill).toBe('object');
    expect(gradBox.fill).toMatchObject({
      kind: 'linear',
      stops: [
        { offset: 0, color: '#ec4899' },
        { offset: 1, color: '#8b5cf6' },
      ],
    });
  });

  it('scales viewBox coordinates and stroke widths without creating root clip mask layers', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2">
      <rect x="2" y="4" width="20" height="16"/>
    </svg>`;
    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(1);
    const rect = result.layers[0] as PathLayer;
    expect(rect.isClipMask).toBeFalsy();
    const bbox = computeLayerWorldBBox(rect);
    expect(bbox.x).toBeCloseTo(20, 1);
    expect(bbox.y).toBeCloseTo(40, 1);
    expect(bbox.width).toBeCloseTo(200, 1);
    expect(bbox.height).toBeCloseTo(160, 1);
    expect(rect.stroke?.width).toBeCloseTo(20, 1);

    const percentSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="12" fill="#000"/>
    </svg>`;
    const percentRes = await parseSvgToLayers(percentSvg);
    expect(percentRes.sourceWidth).toBe(48);
    expect(percentRes.sourceHeight).toBe(48);
    expect(percentRes.layers).toHaveLength(1);
    const circleBBox = computeLayerWorldBBox(percentRes.layers[0]);
    expect(circleBBox.width).toBeCloseTo(24, 1);
  });

  it('preserves CompoundPath holes, nested group transforms, and opacity', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
      <g opacity="0.5" transform="translate(50, 40) scale(2) rotate(90)">
        <path d="M 0 0 L 20 0 L 20 20 L 0 20 Z M 5 5 L 15 5 L 15 15 L 5 15 Z" fill-rule="evenodd" fill="#111111" fill-opacity="0.8"/>
      </g>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(1);
    const compound = result.layers[0] as PathLayer;
    expect(compound.subpaths).toHaveLength(2);
    expect(compound.fillRule).toBe('evenodd');
    expect(compound.opacity).toBeCloseTo(0.4, 2);
    const bbox = computeLayerWorldBBox(compound);
    expect(bbox.width).toBeCloseTo(40, 1);
    expect(bbox.height).toBeCloseTo(40, 1);
    expect(bbox.x).toBeCloseTo(10, 1);
    expect(bbox.y).toBeCloseTo(40, 1);
  });

  it('places <clipPath> mask layer above masked layers and links clipMaskId', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <defs>
        <clipPath id="circleMask"><circle cx="100" cy="100" r="40"/></clipPath>
      </defs>
      <g clip-path="url(#circleMask)">
        <rect x="40" y="40" width="120" height="120" fill="#da7756"/>
        <rect x="60" y="60" width="80" height="80" fill="#1c1b1a"/>
      </g>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(3);
    const masked1 = result.layers[0] as PathLayer;
    const masked2 = result.layers[1] as PathLayer;
    const mask = result.layers[2] as PathLayer;

    expect(mask.isClipMask).toBe(true);
    expect(mask.fill).toBeNull();
    expect(mask.stroke).toBeNull();
    expect(masked1.clipMaskId).toBe(mask.id);
    expect(masked2.clipMaskId).toBe(mask.id);
  });

  it('imports Cyrillic <text> with <tspan>, font matching, weight, alignment, and baseline offset', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <text x="200" y="117" font-family="'Golos Text', sans-serif" font-size="20" font-weight="700" text-anchor="middle" letter-spacing="1.5" fill="#1c1b1a"><tspan x="200" y="117">Привет</tspan><tspan x="200" y="147">Мир</tspan></text>
      <text x="20" y="216" font-family="Unknown Custom Font" font-size="16" fill="#333333">Fallback</text>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(2);

    const t1 = result.layers[0] as TextLayer;
    expect(t1.type).toBe('text');
    expect(t1.content).toBe('Привет\nМир');
    expect(t1.fontFamily).toBe('Golos Text');
    expect(t1.fontWeight).toBe(700);
    expect(t1.fontSize).toBe(20);
    expect(t1.align).toBe('center');
    expect(t1.lineHeight).toBe(1.5);
    expect(t1.letterSpacing).toBe(1.5);
    expect(t1.x).toBeCloseTo(200, 1);
    expect(t1.y).toBeCloseTo(100, 1);

    const t2 = result.layers[1] as TextLayer;
    expect(t2.fontFamily).toBe('Inter');
    expect(t2.fontWeight).toBe(400);
    expect(t2.align).toBe('left');
  });

  it('registers embedded data:image/* as ImageLayer and skips external http images with warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <image id="logoImg" href="data:image/png;base64,${TINY_PNG_BASE64}" x="20" y="30" width="80" height="60"/>
      <image href="https://example.com/photo.png" x="120" y="30" width="80" height="60"/>
    </svg>`;

    const result = await parseSvgToLayers(svg);
    expect(result.layers).toHaveLength(1);
    const img = result.layers[0] as ImageLayer;
    expect(img.type).toBe('image');
    expect(img.name).toBe('logoImg');
    expect(img.x).toBeCloseTo(60, 1);
    expect(img.y).toBeCloseTo(60, 1);
    expect(img.width * img.scaleX).toBeCloseTo(80, 1);
    expect(img.height * img.scaleY).toBeCloseTo(60, 1);
    expect(getAsset(img.assetId)).toBeDefined();
    expect(result.warnings).toContain('Внешние изображения в SVG пропущены');
  });

  it('fits oversized SVGs to 85% of targetArtboard and centers smaller SVGs without stretching', async () => {
    const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000" viewBox="0 0 3000 2000">
      <rect x="0" y="0" width="3000" height="2000" fill="#da7756" stroke="#000" stroke-width="10"/>
    </svg>`;

    const largeRes = await parseSvgToLayers(largeSvg, {
      targetArtboard: { width: 1000, height: 1000 },
    });
    const largeBBox = computeCombinedWorldBBox(largeRes.layers);
    expect(largeBBox.width).toBeCloseTo(850, 1);
    expect(largeBBox.x + largeBBox.width / 2).toBeCloseTo(500, 1);
    expect(largeBBox.y + largeBBox.height / 2).toBeCloseTo(500, 1);

    const smallSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect x="10" y="10" width="100" height="60" fill="#2563eb"/>
    </svg>`;
    const smallRes = await parseSvgToLayers(smallSvg, {
      targetArtboard: { width: 1000, height: 1000 },
    });
    const smallBBox = computeCombinedWorldBBox(smallRes.layers);
    expect(smallBBox.width).toBeCloseTo(100, 1);
    expect(smallBBox.height).toBeCloseTo(60, 1);
    expect(smallBBox.x + smallBBox.width / 2).toBeCloseTo(500, 1);
    expect(smallBBox.y + smallBBox.height / 2).toBeCloseTo(500, 1);
  });

  it('round-trips sceneToSvg output back into editable paths, compound paths, masks, and text', async () => {
    const outer = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 160,
      height: 160,
      fill: '#da7756',
      stroke: null,
    });
    const inner = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 60,
      height: 60,
      fill: '#ffffff',
      stroke: null,
    });
    const compound = combineCompoundPathLayers([outer.id, inner.id]);
    expect(compound).not.toBeNull();

    const maskShape = createShapeLayer({
      preset: 'ellipse',
      x: 200,
      y: 200,
      width: 140,
      height: 140,
      fill: '#000000',
      stroke: null,
    });
    setClipMask(maskShape.id, [compound!.id]);

    const text = createTextLayer({
      content: 'Заголовок\nВторая строка',
      x: 400,
      y: 300,
      fontSize: 24,
      fontFamily: 'Manrope',
      fontWeight: 700,
      fill: '#1c1b1a',
      align: 'center',
    });
    updateLayers([text.id], { lineHeight: 1.25 });

    const svg = await sceneToSvg(useEditorStore.getState().scene, {
      includeBackground: false,
    });
    const imported = await parseSvgToLayers(svg);

    const paths = imported.layers.filter((l): l is PathLayer => l.type === 'path');
    const texts = imported.layers.filter((l): l is TextLayer => l.type === 'text');

    expect(paths.some((p) => p.subpaths.length === 2)).toBe(true);
    expect(paths.some((p) => p.isClipMask)).toBe(true);
    expect(paths.some((p) => Boolean(p.clipMaskId))).toBe(true);

    expect(texts).toHaveLength(1);
    expect(texts[0].content).toBe('Заголовок\nВторая строка');
    expect(texts[0].fontFamily).toBe('Manrope');
    expect(texts[0].fontWeight).toBe(700);
    expect(texts[0].align).toBe('center');
    expect(texts[0].x).toBeCloseTo(400, 1);
    expect(texts[0].y).toBeCloseTo(300, 1);
  });

  it('commits all imported SVG layers in one Undo step via addLayers', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect x="10" y="10" width="40" height="40" fill="#111"/>
      <circle cx="100" cy="100" r="30" fill="#222"/>
      <text x="10" y="180" font-size="16" fill="#333">Test</text>
    </svg>`;

    const imported = await parseSvgToLayers(svg);
    expect(imported.layers).toHaveLength(3);

    addLayers(imported.layers);
    expect(useEditorStore.getState().scene.layers).toHaveLength(3);
    expect(useEditorStore.getState().selectedIds).toHaveLength(3);

    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(0);
  });

  it('rejects invalid XML and returns empty layers for empty <svg>', async () => {
    await expect(parseSvgToLayers('')).rejects.toThrow();
    await expect(parseSvgToLayers('<div>not svg</div>')).rejects.toThrow();
    await expect(parseSvgToLayers('<svg><rect></svg>')).rejects.toThrow();

    const empty = await parseSvgToLayers(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'
    );
    expect(empty.layers).toEqual([]);
  });
});
