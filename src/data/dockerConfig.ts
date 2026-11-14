export const GITHUB_REPO_URL = 'https://github.com/FraczekMarcin/Zarzadzanie-Projektami';
export const CURRENT_APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
export const INSTALL_TARGET_DIR = '/opt/zarzadzanie-projektami';
export const INSTALL_COMMAND = 'sudo bash install.sh';
export const UPDATE_COMMAND = 'cd /opt/zarzadzanie-projektami && /bin/bash backup.sh && git pull origin main && docker compose up -d --build';
