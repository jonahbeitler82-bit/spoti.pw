// Builds a demo vault (~120 linked notes in 12 folders) for when no real vault is found.
// Run directly with `npm run demo` to rebuild it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.resolve(HERE, '..', 'demo-vault');

const FOLDERS = {
  Business: ['Business MOC', 'Q4 Strategy', 'Pricing Experiments', 'Customer Interviews', 'Pitch Deck Notes', 'Competitor Map', 'Revenue Model', 'Hiring Plan', 'Brand Voice', 'Partnership Ideas', 'Weekly Metrics', 'Go-to-Market', 'Investor Updates', 'Churn Analysis'],
  Projects: ['Projects MOC', 'Portfolio Website', 'Habit Tracker App', 'Home Lab Server', 'Podcast Launch', 'Keyboard Build', 'Newsletter', 'Photo Book', 'Smart Home Dashboard', '3D Printer Mods', 'Garden Planner'],
  Ideas: ['Idea Inbox', 'Startup Ideas', 'App Concepts', 'Shower Thoughts', 'Video Ideas', 'Product Names', 'Weekend Experiments', 'Writing Prompts', 'Future Features'],
  Learning: ['Learning MOC', 'Spaced Repetition', 'Three.js Basics', 'Shader Notes', 'Swift Concurrency', 'Japanese Kana', 'Statistics Refresher', 'Typography Basics', 'Color Theory', 'Systems Thinking'],
  Health: ['Health Dashboard', 'Sleep Log', 'Running Plan', 'Strength Training', 'Meal Prep', 'Meditation', 'Morning Routine'],
  People: ['People MOC', 'Mentor Notes', 'Team Offsite', 'Family Birthdays', 'Networking', '1-on-1 Template', 'Collaborators'],
  Books: ['Reading List', 'Atomic Habits', 'Deep Work', 'The Pragmatic Programmer', 'Thinking, Fast and Slow', 'Show Your Work', 'The Design of Everyday Things', 'Four Thousand Weeks', 'Building a Second Brain'],
  Music: ['Music MOC', 'Production Workflow', 'Synth Patches', 'Album Rotation', 'Chord Progressions', 'Mixing Checklist'],
  Tech: ['Tech Stack', 'Dotfiles', 'Git Tricks', 'Obsidian Plugins', 'Raycast Scripts', 'Docker Notes', 'AI Prompts', 'Backup Strategy'],
  Travel: ['Travel Bucket List', 'Japan Trip', 'Lisbon Weekend', 'Packing List', 'Iceland Roadtrip', 'Favorite Cafés'],
  Finance: ['Finance Overview', 'Budget 2026', 'Investing Principles', 'Subscriptions Audit', 'Emergency Fund'],
};

const SENTENCES = [
  'Started as a quick note and slowly turned into something bigger.',
  'The core idea: make the next step obvious and small.',
  'Worth revisiting once the dust settles.',
  'Keep this simple. Complexity can come later, if ever.',
  'A pattern keeps showing up here, and it is worth naming.',
  'Short version: fewer things, done properly.',
  'Open question: what would this look like if it were easy?',
  'Collected a few references; the best ones are linked below.',
  'This connects to a lot of other notes, which is a good sign.',
  'Rule of thumb: write it down before it disappears.',
  'Tried it for two weeks. Results are promising.',
  'The constraint is the feature.',
  'Need to test this with real people, not just in my head.',
  'Most of the value came from the first 20% of the work.',
];
const BULLETS = [
  'Draft a first version', 'Ask for feedback', 'Measure what changed', 'Write a short summary', 'Cut what does not matter',
  'Schedule a review in 30 days', 'Find one good example', 'Sketch it on paper first', 'Turn it into a checklist', 'Share it publicly',
];
const LOG_LINES = [
  'Deep work block in the morning, felt good.', 'Long walk, cleared my head.', 'Too many meetings today.', 'Read for an hour before bed.',
  'Shipped a small thing, felt great.', 'Slept badly, slow start.', 'Gym, then groceries.', 'Called family.', 'Rainy day, stayed in and wrote.',
  'Finally fixed that annoying bug.', 'Coffee with a friend.', 'Inbox zero for once.',
];

