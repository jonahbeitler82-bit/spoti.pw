import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { loadVault } from './data.js';
import { renderDashboard } from './dashboard.js';
import { renderMarkdown, esc } from './markdown.js';
import { SCHEMES, gradientAt, rgbToCss, loadScheme, saveScheme } from './palettes.js';
import { Recorder } from './ui/recorder.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  data: null,
  scheme: loadScheme(),
  main: null,
  mini: null,
  dirty: false,
  view: null,
  pending: null,
};
let Universe = null; // loaded on demand, keeps the first paint light
const loadUniverse = async () => (Universe ||= (await import('./universe/Universe.js')).Universe);

// ---------- boot ----------

async function boot() {
  try {
    state.data = await loadVault();
  } catch (err) {
    $('#boot').innerHTML = `<span>Couldn't read the vault: ${esc(err.message)}</span>`;
    return;
  }
  await document.fonts.load('500 12px "JetBrains Mono"').catch(() => {});
  applyAccent();
  renderDashboard(state.data, state.scheme);
  renderSchemes();
  $('#boot').remove();
  window.addEventListener('hashchange', route);
  route();
}

function applyAccent() {
  const stops = (SCHEMES[state.scheme] || SCHEMES.neon).stops;
  const accent = gradientAt(stops, 0.4);
  const root = document.documentElement.style;
  root.setProperty('--accent', rgbToCss(accent));
  root.setProperty('--accent-soft', rgbToCss(accent, 0.16));
  root.setProperty('--accent-glow', rgbToCss(accent, 0.45));
  root.setProperty('--scheme-gradient', `linear-gradient(90deg, ${stops.join(', ')})`);
}

// ---------- routing ----------

async function route() {
  const hash = location.hash;
  if (hash.startsWith('#/universe') || hash.startsWith('#/brain')) await showUniverse(hash.startsWith('#/brain'));
  else await showDashboard();
}

async function showDashboard() {
  state.view = 'dashboard';
  closePreview();
  if (state.main) state.main.stop();
  if (recorder.recording) recorder.stop();
  $('#universe').hidden = true;
  $('#dashboard').hidden = false;
  document.body.classList.remove('clean');
  const U = await loadUniverse();
  if (state.view !== 'dashboard') return;
  if (!state.mini || state.dirty) {
    state.mini?.dispose();
    state.mini = new U($('#mini-canvas'), state.data, { mini: true, scheme: state.scheme });
  }
  state.mini.start();
}

async function showUniverse(brain) {
  state.view = 'universe';
  $('#dashboard').hidden = true;
  $('#universe').hidden = false;
  state.mini?.stop();
  const U = await loadUniverse();
  if (!state.main || state.dirty) {
    state.main?.dispose();
    state.main = new U($('#u-canvas'), state.data, {
      scheme: state.scheme,
      onSelect: (id) => (id >= 0 ? openPreview(id, false) : closePreview()),
      onHover: showTooltip,
      onGrow: updateTimeline,
    });
    state.dirty = false;
    if (state.mini) { state.mini.dispose(); state.mini = null; }
  }
  const s = state.data.stats;
  $('#hud-vault').textContent = state.data.vaultName;
  $('#hud-sub').textContent = `${s.notes} NOTES · ${s.links} LINKS · ${s.galaxies} ${s.galaxies === 1 ? 'GALAXY' : 'GALAXIES'}`;
  state.main.start();
  if (brain !== state.main.isBrain) state.main.setMorph(brain ? 1 : 0);
  syncSeg();
  if (state.pending != null) {
    const id = state.pending;
    state.pending = null;
    focusNote(id);
  }
}

function go(view) {
  const hash = view === 'brain' ? '#/brain' : view === 'universe' ? '#/universe' : '#/';
  if (location.hash === hash) route(); else location.hash = hash;
}

// ---------- dashboard actions ----------

