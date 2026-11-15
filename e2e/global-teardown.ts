import fs from 'fs';

export default async function globalTeardown() {
  const dataDir = process.env.E2E_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
