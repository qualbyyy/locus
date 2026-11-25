import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installLauncher } from '../scripts/install-linux-launcher.mjs';

async function createProjectRoot(root: string) {
  const iconDir = path.join(root, 'src-tauri', 'icons');
  await mkdir(iconDir, { recursive: true });
  await writeFile(path.join(iconDir, '128x128.png'), new TextEncoder().encode('icon-bytes'));
}

async function createBinary(filePath: string, contents = 'binary', mode = 0o755) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await chmod(filePath, mode);
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'locus-launcher-'));
  const projectRoot = path.join(root, 'project');
  const homeDir = path.join(root, 'home with spaces');
  await createProjectRoot(projectRoot);
  await createBinary(path.join(root, 'source', 'locus'), 'first-binary');
  return {
    root,
    projectRoot,
    homeDir,
    binaryPath: path.join(root, 'source', 'locus'),
  };
}

describe.skipIf(process.platform === 'win32')('scripts/install-linux-launcher', () => {
  it('installs binary, icon and desktop entry into the user tree', async () => {
    const { projectRoot, homeDir, binaryPath } = await setup();
    const result = await installLauncher({ binaryPath, projectRoot, homeDir });

    expect(result.binaryPath).toBe(path.join(homeDir, '.local', 'opt', 'locus', 'locus'));
    expect(result.cliPath).toBe(path.join(homeDir, '.local', 'bin', 'locus'));
    expect(result.iconPath).toBe(
      path.join(homeDir, '.local', 'share', 'icons', 'hicolor', '128x128', 'apps', 'locus.png'),
    );
    expect(result.desktopPath).toBe(
      path.join(homeDir, '.local', 'share', 'applications', 'locus.desktop'),
    );

    expect(await readFile(result.binaryPath, 'utf8')).toBe('first-binary');
    const cliStat = await lstat(result.cliPath);
    expect(cliStat.isSymbolicLink()).toBe(true);
    expect(await readlink(result.cliPath)).toBe(result.binaryPath);
    const binaryStat = await stat(result.binaryPath);
    expect(binaryStat.mode & 0o111).not.toBe(0);
    expect(await readFile(result.iconPath, 'utf8')).toBe('icon-bytes');

    const desktop = await readFile(result.desktopPath, 'utf8');
    expect(desktop).toContain('Type=Application');
    expect(desktop).toContain('Name=Locus');
    expect(desktop).toContain('Icon=locus');
    expect(desktop).toContain('Terminal=false');
    expect(desktop).toContain('Categories=Graphics;VectorGraphics;');
    expect(desktop).toContain('StartupWMClass=locus');
    expect(desktop).toContain(`Exec="${result.binaryPath}"`);
  });

  it('keeps the Exec path valid when the home directory contains spaces', async () => {
    const { projectRoot, homeDir, binaryPath } = await setup();
    const result = await installLauncher({ binaryPath, projectRoot, homeDir });
    const desktop = await readFile(result.desktopPath, 'utf8');
    expect(result.binaryPath).toContain('home with spaces');
    expect(desktop).toContain(`Exec="${result.binaryPath}"`);
  });

  it('reinstalls over an existing launcher and preserves unrelated desktop files', async () => {
    const { projectRoot, homeDir, binaryPath, root } = await setup();
    await installLauncher({ binaryPath, projectRoot, homeDir });

    const unrelated = path.join(homeDir, '.local', 'share', 'applications', 'other.desktop');
    await writeFile(unrelated, '[Desktop Entry]\nName=Other\n');

    await writeFile(binaryPath, 'second-binary');
    await chmod(binaryPath, 0o755);
    const result = await installLauncher({ binaryPath, projectRoot, homeDir });

    expect(await readFile(result.binaryPath, 'utf8')).toBe('second-binary');
    expect(existsSync(unrelated)).toBe(true);
    expect(await readFile(unrelated, 'utf8')).toContain('Name=Other');
    expect(existsSync(path.join(root, 'source', 'locus'))).toBe(true);
  });

  it('rejects a missing source binary without creating the launcher', async () => {
    const { projectRoot, homeDir, root } = await setup();
    const missing = path.join(root, 'source', 'absent');
    await expect(installLauncher({ binaryPath: missing, projectRoot, homeDir })).rejects.toThrow(
      /не найден/i,
    );
    expect(existsSync(path.join(homeDir, '.local', 'share', 'applications'))).toBe(false);
    expect(existsSync(path.join(homeDir, '.local', 'opt'))).toBe(false);
  });

  it('rejects a non-executable source binary without creating the launcher', async () => {
    const { projectRoot, homeDir, root } = await setup();
    const notExecutable = path.join(root, 'source', 'plain');
    await createBinary(notExecutable, 'plain-file', 0o644);
    await expect(
      installLauncher({ binaryPath: notExecutable, projectRoot, homeDir }),
    ).rejects.toThrow(/не исполняемый/i);
    expect(existsSync(path.join(homeDir, '.local', 'share', 'applications'))).toBe(false);
  });

  it('supports an install root override with the same layout', async () => {
    const { projectRoot, homeDir, binaryPath, root } = await setup();
    const installRoot = path.join(root, 'isolated root');
    const result = await installLauncher({ binaryPath, projectRoot, homeDir, installRoot });
    expect(result.binaryPath).toBe(path.join(installRoot, '.local', 'opt', 'locus', 'locus'));
    expect(existsSync(result.desktopPath)).toBe(true);
  });
});
