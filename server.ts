import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Persistent shared database directory for all clients
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create data dir:', err);
  }
}

// In-memory cache for live synchronization and Google Calendar iCal feeds
let serverAppStateCache: any = null;
let serverTasksCache: any[] = [];
let serverUsersCache: any[] = [];

// Load existing state on server startup
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    serverAppStateCache = JSON.parse(raw);
    if (serverAppStateCache && Array.isArray(serverAppStateCache.tasks)) {
      serverTasksCache = serverAppStateCache.tasks;
    }
    if (serverAppStateCache && Array.isArray(serverAppStateCache.users)) {
      serverUsersCache = serverAppStateCache.users;
    }
    console.log(`[Server] Loaded persistent state from ${STATE_FILE} (${serverTasksCache.length} tasks, ${serverUsersCache.length} users)`);
  } catch (err) {
    console.error('[Server] Error reading app_state.json:', err);
  }
}

// API Healthcheck endpoint for Docker & Kubernetes
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2026-10-29 v 0.3.3',
    timestamp: new Date().toISOString(),
    postgresStatus: process.env.DATABASE_URL ? 'configured' : 'standalone-json-db',
    persistedState: !!serverAppStateCache,
  });
});

// SHARED DATABASE ENDPOINTS (Solves: accessing from other computers showing demo data)
app.get('/api/state', (_req, res) => {
  if (serverAppStateCache && serverAppStateCache.initialized) {
    return res.json({ initialized: true, state: serverAppStateCache });
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      serverAppStateCache = JSON.parse(raw);
      return res.json({ initialized: true, state: serverAppStateCache });
    } catch (err) {
      console.error('[Server] Error parsing state file:', err);
    }
  }
  res.json({ initialized: false, state: null });
});

