import { useRef, useState } from 'react';
import { inferImageMimeType } from '../../core/assets';
import { useCanvasBackdropStore } from '../../core/canvasBackdrop';
import type { AppSettings, SettingsPatch } from '../../core/settings';
import { ACCENT_PRESETS, getThemePreset, THEME_PRESETS } from '../../core/themes';
import {
  CUSTOM_FONT_FAMILY,
  FONT_PRESETS,
  fontMimeFromName,
  getFontStacks,
  useCustomFontStore,
} from '../../core/typography';
import { pickOpenFile } from '../../platform/io';
import { HexColorRow, SegmentedButton } from '../InspectorControls';

interface AppearanceTabProps {
  settings: AppSettings;
  updateSettings: (patch: SettingsPatch) => void;
  customFontInput: string;
  onChangeCustomFontInput: (value: string) => void;
}

export function AppearanceTab({
  settings,
  updateSettings,
  customFontInput,
  onChangeCustomFontInput,
}: AppearanceTabProps) {
  const customFont = useCustomFontStore((s) => s.meta);
  const canvasBackdrop = useCanvasBackdropStore((s) => s.meta);
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  const [isFontLoading, setIsFontLoading] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<string | null>(null);
  const [isCanvasImageLoading, setIsCanvasImageLoading] = useState(false);
  const customFontCancelledRef = useRef(false);

  const activeThemePreset = getThemePreset(settings.themeId);

  const handlePickCustomFont = async () => {
    setFontStatus(null);
    setIsFontLoading(true);
    try {
      const file = await pickOpenFile({
        title: 'Загрузить шрифт интерфейса',
        filters: [
          { name: 'Шрифты', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
        ],
      });
      if (!file) return;
      await useCustomFontStore.getState().save({
        name: file.name,
        mimeType: fontMimeFromName(file.name),
        bytes: file.bytes,
      });
      updateSettings({
        fontPreset: 'custom',
        customFontFamily: CUSTOM_FONT_FAMILY,
      });
      onChangeCustomFontInput(CUSTOM_FONT_FAMILY);
      setFontStatus('Шрифт загружен');
    } catch (err) {
      setFontStatus(
        err instanceof Error ? err.message : 'Не удалось загрузить шрифт'
      );
    } finally {
      setIsFontLoading(false);
    }
  };

  const handleClearCustomFont = async () => {
    await useCustomFontStore.getState().clear();
    updateSettings({ fontPreset: 'paper', customFontFamily: '' });
    onChangeCustomFontInput('');
    setFontStatus('Свой шрифт удалён');
  };

  const handlePickCanvasImage = async () => {
    setCanvasStatus(null);
    setIsCanvasImageLoading(true);
    try {
      const file = await pickOpenFile({
        title: 'Фон рабочей области',
        filters: [
          { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        ],
      });
      if (!file) return;
      const mimeType = inferImageMimeType(file.name, file.bytes);
      if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
        setCanvasStatus('Поддерживаются PNG, JPEG и WebP');
        return;
      }
      await useCanvasBackdropStore
        .getState()
        .save({ name: file.name, mimeType, bytes: file.bytes });
      setCanvasStatus(
        useCanvasBackdropStore.getState().warning ??
          'Фон рабочей области обновлён'
      );
    } catch (err) {
      console.error('Locus: не удалось загрузить фон рабочей области', err);
      setCanvasStatus(
        err instanceof Error
          ? `Не удалось загрузить изображение: ${err.message}`
          : `Не удалось загрузить изображение: ${String(err)}`
      );
    } finally {
      setIsCanvasImageLoading(false);
    }
  };

  const handleClearCanvasImage = async () => {
    await useCanvasBackdropStore.getState().clear();
    setCanvasStatus('Фото убрано');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Тема интерфейса
        </span>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((preset) => {
            const active = settings.themeId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  updateSettings({
                    themeId: preset.id,
                    accentColor: preset.defaultAccent,
                  })
                }
                className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-bg'
                    : 'border-paper-border bg-paper-panel hover:bg-paper-hover'
                }`}
              >
                <span className="text-[12px] font-medium text-paper-ink">
                  {preset.label}
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                    style={{ backgroundColor: preset.tokens.bg }}
                  />
                  <span
                    className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                    style={{ backgroundColor: preset.tokens.panel }}
                  />
                  <span
                    className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                    style={{ backgroundColor: preset.defaultAccent }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Акцентный цвет
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {ACCENT_PRESETS.map((preset) => {
            const active =
              settings.accentColor.toLowerCase() ===
              preset.color.toLowerCase();
            return (
              <button
                key={preset.color}
                type="button"
                title={preset.label}
                onClick={() =>
                  updateSettings({ accentColor: preset.color })
                }
                className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-accent/12 font-medium text-paper-ink'
                    : 'border-paper-border bg-paper-panel text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-black/15"
                  style={{ backgroundColor: preset.color }}
                />
                <span className="truncate">{preset.label}</span>
              </button>
            );
          })}
        </div>
        <HexColorRow
          value={settings.accentColor}
          onChange={(accentColor) => updateSettings({ accentColor })}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 rounded-sm border border-paper-border"
              style={{
                backgroundColor:
                  settings.customCanvasBg ?? activeThemePreset.tokens.canvas,
              }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
              Фон вокруг артборда
            </span>
          </div>
          {settings.customCanvasBg ? (
            <button
              type="button"
              onClick={() => updateSettings({ customCanvasBg: null })}
              className="text-[11px] text-paper-accent hover:underline"
            >
              Сбросить к теме
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                updateSettings({
                  customCanvasBg: activeThemePreset.tokens.canvas,
                })
              }
              className="text-[11px] text-paper-accent hover:underline"
            >
              Задать свой цвет
            </button>
          )}
        </div>
        {settings.customCanvasBg && (
          <HexColorRow
            value={settings.customCanvasBg}
            onChange={(customCanvasBg) =>
              updateSettings({ customCanvasBg })
            }
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isCanvasImageLoading}
            onClick={() => void handlePickCanvasImage()}
            className="rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-50"
          >
            {isCanvasImageLoading ? 'Загрузка…' : 'Своё фото…'}
          </button>
          {canvasBackdrop && (
            <>
              <button
                type="button"
                onClick={() => void handleClearCanvasImage()}
                className="rounded px-1.5 py-1 text-[11px] text-paper-muted hover:text-paper-danger"
              >
                Убрать фото
              </button>
              <span className="max-w-40 truncate text-[10px] text-paper-muted">
                {canvasBackdrop.name}
              </span>
            </>
          )}
        </div>
        {canvasStatus && (
          <span className="text-[10px] text-paper-muted">{canvasStatus}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-paper-border pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Плотность интерфейса
        </span>
        <div className="flex gap-1.5">
          <SegmentedButton
            active={settings.uiScale === 'normal'}
            label="Обычный"
            onClick={() => updateSettings({ uiScale: 'normal' })}
          />
          <SegmentedButton
            active={settings.uiScale === 'compact'}
            label="Компактный"
            onClick={() => updateSettings({ uiScale: 'compact' })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
          Шрифты интерфейса
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {FONT_PRESETS.map((preset) => {
            const active = settings.fontPreset === preset.id;
            const stack = getFontStacks(preset.id, null);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => updateSettings({ fontPreset: preset.id })}
                className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-accent/10'
                    : 'border-paper-border bg-paper-bg/60 hover:bg-paper-hover'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-paper-ink">
                    {preset.label}
                  </span>
                  <span className="block truncate text-[10px] text-paper-muted">
                    {preset.hint}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[17px] leading-none text-paper-ink"
                  style={{ fontFamily: stack.display }}
                >
                  Aa
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={`flex flex-col gap-2 rounded border p-2.5 ${
            settings.fontPreset === 'custom'
              ? 'border-paper-accent bg-paper-accent/10'
              : 'border-paper-border bg-paper-bg/60'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => updateSettings({ fontPreset: 'custom' })}
              className="text-[12px] font-medium text-paper-ink hover:text-paper-accent"
            >
              Свой шрифт
            </button>
            <span
              className="text-[17px] leading-none text-paper-ink"
              style={{
                fontFamily: getFontStacks(
                  'custom',
                  customFontInput || settings.customFontFamily
                ).ui,
              }}
            >
              Aa
            </span>
          </div>
          <input
            type="text"
            value={customFontInput}
            spellCheck={false}
            placeholder="Название семейства, например Locus Custom"
            onFocus={() => {
              customFontCancelledRef.current = false;
            }}
            onChange={(e) => onChangeCustomFontInput(e.target.value)}
            onBlur={() => {
              if (customFontCancelledRef.current) {
                customFontCancelledRef.current = false;
                return;
              }
              updateSettings({ customFontFamily: customFontInput });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                updateSettings({ customFontFamily: customFontInput });
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                customFontCancelledRef.current = true;
                onChangeCustomFontInput(settings.customFontFamily);
                e.currentTarget.blur();
              }
            }}
            className="h-7 rounded border border-paper-border bg-paper-panel px-2 text-[12px] text-paper-ink outline-none placeholder:text-paper-muted focus:border-paper-accent"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={isFontLoading}
              onClick={() => void handlePickCustomFont()}
              className="rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-50"
            >
              {isFontLoading ? 'Загрузка…' : 'Загрузить .ttf / .otf'}
            </button>
            {(customFont || settings.customFontFamily) && (
              <button
                type="button"
                onClick={() => void handleClearCustomFont()}
                className="rounded px-1.5 py-1 text-[11px] text-paper-muted hover:text-paper-danger"
              >
                Сбросить
              </button>
            )}
            {customFont && (
              <span className="truncate text-[10px] text-paper-muted">
                {customFont.fileName}
              </span>
            )}
          </div>
          {fontStatus && (
            <span className="text-[10px] text-paper-muted">{fontStatus}</span>
          )}
        </div>
      </div>
    </div>
  );
}
