// Reads an Obsidian vault (read only) and appends captures to today's daily note.
// The capture is the only write this app ever makes inside a vault.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = path.join(APP_ROOT, 'demo-vault');
const CONFIG_FILE = path.join(APP_ROOT, 'vault.config.json');
export const ICLOUD_DIR = '~/Library/Mobile Documents/iCloud~md~obsidian/Documents';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// ---------- config ----------

export function readConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* no config yet */ }
  return {
    vaultPath: process.env.VAULT_PATH || cfg.vaultPath || ICLOUD_DIR,
    name: (process.env.VAULT_USER ?? cfg.name ?? '').trim(),
  };
}

export function writeConfig(patch) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* new file */ }
  if (!cfg.vaultPath) cfg.vaultPath = ICLOUD_DIR;
  Object.assign(cfg, patch);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

const expandHome = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isVault = (p) => isDir(path.join(p, '.obsidian'));

function lastUsed(dir) {
  for (const f of ['.obsidian/workspace.json', '.obsidian/workspace-mobile.json', '.obsidian']) {
    try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { /* try next */ }
  }
  return 0;
}

function hasMarkdown(dir, depth = 0) {
  if (depth > 2) return false;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile() && e.name.endsWith('.md')) return true;
    if (e.isDirectory() && hasMarkdown(path.join(dir, e.name), depth + 1)) return true;
  }
  return false;
}

/** Finds the vault to show: the configured folder, or the most recently used vault inside it. */
export function resolveVault(cfg = readConfig()) {
  const wanted = path.resolve(expandHome(cfg.vaultPath));
  if (isDir(wanted)) {
    if (isVault(wanted)) return { path: wanted, demo: false, others: [] };
    const subs = fs.readdirSync(wanted, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && isVault(path.join(wanted, e.name)))
      .map((e) => path.join(wanted, e.name))
      .sort((a, b) => lastUsed(b) - lastUsed(a));
    if (subs.length) return { path: subs[0], demo: false, others: subs.slice(1) };
    if (hasMarkdown(wanted)) return { path: wanted, demo: false, others: [] };
  }
  return { path: DEMO_DIR, demo: true, others: [], missing: wanted };
}

// ---------- parsing helpers ----------

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text };
  const raw = text.slice(3, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1 || text.length);
  const fm = {};
  let listKey = null;
  for (const line of raw.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { fm[listKey].push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z0-9_ \-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim();
    if (val === '') { fm[key] = []; listKey = key; continue; }
    listKey = null;
    if (val.startsWith('[') && val.endsWith(']')) fm[key] = val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    else fm[key] = unquote(val);
  }
  return { fm, body };
}

