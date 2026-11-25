import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, executeTool } from '../src/ai/registry';
import { resetDocument } from '../src/core/commands';
import { useEditorStore } from '../src/core/store';
import type { PathLayer } from '../src/core/types';

function sceneLayers() {
  return useEditorStore.getState().scene.layers;
}

const executed = new Set<string>();

function run(name: string, args: Record<string, unknown>) {
  const result = executeTool(name, args);
  if (!result.ok) {
    throw new Error(`${name}: ${result.error}`);
  }
  executed.add(name);
  return result.result;
}

function id(result: Record<string, unknown>): string {
  return String(result.layerId);
}

describe('AI tools smoke scenario', () => {
  beforeEach(() => {
    resetDocument();
    executed.clear();
  });

  it('executes all 31 tools in one realistic composition', () => {
    run('report_plan', {
      steps: 10,
      summary: 'Морда кота: голова, уши, глаза, нос, усы и подпись',
    });
    const head = run('create_blob', {
      name: 'Голова',
      x: 540,
      y: 620,
      radius: 230,
      points: 8,
      wobble: 0.15,
      fill: '#000000',
    });
    const earLeft = run('create_shape', {
      name: 'Ухо левое',
      preset: 'ellipse',
      x: 400,
      y: 320,
      width: 190,
      height: 230,
      fill: '#000000',
      rotation: -22,
    });
    const earRight = run('create_shape', {
      name: 'Ухо правое',
      preset: 'ellipse',
      x: 680,
      y: 320,
      width: 190,
      height: 230,
      fill: '#000000',
      rotation: 22,
    });
    const eyeLeft = run('create_shape', {
      name: 'Глаз левый',
      preset: 'ellipse',
      x: 465,
      y: 585,
      width: 72,
      height: 72,
      fill: '#ffffff',
    });
    const eyeRight = run('create_shape', {
      name: 'Глаз правый',
      preset: 'ellipse',
      x: 615,
      y: 585,
      width: 72,
      height: 72,
      fill: '#ffffff',
    });
    const nose = run('create_shape', {
      name: 'Нос',
      preset: 'polygon',
      x: 540,
      y: 670,
      width: 64,
      height: 54,
      points: 3,
      fill: '#da7756',
    });
    const whiskers = run('create_line', {
      name: 'Усы',
      points: [
        { x: 300, y: 660 },
        { x: 420, y: 690 },
        { x: 540, y: 700 },
        { x: 660, y: 690 },
        { x: 780, y: 660 },
      ],
      smooth: true,
      stroke: { color: '#ffffff', width: 5, lineCap: 'round' },
    });
    const label = run('create_text', {
      name: 'Подпись',
      content: 'LOCUS CAT',
      x: 540,
      y: 80,
      fontSize: 64,
      fontFamily: 'Unbounded',
      fontWeight: 700,
      align: 'center',
      fill: '#1c1b1a',
    });

    expect(sceneLayers()).toHaveLength(8);
    expect((sceneLayers().find((l) => l.id === id(whiskers)) as PathLayer).fill).toBeNull();

    run('update_layers', {
      layerIds: [id(label)],
      patch: { opacity: 0.85, letterSpacing: 6 },
    });
    const duplicates = run('duplicate_layers', {
      layerIds: [id(whiskers)],
      offsetX: 0,
      offsetY: 14,
    });
    expect(Array.isArray(duplicates.createdLayerIds)).toBe(true);

    run('reorder_layers', { layerId: id(head), mode: 'back' });
    expect(sceneLayers()[0].id).toBe(id(head));

    run('randomize_anchors', {
      layerIds: [id(head)],
      intensity: 2,
      seed: 11,
    });

    run('align_layers', {
      layerIds: [id(earLeft), id(earRight)],
      mode: 'top',
    });

    run('apply_palette', {
      layerIds: [id(nose), id(eyeLeft), id(eyeRight)],
      colors: ['#da7756', '#ffffff'],
    });

    run('set_clip_mask', {
      maskLayerId: id(head),
      targetLayerIds: [id(label)],
    });
    let masked = sceneLayers().find((layer) => layer.id === id(label))!;
    expect(masked.clipMaskId).toBe(id(head));

    run('set_clip_mask', {
      maskLayerId: null,
      targetLayerIds: [id(label)],
    });
    masked = sceneLayers().find((layer) => layer.id === id(label))!;
    expect(masked.clipMaskId).toBeUndefined();

    const union = run('boolean_op', {
      layerIds: [id(head), id(earLeft)],
      operation: 'unite',
    });
    expect(union.layerId).toBeTruthy();

    run('rotate_layers', { layerIds: [id(nose)], angle: 12 });
    run('flip_layers', { layerIds: [id(whiskers)], axis: 'vertical' });
    run('round_corners', { layerIds: [id(nose)], radius: 4 });

    const spark = run('create_shape', {
      name: 'Искра',
      preset: 'star',
      x: 200,
      y: 200,
      width: 80,
      height: 80,
      points: 10,
      fill: '#da7756',
    });
    run('repeat_layer', {
      layerIds: [id(spark)],
      mode: 'grid',
      count: 6,
      columns: 3,
      gap: 10,
    });
    run('place_in_bounds', {
      layerIds: [id(spark)],
      x: 80,
      y: 80,
      width: 160,
      height: 96,
    });
    run('mirror_duplicate', { layerIds: [id(spark)], axis: 'horizontal' });
    run('offset_path', { layerIds: [id(nose)], distance: 6, copyBehind: true });

    const ring = run('create_shape', {
      name: 'Обводка',
      preset: 'ellipse',
      x: 300,
      y: 300,
      width: 120,
      height: 120,
      fill: 'none',
      stroke: { color: '#da7756', width: 6 },
    });
    run('outline_stroke', { layerIds: [id(ring)] });

    const dotA = run('create_shape', {
      name: 'Точка A',
      preset: 'ellipse',
      x: 900,
      y: 900,
      width: 120,
      height: 70,
      fill: '#1c1b1a',
    });
    const dotB = run('create_shape', {
      name: 'Точка B',
      preset: 'ellipse',
      x: 980,
      y: 920,
      width: 90,
      height: 110,
      fill: '#1c1b1a',
    });
    const compound = run('combine_compound', {
      layerIds: [id(dotA), id(dotB)],
    });
    run('split_compound', { layerIds: [id(compound)] });
    run('simplify_path', { layerIds: [id(spark)], tolerance: 1 });

    run('text_case', { layerIds: [id(label)], mode: 'title' });
    run('set_artboard', { background: '#fdf8ec', width: 1200, height: 1200 });
    run('recolor_palette', {
      palette: ['#fdf8ec', '#1e293b', '#da7756'],
      includeBackground: true,
    });
    run('preflight_check', {});
    run('select_layers', { mode: 'all' });
    run('get_layer_geometry', { layerIds: [id(spark)] });

    run('delete_layers', {
      layerIds: duplicates.createdLayerIds as string[],
    });

    expect(executed.size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(TOOL_DEFINITIONS.map((tool) => tool.name))).toEqual(executed);
    expect(sceneLayers().length).toBeGreaterThan(0);

    const beforeName = useEditorStore.getState().scene.name;
    const rejected = executeTool('set_artboard', { name: 'Чужое имя' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toContain('запрещено');
    }
    expect(useEditorStore.getState().scene.name).toBe(beforeName);
  });
});