$('#cards').addEventListener('click', (e) => {
  const card = e.target.closest('[data-go]');
  if (!card) return;
  const where = card.dataset.go;
  if (where === 'notes') openSearch();
  else if (where === 'journal') {
    const latest = state.data.notes.filter((n) => n.daily).sort((a, b) => b.created - a.created)[0];
    if (latest) { state.pending = latest.id; }
    go('universe');
  } else go(where);
});
$('#mini').addEventListener('click', () => go('universe'));
$('#dash-search').addEventListener('click', () => openSearch());

$('#capture').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#capture-input');
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  try {
    const res = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Failed');
    input.value = '';
    toast(`Added to <b>${esc(out.path)}</b>`);
    state.data = await loadVault();
    if (out.created) state.dirty = true;
    renderDashboard(state.data, state.scheme);
    if (state.dirty && state.view === 'dashboard') showDashboard();
  } catch (err) {
    toast(`Couldn't save: ${esc(err.message)}`, true);
  } finally {
    input.disabled = false;
    input.focus();
  }
});

document.addEventListener('click', async (e) => {
  if (e.target.id !== 'set-name') return;
  const h1 = $('#dash-greeting');
  h1.innerHTML = '<form id="name-form" class="name-form"><input id="name-input" placeholder="Your first name" maxlength="40" /></form>';
  const input = $('#name-input');
  input.focus();
  $('#name-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    state.data.name = name;
    renderDashboard(state.data, state.scheme);
  });
});

// ---------- universe HUD ----------

$('#back').addEventListener('click', () => go('dashboard'));
$('#seg-universe').addEventListener('click', () => setMorph(false));
$('#seg-brain').addEventListener('click', () => setMorph(true));
$('#search-btn').addEventListener('click', () => openSearch());
$('#rec-btn').addEventListener('click', () => toggleRecord());
$('#hint').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  ({ morph: () => setMorph(!state.main.isBrain), grow: toggleGrow, record: toggleRecord, clean: toggleClean, search: () => openSearch() })[b.dataset.act]();
});

function setMorph(brain) {
  if (!state.main) return;
  state.main.setMorph(brain ? 1 : 0);
  history.replaceState(null, '', brain ? '#/brain' : '#/universe');
  syncSeg();
}

function syncSeg() {
  const brain = state.main?.isBrain;
  $('#seg-universe').classList.toggle('on', !brain);
  $('#seg-brain').classList.toggle('on', Boolean(brain));
}

function renderSchemes() {
  $('#schemes').innerHTML = Object.entries(SCHEMES).map(([key, s]) =>
    `<button data-scheme="${key}" class="${key === state.scheme ? 'on' : ''}" title="${s.name}" style="--g:linear-gradient(135deg, ${s.stops.join(', ')})"></button>`).join('');
}
$('#schemes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scheme]');
  if (!b) return;
  state.scheme = b.dataset.scheme;
  saveScheme(state.scheme);
  applyAccent();
  renderSchemes();
  state.main?.setScheme(state.scheme);
  state.mini?.setScheme(state.scheme);
  renderDashboard(state.data, state.scheme);
  toast(`Colour scheme: <b>${SCHEMES[state.scheme].name}</b>`);
});

// timeline
function toggleGrow() {
  const u = state.main;
  if (!u) return;
  if (u.grow.active) { u.stopGrow(); $('#timeline').hidden = true; }
  else { u.startGrow(); $('#timeline').hidden = false; }
}
function updateTimeline(g) {
  if (!g.active) return;
  $('#tl-play').textContent = g.playing ? '❚❚' : '▶';
  $('#tl-month').textContent = g.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  $('#tl-count').innerHTML = `<b>${g.count}</b> / ${g.total} notes`;
  if (!scrubbing) $('#tl-range').value = Math.round(g.t * 1000);
}
let scrubbing = false;
$('#tl-play').addEventListener('click', () => state.main?.toggleGrowPlaying());
$('#tl-close').addEventListener('click', () => toggleGrow());
$('#tl-range').addEventListener('input', (e) => {
  scrubbing = true;
  const u = state.main;
  if (u.grow.playing) u.toggleGrowPlaying();
  u.setGrowT(e.target.value / 1000);
});
$('#tl-range').addEventListener('change', () => { scrubbing = false; });