const unquote = (s) => s.replace(/^["']|["']$/g, '');

function parseDateValue(v) {
  if (!v || Array.isArray(v)) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(v));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const MOOD_WORDS = {
  amazing: 5, great: 5, awesome: 5, super: 5, fantastic: 5, 'sehr gut': 5,
  good: 4, gut: 4, happy: 4,
  ok: 3, okay: 3, fine: 3, neutral: 3, normal: 3,
  meh: 2, bad: 2, mies: 2, schlecht: 2, tired: 2, müde: 2,
  awful: 1, terrible: 1, furchtbar: 1, horrible: 1,
};
const MOOD_EMOJI = { '😄': 5, '😁': 5, '🤩': 5, '😀': 5, '🙂': 4, '😊': 4, '😐': 3, '😶': 3, '😕': 2, '🙁': 2, '😞': 2, '😢': 1, '😭': 1, '😫': 1 };

function parseMood(fm, body) {
  let v = fm.mood ?? fm.stimmung ?? fm.feeling;
  if (v == null) {
    const inline = /^(?:mood|stimmung)::\s*(.+)$/im.exec(body);
    if (inline) v = inline[1].trim();
  }
  if (v == null || Array.isArray(v)) return null;
  const s = String(v).trim();
  const num = parseFloat(s);
  if (!Number.isNaN(num)) {
    const scaled = num > 5 ? num / 2 : num;
    return Math.max(1, Math.min(5, scaled));
  }
  for (const [e, n] of Object.entries(MOOD_EMOJI)) if (s.includes(e)) return n;
  return MOOD_WORDS[s.toLowerCase()] ?? null;
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function extractLinks(body) {
  const out = [];
  const clean = stripCode(body);
  const wiki = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = wiki.exec(clean))) out.push(m[1].trim());
  const md = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
  while ((m = md.exec(clean))) {
    if (/^[a-z]+:\/\//i.test(m[1])) continue;
    try { out.push(decodeURIComponent(m[1]).replace(/\.md$/, '')); } catch { /* bad escape */ }
  }
  return out;
}

function plainExcerpt(body, max = 260) {
  const text = stripCode(body.replace(/^\s*#\s+[^\n]*\n/, ''))
    .replace(/^#+\s+/gm, '')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>]/g, '')
    .replace(/^\s*[-+]\s+(\[.\]\s+)?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text;
}

// ---------- daily notes ----------

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Moment-style format -> string, for the tokens Obsidian's daily notes use. */
export function formatDate(date, format, lang = 'en') {
  const months = lang === 'de' ? MONTHS_DE : MONTHS_EN;
  const days = lang === 'de' ? DAYS_DE : DAYS_EN;
  const pad = (n) => String(n).padStart(2, '0');
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DD|Do|D|dddd|ddd|HH|mm/g, (tok, lit) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case 'YYYY': return String(date.getFullYear());
      case 'YY': return String(date.getFullYear()).slice(2);
      case 'MMMM': return months[date.getMonth()];
      case 'MMM': return months[date.getMonth()].slice(0, 3);
      case 'MM': return pad(date.getMonth() + 1);
      case 'M': return String(date.getMonth() + 1);
      case 'DD': return pad(date.getDate());
      case 'Do': {
        const d = date.getDate();
        if (lang === 'de') return d + '.';
        return d + ((d % 100 >= 11 && d % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][d % 10] || 'th'));
      }
      case 'D': return String(date.getDate());
      case 'dddd': return days[date.getDay()];
      case 'ddd': return days[date.getDay()].slice(0, 3);
      case 'HH': return pad(date.getHours());
      case 'mm': return pad(date.getMinutes());
      default: return tok;
    }
  });
}

/** Moment-style format -> RegExp that reads a date back out of a file path. */
function formatToRegex(format) {
  const groups = [];
  const names = [...MONTHS_EN, ...MONTHS_DE].map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const dayNames = [...DAYS_EN, ...DAYS_DE];
  let src = '';
  let rest = format;
  const re = /^(\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|Do|D|dddd|ddd)/;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) { src += rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); rest = rest.slice(1); continue; }
    const tok = m[1];
    rest = rest.slice(tok.length);
    if (m[2] !== undefined) { src += m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    switch (tok) {
      case 'YYYY': src += '(\\d{4})'; groups.push('Y'); break;
      case 'YY': src += '(\\d{2})'; groups.push('y'); break;
      case 'MMMM': src += `(${names.join('|')})`; groups.push('Mn'); break;
      case 'MMM': src += `(${names.map((n) => n.slice(0, 3)).join('|')})`; groups.push('Ms'); break;
      case 'MM': case 'M': src += '(\\d{1,2})'; groups.push('M'); break;
      case 'DD': case 'D': src += '(\\d{1,2})'; groups.push('D'); break;
      case 'Do': src += '(\\d{1,2})(?:st|nd|rd|th|\\.)'; groups.push('D'); break;
      case 'dddd': src += `(?:${dayNames.join('|')})`; break;
      case 'ddd': src += `(?:${dayNames.map((n) => n.slice(0, 3)).join('|')})`; break;
    }
  }
  const rx = new RegExp(`(?:^|/)${src}$`, 'i');
  return (str) => {
    const m = rx.exec(str);
    if (!m) return null;
    let y = 0, mo = 0, d = 1;
    groups.forEach((g, i) => {
      const v = m[i + 1];
      if (g === 'Y') y = +v;
      else if (g === 'y') y = 2000 + +v;
      else if (g === 'M') mo = +v - 1;
      else if (g === 'D') d = +v;
      else {
        const lower = v.toLowerCase();
        const idx = [...MONTHS_EN, ...MONTHS_DE].findIndex((n) => (g === 'Mn' ? n : n.slice(0, 3)).toLowerCase() === lower);
        mo = idx % 12;
      }
    });
    if (!y) return null;
    const date = new Date(y, mo, d, 9, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };
}

/** Where today's note lives: core Daily notes or Periodic Notes settings, else a guess from existing files. */
export function dailyConfig(vault, relPaths = null) {
  const core = readJson(path.join(vault, '.obsidian/daily-notes.json')) || {};
  const periodic = readJson(path.join(vault, '.obsidian/plugins/periodic-notes/data.json'));
  const p = periodic?.daily?.enabled ? periodic.daily : null;
  let folder = (p?.folder ?? core.folder ?? '').replace(/^\/+|\/+$/g, '');
  const format = (p?.format || core.format || 'YYYY-MM-DD').trim();
  const template = (p?.template ?? core.template ?? '').trim();
  const configured = Boolean(p?.folder || core.folder);
  if (!configured && relPaths) {
    // No setting: put today's note where most date-named notes already are.
    const counts = new Map();
    for (const rel of relPaths) {
      if (/\d{4}-\d{2}-\d{2}/.test(path.basename(rel))) {
        const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
        counts.set(dir, (counts.get(dir) || 0) + 1);
      }
    }
    let best = '', bestN = 0;
    for (const [dir, n] of counts) if (n > bestN) { best = dir; bestN = n; }
    folder = best;
  }
  return { folder, format, template, parse: formatToRegex(format) };
}

// ---------- the vault scan ----------

async function walk(root) {
  const out = [];
  async function visit(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await visit(abs);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(abs);
    }
  }
  await visit(root);
  return out;
}

