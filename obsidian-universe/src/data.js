import { colorSlot } from './palettes.js';

const DAY = 86400000;
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function loadVault() {
  const res = await fetch('/api/vault');
  if (!res.ok) throw new Error(`Vault could not be read (${res.status})`);
  return enrich(await res.json());
}

function enrich(data) {
  const { notes, links } = data;
  notes.forEach((n) => { n.degree = 0; n.backlinks = []; });
  for (const [a, b] of links) { notes[a].degree++; notes[b].degree++; }
  for (const n of notes) for (const t of n.out) notes[t].backlinks.push(n.id);

  const byFolder = new Map();
  for (const n of notes) {
    if (!byFolder.has(n.folder)) byFolder.set(n.folder, []);
    byFolder.get(n.folder).push(n.id);
  }
  const galaxies = [...byFolder.entries()]
    .map(([name, ids]) => ({ name, notes: ids, count: ids.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  galaxies.forEach((g, i) => {
    g.index = i;
    g.slot = colorSlot(i, galaxies.length);
    g.notes.forEach((id) => { notes[id].galaxy = i; });
  });
  data.galaxies = galaxies;
  data.stats = stats(data);
  return data;
}

function stats(data) {
  const now = Date.now();
  const today = startOfDay(now);
  const notes = data.notes;
  const newThisWeek = notes.filter((n) => n.created >= today - 6 * DAY).length;

  // activity per day: notes created, plus daily notes and edits
  const created = new Map();
  for (const n of notes) created.set(dayKey(n.created), (created.get(dayKey(n.created)) || 0) + 1);
  const active = new Set(created.keys());
  for (const n of notes) active.add(dayKey(n.modified));

  // walk days at noon so a daylight-saving switch never skips or repeats a date
  const noon = today + 12 * 3600000;
  let streak = 0;
  let d = noon;
  if (!active.has(dayKey(d))) d -= DAY; // today isn't over yet
  while (active.has(dayKey(d))) { streak++; d -= DAY; }

  let longest = 0, run = 0;
  const first = notes.length ? startOfDay(notes.reduce((m, n) => Math.min(m, n.created), Infinity)) + 12 * 3600000 : noon;
  for (let t = first; t <= noon; t += DAY) {
    if (active.has(dayKey(t))) { run++; longest = Math.max(longest, run); } else run = 0;
  }

  const moods = new Map();
  for (const n of notes) if (n.daily && n.mood != null) moods.set(dayKey(n.created), n.mood);
  const touchedToday = notes.filter((n) => n.created >= today || n.modified >= today).length;

  return {
    notes: notes.length,
    links: data.links.length,
    galaxies: data.galaxies.length,
    journal: notes.filter((n) => n.daily).length,
    newThisWeek, created, streak, longest: Math.max(longest, streak), moods, touchedToday,
  };
}
