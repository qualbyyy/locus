import { useCallback, useEffect, useRef, useState } from 'react';
import { saveProjectDialog } from '../core/documentFile';
import { clearSceneDraft, saveSceneDraft, useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';
import type { Scene } from '../core/types';
import { isTauri } from '../platform/io';

export interface UseAutosaveGuardOptions {
  scene: Scene;
  isDirty: boolean;
  autosaveEnabled: boolean;
  autosaveIntervalSec: number;
  showNotice: (message: string) => void;
}

export function useAutosaveGuard({
  scene,
  isDirty,
  autosaveEnabled,
  autosaveIntervalSec,
  showNotice,
}: UseAutosaveGuardOptions) {
  const [isUnsavedOpen, setIsUnsavedOpen] = useState(false);
  const [isSavingBeforeAction, setIsSavingBeforeAction] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!autosaveEnabled) return;
    const intervalMs = Math.max(15, autosaveIntervalSec) * 1000;
    const timer = window.setInterval(() => {
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autosaveEnabled, autosaveIntervalSec]);

  useEffect(() => {
    if (!autosaveEnabled || !isDirty || scene.layers.length === 0) return;
    const timer = window.setTimeout(() => {
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [autosaveEnabled, isDirty, scene]);

  useEffect(() => {
    const flushDraft = () => {
      const currentAutosave = useSettingsStore.getState().settings.autosaveEnabled;
      if (!currentAutosave) return;
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const guardUnsaved = useCallback((action: () => void) => {
    const state = useEditorStore.getState();
    if (!state.isDirty) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setIsUnsavedOpen(true);
  }, []);

  const resolveUnsaved = useCallback(
    async (choice: 'discard' | 'save') => {
      const action = pendingActionRef.current;
      if (choice === 'discard') {
        pendingActionRef.current = null;
        setIsUnsavedOpen(false);
        void clearSceneDraft();
        action?.();
        return;
      }

      setIsSavingBeforeAction(true);
      try {
        const target = await saveProjectDialog();
        if (target === null) return;
        pendingActionRef.current = null;
        setIsUnsavedOpen(false);
        action?.();
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : 'Не удалось сохранить проект'
        );
      } finally {
        setIsSavingBeforeAction(false);
      }
    },
    [showNotice]
  );

  const cancelUnsaved = useCallback(() => {
    pendingActionRef.current = null;
    setIsUnsavedOpen(false);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const off = await win.onCloseRequested((event) => {
          if (!useEditorStore.getState().isDirty) return;
          event.preventDefault();
          pendingActionRef.current = () => {
            void win.destroy();
          };
          setIsUnsavedOpen(true);
        });
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      } catch {
        // Ignore window close hook registration failures in non-windowed environments.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    isUnsavedOpen,
    isSavingBeforeAction,
    guardUnsaved,
    resolveUnsaved,
    cancelUnsaved,
  };
}