let lastIndex = null; // path -> note, for /api/note lookups

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function scanVault(vaultInfo) {
  const vault = vaultInfo.path;
  const files = await walk(vault);
  const rels = files.map((f) => path.relative(vault, f).split(path.sep).join('/'));
  const daily = dailyConfig(vault, rels);
  const dailyPrefix = daily.folder ? daily.folder + '/' : '';

  const notes = [];
  // a few files at a time: macOS allows only ~256 open files per process by default
  await mapLimit(files, 24, async (abs, i) => {
    const rel = rels[i];
    let text, stat;
    try {
      [text, stat] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
    } catch { return; }
    const { fm, body } = splitFrontmatter(text);
    const base = path.basename(rel, '.md');
    const parts = rel.split('/');
    const folder = parts.length > 1 ? parts[0] : 'Inbox';

    const inDaily = dailyPrefix ? rel.startsWith(dailyPrefix) : parts.length === 1;
    const dailyDate = inDaily ? daily.parse(rel.slice(dailyPrefix.length).replace(/\.md$/, '')) : null;
    const birth = stat.birthtimeMs > 0 ? Math.min(stat.birthtimeMs, stat.mtimeMs) : stat.mtimeMs;
    const created = parseDateValue(fm.created ?? fm['date created'] ?? fm.created_at ?? fm.createdat ?? fm.date)
      ?? dailyDate
      ?? parseDateValue(/\d{4}-\d{2}-\d{2}/.exec(base)?.[0])
      ?? birth;
    const aliases = [].concat(fm.aliases ?? fm.alias ?? []).map(String);
    const words = (stripCode(body).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

    notes.push({
      title: base,
      path: rel,
      folder,
      created,
      modified: stat.mtimeMs,
      words,
      excerpt: plainExcerpt(body),
      mood: dailyDate != null ? parseMood(fm, body) : null,
      daily: dailyDate != null,
      tags: [].concat(fm.tags ?? []).map(String).slice(0, 8),
      _links: extractLinks(body),
      _aliases: aliases,
    });
  });

  notes.sort((a, b) => a.created - b.created || a.path.localeCompare(b.path));
  notes.forEach((n, i) => { n.id = i; });

  // Resolve links the way Obsidian does: full path, else shortest match by name or alias.
  const byPath = new Map();
  const byName = new Map();
  const add = (key, n) => { if (!byName.has(key)) byName.set(key, []); byName.get(key).push(n); };
  for (const n of notes) {
    byPath.set(n.path.replace(/\.md$/, '').toLowerCase(), n);
    add(n.title.toLowerCase(), n);
    n._aliases.forEach((a) => add(a.toLowerCase(), n));
  }
  const edges = new Set();
  const links = [];
  for (const n of notes) {
    const out = new Set();
    for (const raw of n._links) {
      const key = raw.replace(/\.md$/, '').replace(/^\.?\//, '').toLowerCase();
      let target = byPath.get(key);
      if (!target) {
        const cands = byName.get(key.split('/').pop()) || [];
        target = cands.find((c) => c.folder === n.folder) || cands[0];
      }
      if (!target || target === n) continue;
      out.add(target.id);
      const a = Math.min(n.id, target.id), b = Math.max(n.id, target.id);
      const k = a * 1e6 + b;
      if (!edges.has(k)) { edges.add(k); links.push([a, b]); }
    }
    n.out = [...out];
    delete n._links;
    delete n._aliases;
  }

  // Root-level notes form an "Inbox" galaxy. Very many tiny folders get merged into "Other".
  const counts = new Map();
  for (const n of notes) counts.set(n.folder, (counts.get(n.folder) || 0) + 1);
  if (counts.size > 18) {
    const keep = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 17).map((e) => e[0]));
    for (const n of notes) if (!keep.has(n.folder)) n.folder = 'Other';
  }

  // Today's note: path and its last lines, for the dashboard's Today card.
  const lang = detectLang(rels);
  const todayRel = (dailyPrefix + formatDate(new Date(), daily.format, lang) + '.md');
  let todayLines = [];
  try {
    const { body } = splitFrontmatter(await fsp.readFile(path.join(vault, todayRel), 'utf8'));
    todayLines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l !== '---').slice(-8);
  } catch { /* no note yet today */ }

  lastIndex = new Map(notes.map((n) => [n.path, n]));
  const cfg = readConfig();
  return {
    vaultName: path.basename(vault),
    demo: vaultInfo.demo,
    missing: vaultInfo.demo ? vaultInfo.missing : undefined,
    otherVaults: vaultInfo.others.map((o) => path.basename(o)),
    name: cfg.name,
    dailyFolder: daily.folder,
    today: { path: todayRel, exists: todayLines.length > 0 || fs.existsSync(path.join(vault, todayRel)), lines: todayLines },
    generatedAt: Date.now(),
    notes,
    links,
  };
}