app.post('/api/state', (req, res) => {
  try {
    const state = req.body;
    serverAppStateCache = {
      ...state,
      initialized: true,
      updatedAt: new Date().toISOString(),
    };
    if (Array.isArray(state.tasks)) {
      serverTasksCache = state.tasks;
    }
    if (Array.isArray(state.users)) {
      serverUsersCache = state.users;
    }

    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(serverAppStateCache, null, 2), 'utf-8');
    } catch (writeErr) {
      console.error('[Server] Failed to write to disk:', writeErr);
    }

    res.json({ success: true, timestamp: serverAppStateCache.updatedAt });
  } catch (err: any) {
    console.error('[Server] Error saving app_state:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Direct endpoint to download or run install.sh via curl
app.get('/install.sh', (_req, res) => {
  try {
    const scriptPath = fs.existsSync(path.resolve(__dirname, 'install.sh'))
      ? path.resolve(__dirname, 'install.sh')
      : path.resolve(__dirname, '..', 'install.sh');
    if (fs.existsSync(scriptPath)) {
      res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
      return res.sendFile(scriptPath);
    }
  } catch (err) {
    console.error('Error serving install.sh:', err);
  }
  res.status(404).send('#!/bin/bash\necho "install.sh not found"\nexit 1');
});

// Endpoint to receive latest tasks from client for Google Calendar live sync
app.post('/api/calendar/push-tasks', (req, res) => {
  const { tasks, users } = req.body;
  if (Array.isArray(tasks)) {
    serverTasksCache = tasks;
  }
  if (Array.isArray(users)) {
    serverUsersCache = users;
  }
  res.json({ success: true, count: serverTasksCache.length });
});

// RFC 5545 iCalendar live subscription feed for a specific user
app.get('/api/calendar/user/:userId.ics', (req, res) => {
  const { userId } = req.params;
  const user = serverUsersCache.find((u) => u.id === userId);
  const userName = user ? user.name : 'Użytkownik';

  // Filter tasks for this user (or all if user not found)
  const userTasks = serverTasksCache.length > 0
    ? serverTasksCache.filter((t) => t.assigneeId === userId || !t.assigneeId)
    : [];

  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const toGCalDate = (dateStr: string) => (dateStr ? dateStr.replace(/-/g, '') : now.slice(0, 8));
  const getNextDay = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    } catch {
      return toGCalDate(dateStr);
    }
  };

  const events = userTasks.map((t) => {
    const start = toGCalDate(t.startDate || t.dueDate);
    const end = getNextDay(t.dueDate || t.startDate);
    const summary = `[${t.code || 'ZAD'}] ${(t.title || 'Zadanie').replace(/[,;]/g, ' ')}`;
    const desc = `Priorytet: ${t.priority || 'Normalny'}\\nStatus: ${t.status || 'W toku'}\\nCzas: ${t.durationDays || 1} dni\\n${(t.description || '').replace(/\n/g, '\\n')}`;

    return [
      'BEGIN:VEVENT',
      `UID:${t.id}@zarzadzanierp.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `STATUS:${t.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
      'CLASS:PUBLIC',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].join('\r\n');
  });

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zarzadzanie Projektami//PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${userName} - Moje Zadania (Zarządzanie Projektami)`,
    'X-WR-TIMEZONE:Europe/Warsaw',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${userId}-kalendarz.ics"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// RFC 5545 iCalendar live subscription feed for all tasks
app.get('/api/calendar/all.ics', (_req, res) => {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const toGCalDate = (dateStr: string) => (dateStr ? dateStr.replace(/-/g, '') : now.slice(0, 8));
  const getNextDay = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    } catch {
      return toGCalDate(dateStr);
    }
  };

  const events = serverTasksCache.map((t) => {
    const start = toGCalDate(t.startDate || t.dueDate);
    const end = getNextDay(t.dueDate || t.startDate);
    const summary = `[${t.code || 'ZAD'}] ${(t.title || 'Zadanie').replace(/[,;]/g, ' ')}`;
    const desc = `Priorytet: ${t.priority || 'Normalny'}\\nStatus: ${t.status || 'W toku'}\\nCzas: ${t.durationDays || 1} dni\\n${(t.description || '').replace(/\n/g, '\\n')}`;

    return [
      'BEGIN:VEVENT',
      `UID:${t.id}@zarzadzanierp.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `STATUS:${t.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
      'CLASS:PUBLIC',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].join('\r\n');
  });

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zarzadzanie Projektami//PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Wszystkie Projekty - Terminarz',
    'X-WR-TIMEZONE:Europe/Warsaw',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="wszystkie-projekty.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(icsBody);
});

// REAL GITHUB UPDATE CHECKER ENDPOINT
app.get('/api/system/check-update', async (_req, res) => {
  try {
    const localVersion = process.env.APP_VERSION || '2026-10-29 v 0.3.3';
    
    // Check GitHub raw dockerConfig.ts or package.json
    const rawUrl = 'https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/src/data/dockerConfig.ts';
    const resp = await fetch(`${rawUrl}?t=${Date.now()}`, { cache: 'no-cache' }).catch(() => null);
    
    let remoteVersion = localVersion;
    if (resp && resp.ok) {
      const text = await resp.text();
      const match = text.match(/CURRENT_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        remoteVersion = match[1].trim();
      }
    }

    // Also query latest commit on main
    let latestSha = '';
    let commitMessage = '';
    const ghResp = await fetch('https://api.github.com/repos/FraczekMarcin/Zarzadzanie-Projektami/commits/main', {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'OpenProject-Updater' },
    }).catch(() => null);

    if (ghResp && ghResp.ok) {
      const cData: any = await ghResp.json();
      latestSha = (cData.sha || '').slice(0, 7);
      commitMessage = cData.commit?.message || '';
    }

    const hasUpdate = remoteVersion !== localVersion;

    res.json({
      localVersion,
      remoteVersion,
      hasUpdate,
      latestSha,
      commitMessage,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// TRIGGER UPDATE ENDPOINT
app.post('/api/system/run-update', (_req, res) => {
  const updateCmd = 'cd ~/Zarzadzanie-Projektami && git pull origin main && cd Instalacja && sudo bash install.sh';
  exec('git pull origin main', (error, stdout, stderr) => {
    if (error) {
      return res.json({
        success: false,
        message: 'Aplikacja działa w kontenerze Docker. Aby zaktualizować serwer produkcyjny, wykonaj polecenie w terminalu:',
        command: updateCmd,
        details: stderr || error.message,
      });
    }
    res.json({
      success: true,
      message: 'Pomyślnie zaktualizowano kod z repozytorium GitHub!',
      output: stdout,
      command: updateCmd,
    });
  });
});

// API Info endpoint
app.get('/api/system-info', (_req, res) => {
  res.json({
    name: 'Zarządzanie Projektami',
    description: 'System zarządzania projektami z wykresem Gantta, terminarzem i integracją Google Calendar na żywo',
    version: '2026-10-29 v 0.3.3',
    deployment: 'Docker & PostgreSQL Ready',
    features: [
      'Gantt Chart Interactive Timeline with Project Names on Bars',
      'Dependency & Blocker Engine',
      'Shared Server-side State Persistence across all PCs',
      'Google Calendar Live Subscription as Another Calendar',
      'Hierarchical Task Tree with Overdue and Approaching Animations',
      'User Authentication and Administrator Approval Gate',
    ],
  });
});

// Robust static file serving
const candidateDistPaths = [
  path.resolve(__dirname),
  path.resolve(__dirname, 'dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd()),
];

const distPath = candidateDistPaths.find((p) => fs.existsSync(path.join(p, 'index.html'))) || path.resolve(__dirname, 'dist');
console.log(`[Server] Serving static assets from: ${distPath}`);

app.use(express.static(distPath, { index: false, maxAge: '1h' }));

// Fallback to index.html for SPA client routing (compatible with Express 4 and Express 5)
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();

  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(indexPath);
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Zarządzanie Projektami running on port ${PORT}`);
});
