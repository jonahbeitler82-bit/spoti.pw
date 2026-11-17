// A small Markdown renderer for note previews. Escapes everything first; wikilinks become buttons.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?\|([^\]]+)\]\]/g, (_, t, a) => `<a class="wl" data-target="${t.trim()}">${a}</a>`)
    .replace(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?\]\]/g, (_, t) => `<a class="wl" data-target="${t.trim()}">${t.trim()}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1<span class="tag">#$2</span>');
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { closeList(); code = []; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${Math.min(6, h[1].length + 2)}>${inline(h[2])}</h${Math.min(6, h[1].length + 2)}>`); continue; }
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (task || ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(task ? `<li class="task${task[1] !== ' ' ? ' done' : ''}">${inline(task[2])}</li>` : `<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  closeList();
  return out.join('\n');
}

export { esc };
