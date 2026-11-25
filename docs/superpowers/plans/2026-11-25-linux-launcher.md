# Linux Launcher Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Locus visible in the Linux application launcher both through Tauri release packages and through a repeatable per-user installation of the current binary.

**Architecture:** Keep Tauri responsible for release artifacts (`deb`, `rpm`, `appimage`). Add a standalone Node ESM installer that copies a selected executable to a stable per-user path, installs the existing 128px PNG icon, and writes a standards-compliant `.desktop` file under the XDG user directories. The installer supports an isolated root override for tests and never requires root.

**Tech Stack:** Tauri v2 bundle configuration, Node.js ESM, `node:fs/promises`, `node:path`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-linux-launcher-design.md`

## Global Constraints

- Installation is per-user only and must not require `sudo`.
- The stable launcher binary path is `~/.local/opt/locus/locus`.
- The desktop file is `~/.local/share/applications/locus.desktop`.
- The icon is `~/.local/share/icons/hicolor/128x128/apps/locus.png`.
- The primary desktop category is `Graphics;VectorGraphics;`.
- The launcher uses `Terminal=false` and runs the installed copy, not `src-tauri/target` directly.
- Preserve the existing Tauri product name `Locus`, identifier `dev.qualbyy.locus`, and generated icons.
- Do not add file association registration or autostart behavior.

## Review Focus

- Home paths containing spaces: generated `Exec` must remain valid through desktop-entry argument quoting; test this in the installer test.
- Reinstalling over an existing launcher: binary, icon, and desktop file must be replaced atomically enough for repeated use; test two consecutive installs.
- Missing or non-executable binary: the command must fail before changing the installed launcher; test this in the installer test.
- Existing XDG directories: the installer must create only missing directories and preserve unrelated files; test with a pre-populated temporary root.
- Optional cache tools: absence of `update-desktop-database` or `gtk-update-icon-cache` must not make installation fail; test with a restricted command environment or direct helper coverage.

---

### Task 1: Add the tested per-user Linux launcher installer

**Files:**
- Create: `scripts/install-linux-launcher.mjs`
- Create: `tests/linuxLauncher.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `installLauncher({ binaryPath, projectRoot, homeDir, installRoot? }): Promise<{ binaryPath: string; desktopPath: string; iconPath: string }>` from `scripts/install-linux-launcher.mjs`.
- The CLI accepts an optional binary path as the first positional argument; without it, use `src-tauri/target/release/locus` relative to the repository root.
- The test-only `installRoot` argument redirects the `.local` tree while keeping the same relative layout; normal CLI behavior uses `HOME` and XDG user directories.

- [ ] **Step 1: Write the failing integration tests**

  Add tests covering:
  - installing a temporary executable into `<root>/.local/opt/locus/locus`;
  - copying `src-tauri/icons/128x128.png` to `<root>/.local/share/icons/hicolor/128x128/apps/locus.png`;
  - writing a desktop entry containing `Type=Application`, `Name=Locus`, a correctly quoted `Exec`, `Icon=locus`, `Terminal=false`, and `Categories=Graphics;VectorGraphics;`;
  - a home/install root containing spaces;
  - reinstalling with a second binary and preserving an unrelated file;
  - rejecting a missing or non-executable source binary without creating the launcher.

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `npm test -- tests/linuxLauncher.test.ts`

  Expected: FAIL because `scripts/install-linux-launcher.mjs` and `installLauncher` do not exist yet.

- [ ] **Step 3: Implement the installer**

  In `scripts/install-linux-launcher.mjs`:
  - resolve the source binary and verify it exists and has at least one executable permission bit;
  - derive paths from `homeDir`/`installRoot` without reading secrets or hard-coding the current user;
  - create the three destination directory trees with recursive filesystem operations;
  - copy the binary and icon, write the desktop entry, and set the installed binary mode to executable;
  - quote the absolute `Exec` path for desktop-entry syntax, including spaces and backslashes;
  - run `update-desktop-database` and `gtk-update-icon-cache` only when available, ignoring their absence or failure;
  - export `installLauncher` for tests and run the CLI only when the module is executed directly;
  - print the final installed paths and a command failure message to stderr with a non-zero exit code.

  Add `"install:linux": "node scripts/install-linux-launcher.mjs"` to `package.json`.

- [ ] **Step 4: Run the focused tests and verify they pass**

  Run: `npm test -- tests/linuxLauncher.test.ts`

  Expected: PASS for all launcher installation, quoting, reinstall, and validation cases.

- [ ] **Step 5: Run syntax and type checks for the new files**

  Run: `node --check scripts/install-linux-launcher.mjs && npx tsc --noEmit`

  Expected: exit code `0`.

### Task 2: Make release bundle targets explicit

**Files:**
- Modify: `src-tauri/tauri.conf.json:28-37`

**Interfaces:**
- Consumes the existing `bundle.icon` list and Tauri v2 configuration.
- Produces explicit Linux release targets `deb`, `rpm`, and `appimage`; Windows/macOS targets are not added by this change.

- [ ] **Step 1: Update the Tauri bundle target list**

  Replace the broad `"targets": "all"` setting with `"targets": ["deb", "rpm", "appimage"]`; leave the existing product metadata and icon paths unchanged.

- [ ] **Step 2: Validate the JSON and package configuration**

  Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('valid')"`

  Expected: `valid`.

- [ ] **Step 3: Build the web application and focused tests**

  Run: `npm run build && npm test -- tests/linuxLauncher.test.ts`

  Expected: both commands exit with code `0`.

### Task 3: Verify the deliverable end to end

**Files:**
- Modify: none unless verification exposes an implementation defect.

- [ ] **Step 1: Run the project test suite**

  Run: `npm test`

  Expected: all existing tests plus `tests/linuxLauncher.test.ts` pass.

- [ ] **Step 2: Build the Tauri release artifacts**

  Run: `npm run tauri build`

  Expected: Tauri completes the frontend build and attempts the configured `deb`, `rpm`, and AppImage bundles; report any missing system packaging dependency plainly if the host cannot produce one of them.

- [ ] **Step 3: Exercise the real installer command**

  Run: `npm run install:linux -- src-tauri/target/release/locus`

  Expected: the command installs the binary, icon, and `.desktop` file under the current user's XDG directories and prints their paths.

- [ ] **Step 4: Inspect repository state**

  Run: `git status --short`

  Expected: only intended source/config/test/docs files and normal build outputs are present; remove any temporary test artifacts created by verification.
