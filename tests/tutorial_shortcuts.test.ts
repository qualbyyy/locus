import { describe, expect, it } from 'vitest';
import {
  findShortcutConflict,
  getEffectiveShortcut,
  matchShortcut,
  SHORTCUT_DEFINITIONS,
} from '../src/core/shortcuts';

const f1 = {
  code: 'F1',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

describe('tutorial shortcuts', () => {
  it('binds F1 to opening the tutorial', () => {
    expect(getEffectiveShortcut('app.openTutorial')).toBe('F1');
    expect(matchShortcut(f1)).toBe('app.openTutorial');
  });

  it('does not conflict with existing actions', () => {
    expect(findShortcutConflict('app.openTutorial', 'F1')).toBeNull();
  });

  it('is not user-editable', () => {
    const definition = SHORTCUT_DEFINITIONS.find(
      (item) => item.id === 'app.openTutorial'
    );
    expect(definition?.editable).toBe(false);
    expect(definition?.category).toBe('view');
  });
});
