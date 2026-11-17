import { dayKey, startOfDay } from './data.js';
import { esc } from './markdown.js';
import { SCHEMES, gradientAt, rgbToCss } from './palettes.js';

const DAY = 86400000;
const $ = (sel, root = document) => root.querySelector(sel);

export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function renderDashboard(data, scheme) {
  const s = data.stats;
  const now = new Date();
  $('#dash-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const greet = greetingFor(now);
  const late = greet === 'Still up';
  $('#dash-greeting').innerHTML = data.name
    ? `${greet}, <em>${esc(data.name)}</em>${late ? '?' : '.'}`
    : `${greet}${late ? '?' : '.'} <button class="set-name" id="set-name">Set your name</button>`;
  $('#dash-stats').innerHTML = [
    `<b>${s.notes}</b> notes`, `<b>${s.links}</b> links`, `<b>${s.galaxies}</b> ${s.galaxies === 1 ? 'galaxy' : 'galaxies'}`,
    `<b>${s.newThisWeek}</b> new this week`,
  ].join('<span class="sep">·</span>');
  $('#vault-name').textContent = data.vaultName;
  $('#mini-caption').textContent = `LIVE · ${s.galaxies} ${s.galaxies === 1 ? 'GALAXY' : 'GALAXIES'}`;

  const notice = $('#demo-notice');
  if (data.demo) {
    notice.hidden = false;
    notice.innerHTML = `Showing the <b>demo vault</b>. No Obsidian vault was found at <code>${esc(data.missing || '')}</code> — set <code>vaultPath</code> in <code>vault.config.json</code> and restart.`;
  } else if (data.otherVaults?.length) {
    notice.hidden = false;
    notice.innerHTML = `Showing <b>${esc(data.vaultName)}</b>, your most recently used vault. Also found: ${data.otherVaults.map(esc).join(', ')} — pick one with <code>vaultPath</code> in <code>vault.config.json</code>.`;
  } else notice.hidden = true;

  renderCards(data, scheme);
  renderToday(data);
  renderMood(data);
  renderStreak(data);
  renderHeatmap(data);
}

function renderCards(data, scheme) {
  const s = data.stats;
  const stops = (SCHEMES[scheme] || SCHEMES.neon).stops;
  const dots = data.galaxies.slice(0, 14).map((g) => {
    const c = rgbToCss(gradientAt(stops, (g.slot + 0.5) / data.galaxies.length));
    return `<i style="background:${c};box-shadow:0 0 8px ${c}"></i>`;
  }).join('');

  // notes created per week, last 16 weeks
  const today = startOfDay(Date.now());
  const weeks = new Array(16).fill(0);
  for (const n of data.notes) {
    const w = Math.floor((today - startOfDay(n.created)) / (7 * DAY));
    if (w >= 0 && w < 16) weeks[15 - w]++;
  }
  const max = Math.max(1, ...weeks);
  const spark = weeks.map((v) => `<i style="height:${Math.max(6, (v / max) * 100)}%"></i>`).join('');
  const lastDaily = data.notes.filter((n) => n.daily).sort((a, b) => b.created - a.created)[0];
  const lastText = lastDaily ? relDay(lastDaily.created) : 'no entries yet';
  const gradient = `linear-gradient(90deg, ${stops.join(', ')})`;

  $('#cards').innerHTML = `
    <button class="card nav-card" data-go="universe">
      <span class="card-label">Universe</span>
      <span class="card-num">${s.galaxies}</span>
      <span class="card-sub">${s.galaxies === 1 ? 'galaxy' : 'galaxies'}</span>
      <span class="card-dots">${dots}</span>
      <span class="card-arrow">↗</span>
    </button>
    <button class="card nav-card" data-go="brain">
      <span class="card-label">Brain</span>
      <span class="card-num">${s.galaxies}</span>
      <span class="card-sub">${s.galaxies === 1 ? 'region' : 'regions'}</span>
      <span class="card-gradient" style="background:${gradient}"></span>
      <span class="card-arrow">↗</span>
    </button>
    <button class="card nav-card" data-go="notes">
      <span class="card-label">Notes</span>
      <span class="card-num">${s.notes}</span>
      <span class="card-sub">notes · ${s.links} links</span>
      <span class="card-spark">${spark}</span>
      <span class="card-arrow">⌘K</span>
    </button>
    <button class="card nav-card" data-go="journal">
      <span class="card-label">Journal</span>
      <span class="card-num">${s.journal}</span>
      <span class="card-sub">entries · last ${lastText}</span>
      <span class="card-moon"></span>
      <span class="card-arrow">↗</span>
    </button>`;
}

function relDay(ms) {
  const d = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderToday(data) {
  const lines = data.today.lines;
  const list = lines.length
    ? `<ul class="today-list">${lines.map((l) => `<li>${esc(l.replace(/^[-*+]\s+(\[.\]\s+)?/, '')).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => `<span class="wl-chip">${a || t}</span>`)}</li>`).join('')}</ul>`
    : '<p class="empty">Nothing in today\'s note yet. Capture a thought above.</p>';
  const vault = encodeURIComponent(data.vaultName);
  const file = encodeURIComponent(data.today.path.replace(/\.md$/, ''));
  $('#today').innerHTML = `
    <div class="card-head"><span class="card-label">Today</span><span class="card-meta">${esc(data.today.path)}</span></div>
    ${list}
    <div class="card-foot">
      <span>${data.stats.touchedToday} ${data.stats.touchedToday === 1 ? 'note' : 'notes'} touched today</span>
      ${data.today.exists && !data.demo ? `<a href="obsidian://open?vault=${vault}&file=${file}">Open in Obsidian ↗</a>` : ''}
    </div>`;
}

const MOOD_LABEL = ['', 'rough', 'low', 'okay', 'good', 'great'];

const noonToday = () => startOfDay(Date.now()) + 12 * 3600000;

function renderMood(data) {
  const moods = data.stats.moods;
  const today = noonToday();
  const vals = [];
  for (let i = 29; i >= 0; i--) vals.push(moods.get(dayKey(today - i * DAY)) ?? null);
  const have = vals.filter((v) => v != null);
  const el = $('#mood');
  if (!have.length) {
    el.innerHTML = `<div class="card-head"><span class="card-label">Mood</span><span class="card-meta">last 30 days</span></div>
      <p class="empty">No mood logged yet. Add <code>mood: 1–5</code> to the frontmatter of your daily notes.</p>`;
    return;
  }
  const avg = have.reduce((a, b) => a + b, 0) / have.length;
  const color = (v) => (v >= 4 ? 'var(--mood-hi)' : v >= 3 ? 'var(--mood-mid)' : 'var(--mood-lo)');
  const bars = vals.map((v, i) => {
    const date = new Date(today - (29 - i) * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return v == null
      ? `<i class="none" title="${date}: no entry"></i>`
      : `<i title="${date}: ${MOOD_LABEL[Math.round(v)]} (${v})" style="height:${18 + (v - 1) * 20.5}%;background:${color(v)}"></i>`;
  }).join('');
  el.innerHTML = `
    <div class="card-head"><span class="card-label">Mood</span><span class="card-meta">last 30 days</span></div>
    <div class="mood-avg"><span class="big">${avg.toFixed(1)}</span><span>avg · mostly ${MOOD_LABEL[Math.round(avg)]}</span></div>
    <div class="mood-bars">${bars}</div>`;
}

function renderStreak(data) {
  const s = data.stats;
  const today = noonToday();
  const created = s.created;
  const dots = [];
  for (let i = 13; i >= 0; i--) dots.push(`<i class="${created.has(dayKey(today - i * DAY)) ? 'on' : ''}"></i>`);
  $('#streak').innerHTML = `
    <div class="card-head"><span class="card-label">Streak</span><span class="card-meta">writing</span></div>
    <div class="streak-num"><span class="big">${s.streak}</span><span>${s.streak === 1 ? 'day' : 'days'} in a row</span></div>
    <div class="streak-dots">${dots.join('')}</div>
    <div class="card-foot"><span>Longest: ${s.longest} ${s.longest === 1 ? 'day' : 'days'}</span></div>`;
}

function renderHeatmap(data) {
  const created = data.stats.created;
  const today = noonToday();
  // weeks start on Monday; 53 columns ending with the current week
  const dow = (new Date(today).getDay() + 6) % 7;
  const start = today - (dow + 52 * 7) * DAY;
  let total = 0;
  const counts = [];
  for (let t = start; t <= today; t += DAY) { const c = created.get(dayKey(t)) || 0; counts.push([t, c]); total += c; }
  const nonzero = counts.map((c) => c[1]).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => nonzero[Math.floor(p * (nonzero.length - 1))] || 1;
  const levels = [q(0.25), q(0.5), q(0.8)];
  const level = (c) => (c === 0 ? 0 : c <= levels[0] ? 1 : c <= levels[1] ? 2 : c <= levels[2] ? 3 : 4);
  const cells = counts.map(([t, c]) => {
    const label = `${c} ${c === 1 ? 'note' : 'notes'} on ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    return `<i class="l${level(c)}" title="${label}"></i>`;
  }).join('');
  const months = [];
  let lastMonth = -1;
  for (let w = 0; w < 53; w++) {
    const m = new Date(start + w * 7 * DAY).getMonth();
    if (m !== lastMonth) { months.push(`<span style="grid-column:${w + 1}">${new Date(start + w * 7 * DAY).toLocaleDateString('en-US', { month: 'short' })}</span>`); lastMonth = m; }
  }
  $('#heatmap').innerHTML = `
    <div class="card-head"><span class="card-label">Year</span><span class="card-meta">${total} notes written in the last year</span></div>
    <div class="heat-scroll">
      <div class="heat-months">${months.join('')}</div>
      <div class="heat-body">
        <div class="heat-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
        <div class="heat-grid">${cells}</div>
      </div>
    </div>
    <div class="heat-legend">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div>`;
}
