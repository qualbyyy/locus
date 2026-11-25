#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function quoteExecArg(value) {
  const escaped = value.replace(/([\\"$`])/g, '\\$1').replace(/%/g, '%%');
  return `"${escaped}"`;
}

function desktopEntry(execPath) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.5',
    'Name=Locus',
    'Comment=Автоматизированный векторный редактор',
    `Exec=${quoteExecArg(execPath)}`,
    'Icon=locus',
    'Terminal=false',
    'Categories=Graphics;VectorGraphics;',
    'StartupWMClass=locus',
    '',
  ].join('\n');
}

async function assertExecutable(binaryPath) {
  let info;
  try {
    info = await stat(binaryPath);
  } catch {
    throw new Error(`Бинарник не найден: ${binaryPath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Бинарник не является файлом: ${binaryPath}`);
  }
  if ((info.mode & 0o111) === 0) {
    throw new Error(`Бинарник не исполняемый: ${binaryPath}`);
  }
}

async function writeAtomic(targetPath, data, mode) {
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  await writeFile(tempPath, data, mode === undefined ? undefined : { mode });
  if (mode !== undefined) {
    await chmod(tempPath, mode);
  }
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function copyAtomic(sourcePath, targetPath, mode) {
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  await copyFile(sourcePath, tempPath);
  if (mode !== undefined) {
    await chmod(tempPath, mode);
  }
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function runIfAvailable(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 15000 });
  } catch {
    // Кэш-утилиты необязательны: их отсутствие или ошибка не ломают установку.
  }
}

async function refreshCaches(applicationsDir, iconThemeDir) {
  await runIfAvailable('update-desktop-database', [applicationsDir]);
  try {
    await access(path.join(iconThemeDir, 'index.theme'), constants.R_OK);
  } catch {
    return;
  }
  await runIfAvailable('gtk-update-icon-cache', ['-f', '-t', iconThemeDir]);
}

export async function installLauncher({ binaryPath, projectRoot, homeDir, installRoot }) {
  const sourceBinary = path.resolve(binaryPath);
  const sourceIcon = path.join(projectRoot, 'src-tauri', 'icons', '128x128.png');
  await assertExecutable(sourceBinary);

  const baseDir = installRoot ? path.resolve(installRoot) : path.resolve(homeDir);
  const targetBinary = path.join(baseDir, '.local', 'opt', 'locus', 'locus');
  const iconDir = path.join(baseDir, '.local', 'share', 'icons', 'hicolor', '128x128', 'apps');
  const applicationsDir = path.join(baseDir, '.local', 'share', 'applications');
  const targetIcon = path.join(iconDir, 'locus.png');
  const targetDesktop = path.join(applicationsDir, 'locus.desktop');

  try {
    await access(sourceIcon, constants.R_OK);
  } catch {
    throw new Error(`Иконка не найдена: ${sourceIcon}`);
  }

  await mkdir(path.dirname(targetBinary), { recursive: true });
  await mkdir(iconDir, { recursive: true });
  await mkdir(applicationsDir, { recursive: true });

  await copyAtomic(sourceBinary, targetBinary, 0o755);
  await copyAtomic(sourceIcon, targetIcon, 0o644);
  await writeAtomic(targetDesktop, desktopEntry(targetBinary), 0o644);

  await refreshCaches(applicationsDir, path.join(baseDir, '.local', 'share', 'icons', 'hicolor'));

  return { binaryPath: targetBinary, desktopPath: targetDesktop, iconPath: targetIcon };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const binaryPath = path.resolve(
    process.argv[2] ?? path.join(projectRoot, 'src-tauri', 'target', 'release', 'locus'),
  );
  try {
    const installed = await installLauncher({
      binaryPath,
      projectRoot,
      homeDir: process.env.HOME ?? homedir(),
    });
    console.log(`Бинарник: ${installed.binaryPath}`);
    console.log(`Иконка:   ${installed.iconPath}`);
    console.log(`Ярлык:    ${installed.desktopPath}`);
  } catch (error) {
    console.error(`Не удалось установить ярлык: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
