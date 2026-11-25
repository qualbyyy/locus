export interface InstallLauncherOptions {
  binaryPath: string;
  projectRoot: string;
  homeDir: string;
  installRoot?: string;
}

export interface InstalledLauncher {
  binaryPath: string;
  desktopPath: string;
  iconPath: string;
}

export function installLauncher(options: InstallLauncherOptions): Promise<InstalledLauncher>;