// recording
const recorder = new Recorder((s) => {
  const btn = $('#rec-btn');
  if (s.error) return toast(esc(s.error), true);
  if (s.recording) {
    const sec = Math.floor(s.seconds);
    btn.classList.add('on');
    btn.textContent = `■ Stop ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  } else {
    btn.classList.remove('on');
    btn.textContent = '● Record';
  }
  if (s.saved) toast(`Saved <b>${esc(s.saved)}</b> · ${s.seconds}s · ${(s.size / 1e6).toFixed(1)} MB`);
});
function toggleRecord() {
  if (!state.main) return;
  recorder.toggle(state.main);
}

function toggleClean() {
  const on = document.body.classList.toggle('clean');
  if (on) toast('Clean view · press <kbd>C</kbd> to bring the UI back', false, 1600);
}

// tooltip
function showTooltip(id, at) {
  const tip = $('#tooltip');
  if (id < 0 || !at) { tip.hidden = true; return; }
  const n = state.data.notes[id];
  tip.innerHTML = `<i style="background:${galaxyCss(n.galaxy)}"></i>${esc(n.title)}`;
  tip.style.transform = `translate(${at[0] + 14}px, ${at[1] + 12}px)`;
  tip.hidden = false;
}

function galaxyCss(gi) {
  const g = state.data.galaxies[gi];
  return rgbToCss(gradientAt((SCHEMES[state.scheme] || SCHEMES.neon).stops, (g.slot + 0.5) / state.data.galaxies.length));
}

// ---------- preview ----------

let previewToken = 0;
async function openPreview(id, fly = true) {
  const u = state.main;
  const n = state.data.notes[id];
  if (!n || !u) return;
  u.select(id);
  if (fly) u.flyToStar(id);
  const g = state.data.galaxies[n.galaxy];
  const related = [...new Set([...n.out, ...n.backlinks])].map((i) => state.data.notes[i]);
  const created = new Date(n.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const vault = encodeURIComponent(state.data.vaultName);
  const file = encodeURIComponent(n.path.replace(/\.md$/, ''));
  $('#preview-body').innerHTML = `
    <div class="pv-galaxy"><i style="background:${galaxyCss(n.galaxy)};box-shadow:0 0 10px ${galaxyCss(n.galaxy)}"></i>${esc(g.name.toUpperCase())}</div>
    <h2 class="pv-title">${esc(n.title)}</h2>
    <div class="pv-meta">${created} · ${n.words} words · ${n.degree} ${n.degree === 1 ? 'link' : 'links'}${n.mood ? ` · mood ${n.mood}` : ''}</div>
    <div class="pv-content" id="pv-content"><p class="pv-excerpt">${esc(n.excerpt)}</p></div>
    ${related.length ? `<div class="pv-section">Linked notes</div><div class="pv-links">${related.map((r) =>
      `<button data-note="${r.id}"><i style="background:${galaxyCss(r.galaxy)}"></i>${esc(r.title)}</button>`).join('')}</div>` : ''}
    <div class="pv-actions">
      <a class="btn" href="obsidian://open?vault=${vault}&file=${file}">Open in Obsidian ↗</a>
      <span class="pv-path">${esc(n.path)}</span>
    </div>`;
  $('#preview').hidden = false;
  if (window.innerWidth > 860) u.setInset($('#preview').offsetWidth + 20);
  const token = ++previewToken;
  try {
    const res = await fetch(`/api/note?path=${encodeURIComponent(n.path)}`);
    if (!res.ok || token !== previewToken) return;
    const note = await res.json();
    $('#pv-content').innerHTML = renderMarkdown(note.body.replace(/^\s*#\s+[^\n]*\n/, '')) || '<p class="empty">Empty note.</p>';
  } catch { /* keep the excerpt */ }
}

function closePreview() {
  $('#preview').hidden = true;
  state.main?.select(-1);
  state.main?.setInset(0);
  previewToken++;
}

$('#preview-close').addEventListener('click', closePreview);
$('#preview').addEventListener('click', (e) => {
  const b = e.target.closest('[data-note]');
  if (b) return openPreview(+b.dataset.note);
  const wl = e.target.closest('a.wl');
  if (wl) {
    const id = resolveTitle(wl.dataset.target);
    if (id != null) openPreview(id);
    else toast(`“${esc(wl.dataset.target)}” doesn't exist yet`);
  }
});