function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = 86400000;

export function makeDemoVault({ dir = DEMO_DIR, force = false } = {}) {
  if (fs.existsSync(dir) && !force) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  const rand = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const today = new Date();
  today.setHours(9, 0, 0, 0);

  const notes = [];
  for (const [folder, titles] of Object.entries(FOLDERS)) {
    titles.forEach((title, i) => {
      // The hub note comes first; the rest skew towards recent months, like a real vault that grows.
      const age = i === 0 ? 330 + rand() * 60 : Math.floor(400 * Math.pow(1 - rand(), 1.55));
      notes.push({ folder, title, hub: i === 0, created: new Date(today.getTime() - age * DAY), links: new Set() });
    });
  }
  const byFolder = (f) => notes.filter((n) => n.folder === f);
  for (const n of notes) {
    const siblings = byFolder(n.folder).filter((s) => s !== n);
    if (n.hub) { siblings.forEach((s) => n.links.add(s.title)); continue; }
    const k = 1 + Math.floor(rand() * 3);
    for (let j = 0; j < k; j++) {
      const target = rand() < 0.68 ? pick(siblings) : pick(notes.filter((o) => o.folder !== n.folder));
      if (target && target !== n) n.links.add(target.title);
    }
  }

  const write = (rel, text, date) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    // file dates match the note's creation date, like a vault that grew over time
    if (date && date < today) fs.utimesSync(abs, date, date);
  };

  write('.obsidian/daily-notes.json', JSON.stringify({ folder: 'Journal', format: 'YYYY-MM-DD' }, null, 2));
  write('.obsidian/app.json', '{}');

  for (const n of notes) {
    const links = [...n.links];
    const inText = links.slice(0, 2);
    const related = links.slice(2);
    const body = [
      '---',
      `created: ${ymd(n.created)}`,
      `tags: [${n.folder.toLowerCase()}${n.hub ? ', moc' : ''}]`,
      '---',
      `# ${n.title}`,
      '',
      `${pick(SENTENCES)} ${inText.length ? `See [[${inText[0]}]]${inText[1] ? ` and [[${inText[1]}]]` : ''}.` : ''} ${pick(SENTENCES)}`,
      '',
      '## Next',
      ...Array.from({ length: 2 + Math.floor(rand() * 3) }, () => `- [${rand() < 0.4 ? 'x' : ' '}] ${pick(BULLETS)}`),
      '',
      related.length ? `Related: ${related.map((t) => `[[${t}]]`).join(', ')}` : '',
      '',
    ].join('\n');
    write(`${n.folder}/${n.title}.md`, body, n.created);
  }

  // Journal: the last 19 days in a row plus scattered older entries, with a mood each.
  const days = new Set();
  for (let d = 0; d < 19; d++) days.add(d);
  for (let i = 0; i < 9; i++) days.add(25 + Math.floor(rand() * 300));
  for (const d of [...days].sort((a, b) => b - a)) {
    const date = new Date(today.getTime() - d * DAY);
    const mood = Math.max(1, Math.min(5, Math.round(3.4 + (rand() - 0.45) * 2.6)));
    const recent = notes.filter((n) => Math.abs(n.created - date) < 20 * DAY);
    const mentions = [pick(recent.length ? recent : notes), pick(notes)].map((n) => n.title);
    const lines = [
      '---',
      `created: ${ymd(date)}`,
      `mood: ${mood}`,
      '---',
      `# ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
      '',
      '## Log',
      `- ${pick(LOG_LINES)}`,
      `- Worked on [[${mentions[0]}]].`,
      rand() < 0.6 ? `- Thought about [[${mentions[1]}]].` : `- ${pick(LOG_LINES)}`,
      '',
    ];
    write(`Journal/${ymd(date)}.md`, lines.join('\n'), date);
  }
  return dir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = makeDemoVault({ force: process.argv.includes('--force') });
  console.log(`Demo vault ready: ${dir}`);
}
