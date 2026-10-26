import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Healthcheck endpoint for Docker & Kubernetes
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    postgresStatus: process.env.DATABASE_URL ? 'configured' : 'standalone-demo',
  });
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

// Server-side cache of current tasks and users for Google Calendar live crawler polling
let serverTasksCache: any[] = [];
let serverUsersCache: any[] = [];

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

// API Info endpoint
app.get('/api/system-info', (_req, res) => {
  res.json({
    name: 'Zarządzanie Projektami',
    description: 'System zarządzania projektami z wykresem Gantta, terminarzem i integracją Google Calendar na żywo',
    version: '1.1.0',
    deployment: 'Docker & PostgreSQL Ready',
    features: [
      'Gantt Chart Interactive Timeline',
      'Dependency & Blocker Engine',
      'Google Calendar Live Two-Way Subscription (Moje Kalendarze)',
      'Multi-User Roles & Live Audit Log',
      'Docker Compose & PostgreSQL 16 Self-Hosting',
    ],
  });
});

// Serve production assets if dist directory exists
const distPath = fs.existsSync(path.resolve(__dirname, 'index.html'))
  ? __dirname
  : path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA client routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`OpenProject Hub running on port ${PORT}`);
});
