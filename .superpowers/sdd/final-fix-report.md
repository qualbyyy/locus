# Tutorial Stage 1 final-review fixes

## Scope

Applied the accepted final-review findings on branch `feat/tutorial-academy` without checkout, reset, or clean operations.

### Changes

- `src/core/settings.ts`
  - Added `tutorialTouchedBeforeLoad` to the settings store state and initialized it to `false`.
  - Tutorial updates mark the state as touched before the initial settings load completes.
  - `loadSettings()` preserves tutorial progress written while the settings file read is in flight, then clears the marker.
  - `resetSettings()` marks the tutorial as touched while preserving it across a later load.
  - Other setting merge behavior is unchanged.
- `tests/tutorial_settings_load.test.ts`
  - Added the requested untouched-load and in-flight tutorial-write regression tests.
- `src/tutorial/progress.ts`
  - Tutorial IDs are trimmed before insertion.
  - Blank step and lesson IDs are ignored.
  - Lesson completion returns the original progress object when it produces no change.
- `tests/tutorial_progress.test.ts`
  - Added the requested blank-ID regression test.
- `src/ui/tutorial/TutorialModal.tsx`
  - Added an “Очистить поиск” button for empty search results.
  - Changed the overall header to chapter-based progress.
  - Added the accessible close-button name `Закрыть обучение`.

## TDD evidence

The new regression tests were run before the production fix and failed for the expected reasons:

```text
npx vitest run tests/tutorial_settings_load.test.ts tests/tutorial_progress.test.ts

FAIL tests/tutorial_progress.test.ts
  ignores blank ids in public mutators
  expected completedStepIds [] but received ["   "]

FAIL tests/tutorial_settings_load.test.ts
  preserves tutorial progress written while the load is in flight
  expected ["local.write"] but received ["from.file"]

2 failed, 7 passed
```

After the implementation, the same focused tests passed:

```text
npx vitest run tests/tutorial_settings_load.test.ts tests/tutorial_progress.test.ts

✓ tests/tutorial_settings_load.test.ts (2 tests)
✓ tests/tutorial_progress.test.ts (7 tests)

Test Files  2 passed (2)
Tests  9 passed (9)
```

## Verification commands and output

### Targeted tutorial suite

```text
npx vitest run tests/tutorial_settings_load.test.ts tests/tutorial_progress.test.ts tests/tutorial_store.test.ts tests/tutorial_content.test.ts tests/tutorial_search.test.ts tests/tutorial_shortcuts.test.ts

✓ tests/tutorial_progress.test.ts (7 tests)
✓ tests/tutorial_store.test.ts (8 tests)
✓ tests/tutorial_settings_load.test.ts (2 tests)
✓ tests/tutorial_shortcuts.test.ts (3 tests)
✓ tests/tutorial_search.test.ts (4 tests)
✓ tests/tutorial_content.test.ts (3 tests)

Test Files  6 passed (6)
Tests  27 passed (27)
```

### TypeScript

```text
npx tsc --noEmit

exit code 0
```

### Full test suite

```text
npm test

Test Files  22 passed (22)
Tests  120 passed (120)
```

The full suite emitted existing jsdom warnings that `HTMLCanvasElement.getContext()` is not implemented without `@napi-rs/canvas`; all tests still passed.

### Production build

```text
npm run build

✓ 2543 modules transformed.
✓ built in 4.56s
```

The build emitted the existing Vite warning about a chunk larger than 500 kB; the build completed successfully.

## Repository state

An unrelated pre-existing untracked file was left untouched:

```text
src-tauri/Новый_макет.locus
```

## Result

All requested fixes are implemented and verified. The requested commit was created after verification.