function resolveTitle(target) {
  const key = target.toLowerCase().replace(/\.md$/, '');
  const notes = state.data.notes;
  const hit = notes.find((n) => n.path.toLowerCase().replace(/\.md$/, '') === key) || notes.find((n) => n.title.toLowerCase() === key.split('/').pop());
  return hit ? hit.id : null;
}

function focusNote(id) {
  if (state.view !== 'universe') { state.pending = id; go('universe'); return; }
  openPreview(id, true);
}

// ---------- search (⌘K) ----------

let results = [];
let cursor = 0;
function openSearch() {
  $('#palette').hidden = false;
  const input = $('#palette-input');
  input.value = '';
  renderResults('');
  input.focus();
}
function closeSearch() { $('#palette').hidden = true; }

function score(n, q) {
  const t = n.title.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 50;
  const i = t.indexOf(q);
  if (i >= 0) return 30 - Math.min(i, 20) * 0.5;
  if (n.path.toLowerCase().includes(q)) return 12;
  let j = 0;
  for (const ch of t) if (ch === q[j]) j++;
  return j === q.length ? 5 : 0;
}

function renderResults(q) {
  q = q.trim().toLowerCase();
  const notes = state.data.notes;
  results = notes.map((n) => [n, score(n, q)]).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || (q ? b[0].degree - a[0].degree : b[0].modified - a[0].modified))
    .slice(0, 12).map(([n]) => n);
  cursor = 0;
  drawResults(q);
}
function drawResults(q) {
  const hl = (t) => {
    if (!q) return esc(t);
    const i = t.toLowerCase().indexOf(q);
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
  };
  $('#palette-list').innerHTML = results.length ? results.map((n, i) => `
    <li class="${i === cursor ? 'on' : ''}" data-i="${i}">
      <i style="background:${galaxyCss(n.galaxy)};box-shadow:0 0 8px ${galaxyCss(n.galaxy)}"></i>
      <span class="r-title">${hl(n.title)}</span>
      <span class="r-path">${esc(n.folder)}</span>
    </li>`).join('') : '<li class="none">No notes found</li>';
}
function choose(i) {
  const n = results[i];
  if (!n) return;
  closeSearch();
  focusNote(n.id);
}
$('#palette-input').addEventListener('input', (e) => renderResults(e.target.value));
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { cursor = Math.min(results.length - 1, cursor + 1); drawResults($('#palette-input').value.trim().toLowerCase()); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); drawResults($('#palette-input').value.trim().toLowerCase()); e.preventDefault(); }
  else if (e.key === 'Enter') { choose(cursor); e.preventDefault(); }
});
$('#palette-list').addEventListener('click', (e) => {
  const li = e.target.closest('[data-i]');
  if (li) choose(+li.dataset.i);
});
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closeSearch(); });

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('#palette').hidden) openSearch(); else closeSearch();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#palette').hidden) return closeSearch();
    if (typing) return e.target.blur();
    if (state.view !== 'universe') return;
    if (document.body.classList.contains('clean')) return toggleClean();
    if (!$('#preview').hidden) return closePreview();
    return go('dashboard');
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || state.view !== 'universe' || !state.main) return;
  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); setMorph(!state.main.isBrain); break;
    case 'g': toggleGrow(); break;
    case 'r': toggleRecord(); break;
    case 'c': toggleClean(); break;
    case 'l': state.main.setLabelsVisible(!state.main.labelsVisible); break;
    case 'h': state.main.resetView(); break;
    case 'f': {
      const el = $('#fps');
      el.hidden = !el.hidden;
      if (!el.hidden) {
        const tick = () => { if (el.hidden) return; el.textContent = `${state.main?.fps ?? 0} FPS`; setTimeout(tick, 500); };
        tick();
      }
      break;
    }
    default:
  }
});

// ---------- toast ----------

let toastTimer = null;
function toast(html, error = false, ms = 2600) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

window.__ou = state; // handy in the devtools console
boot();