function detectLang(rels) {
  const de = new RegExp(`\\b(${[...MONTHS_DE, ...DAYS_DE].filter((m) => !MONTHS_EN.includes(m)).join('|')})\\b`, 'i');
  return rels.some((r) => de.test(r)) ? 'de' : 'en';
}

export async function readNote(vaultInfo, rel) {
  if (!lastIndex) await scanVault(vaultInfo);
  const note = lastIndex.get(rel);
  if (!note) return null; // only notes found by the scan can be read
  const abs = path.resolve(vaultInfo.path, rel);
  if (!abs.startsWith(path.resolve(vaultInfo.path) + path.sep)) return null;
  const text = await fsp.readFile(abs, 'utf8');
  const { body } = splitFrontmatter(text);
  return { path: rel, title: note.title, body: body.slice(0, 40000) };
}

// ---------- capture ----------

function applyTemplate(tpl, date, title) {
  return tpl
    .replace(/\{\{\s*date:([^}]+)\}\}/g, (_, f) => formatDate(date, f.trim()))
    .replace(/\{\{\s*time:([^}]+)\}\}/g, (_, f) => formatDate(date, f.trim()))
    .replace(/\{\{\s*date\s*\}\}/g, formatDate(date, 'YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, formatDate(date, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, title);
}

/** Appends one line to today's daily note. Creates the note if it doesn't exist yet. Never rewrites. */
export async function capture(vaultInfo, rawText) {
  const text = String(rawText ?? '').trim().slice(0, 4000);
  if (!text) throw new Error('Nothing to capture');
  const vault = path.resolve(vaultInfo.path);
  const files = await walk(vault);
  const rels = files.map((f) => path.relative(vault, f).split(path.sep).join('/'));
  const daily = dailyConfig(vault, rels);
  const now = new Date();
  const name = formatDate(now, daily.format, detectLang(rels));
  const rel = (daily.folder ? daily.folder + '/' : '') + name + '.md';
  const abs = path.resolve(vault, rel);
  if (!abs.startsWith(vault + path.sep)) throw new Error('Daily note path leaves the vault');

  const line = `- ${formatDate(now, 'HH:mm')} ${text.replace(/\r?\n/g, '\n  ')}\n`;
  let created = false;
  let existing = null;
  try { existing = await fsp.readFile(abs, 'utf8'); } catch { /* new note */ }
  if (existing === null) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    let head = '';
    if (daily.template) {
      const tplPath = path.resolve(vault, daily.template.endsWith('.md') ? daily.template : daily.template + '.md');
      if (tplPath.startsWith(vault + path.sep)) {
        try { head = applyTemplate(await fsp.readFile(tplPath, 'utf8'), now, path.basename(name)); } catch { /* no template */ }
      }
    }
    if (head && !head.endsWith('\n')) head += '\n';
    // 'wx' fails instead of overwriting if Obsidian created the note in the meantime.
    try {
      await fsp.writeFile(abs, head + line, { flag: 'wx' });
      created = true;
    } catch {
      await fsp.appendFile(abs, line);
    }
  } else {
    await fsp.appendFile(abs, (existing.length && !existing.endsWith('\n') ? '\n' : '') + line);
  }
  return { path: rel, created, line: line.trim() };
}
