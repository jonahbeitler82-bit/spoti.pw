import { defineConfig } from 'vite';
import { readConfig, writeConfig, resolveVault, scanVault, readNote, capture } from './server/vault.js';
import { makeDemoVault } from './server/demo-vault.js';

function currentVault() {
  const info = resolveVault(readConfig());
  if (info.demo) makeDemoVault({ dir: info.path });
  return info;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100000) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Writes are accepted only from this app's own page, never from another site.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function vaultApi() {
  return {
    name: 'vault-api',
    configureServer(server) {
      const info = currentVault();
      const where = info.demo ? `demo vault (no vault at ${info.missing})` : info.path;
      server.config.logger.info(`\n  Obsidian Universe reads: ${where}\n`);
      if (info.others.length) server.config.logger.info(`  Other vaults found: ${info.others.join(', ')} (set "vaultPath" in vault.config.json to pick one)\n`);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const send = (code, obj) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(obj));
        };
        try {
          const url = new URL(req.url, 'http://localhost');
          if (req.method === 'GET' && url.pathname === '/api/vault') {
            return send(200, await scanVault(currentVault()));
          }
          if (req.method === 'GET' && url.pathname === '/api/note') {
            const note = await readNote(currentVault(), url.searchParams.get('path') || '');
            return note ? send(200, note) : send(404, { error: 'Not found' });
          }
          if (req.method === 'POST' && url.pathname === '/api/capture') {
            if (!sameOrigin(req)) return send(403, { error: 'Forbidden' });
            const body = await readBody(req);
            return send(200, await capture(currentVault(), body.text));
          }
          if (req.method === 'POST' && url.pathname === '/api/config') {
            if (!sameOrigin(req)) return send(403, { error: 'Forbidden' });
            const body = await readBody(req);
            const name = String(body.name ?? '').trim().slice(0, 40);
            writeConfig({ name });
            return send(200, { name });
          }
          return send(404, { error: 'Unknown endpoint' });
        } catch (err) {
          return send(500, { error: err.message });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vaultApi()],
  server: { port: 5173, open: !process.env.CI && !process.env.NO_OPEN },
});
