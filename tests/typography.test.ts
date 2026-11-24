import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  useSettingsStore,
} from '../src/core/settings';
import { applyThemeToDom } from '../src/core/themes';
import { FONT_PRESETS, getFontStacks } from '../src/core/typography';

describe('UI typography presets', () => {
  it('offers designer presets without monospace families', () => {
    expect(FONT_PRESETS.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(FONT_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(FONT_PRESETS.length);
    for (const preset of FONT_PRESETS) {
      expect(preset.ui).not.toMatch(/mono/i);
      expect(preset.display).not.toMatch(/mono/i);
    }
  });

  it('builds font stacks for presets and a custom family', () => {
    expect(getFontStacks('paper', null).ui).toContain('Golos Text');
    expect(getFontStacks('editorial', null).display).toContain('Playfair Display');
    expect(getFontStacks('custom', 'My Font').ui).toContain('"My Font"');
    expect(getFontStacks('custom', null).ui).toContain('Locus Custom');
  });

  it('defaults AI to OpenAI and applies font settings to the DOM', () => {
    expect(DEFAULT_AI_CONFIG.provider).toBe('openai');

    const settings = sanitizeSettings({
      fontPreset: 'editorial',
      customFontFamily: '  My Font  ',
    });
    expect(settings.fontPreset).toBe('editorial');
    expect(settings.customFontFamily).toBe('My Font');
    expect(sanitizeSettings({ fontPreset: 'unknown' }).fontPreset).toBe(
      DEFAULT_SETTINGS.fontPreset
    );

    applyThemeToDom({
      themeId: 'paper',
      fontPreset: 'editorial',
      customFontFamily: null,
    });
    const root = document.documentElement;
    expect(root.dataset.fontPreset).toBe('editorial');
    expect(root.style.getPropertyValue('--font-ui')).toContain('Golos Text');
    expect(root.style.getPropertyValue('--font-display')).toContain(
      'Playfair Display'
    );
  });

  it('toggles interface animations through settings', () => {
    const store = useSettingsStore.getState();
    expect(sanitizeSettings({}).animationsEnabled).toBe(true);
    store.updateSettings({ animationsEnabled: false });
    expect(document.documentElement.dataset.motion).toBe('off');
    store.updateSettings({ animationsEnabled: true });
    expect(document.documentElement.dataset.motion).toBe('on');
  });
});
