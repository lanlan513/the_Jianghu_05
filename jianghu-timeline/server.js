/**
 * server.js —— 只读后端：名剑 / 剑客读取接口 + 静态文件。
 * 零依赖，仅用 node:http。不提供任何写接口。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

const swords = JSON.parse(await readFile(join(ROOT, 'data/swords.json'), 'utf8'));
const swordsmen = JSON.parse(await readFile(join(ROOT, 'data/swordsmen.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // ---- 只读 API ----
  if (url === '/api/health') return sendJSON(res, 200, { ok: true });
  if (url === '/api/swords') return sendJSON(res, 200, { items: swords });
  if (url.startsWith('/api/swords/')) {
    const it = swords.find(s => s.id === url.slice('/api/swords/'.length));
    return it ? sendJSON(res, 200, it) : sendJSON(res, 404, { error: '名剑未收录' });
  }
  if (url === '/api/swordsmen') return sendJSON(res, 200, { items: swordsmen });
  if (url.startsWith('/api/swordsmen/')) {
    const it = swordsmen.find(s => s.id === url.slice('/api/swordsmen/'.length));
    return it ? sendJSON(res, 200, it) : sendJSON(res, 404, { error: '剑客未收录' });
  }
  if (url.startsWith('/api/')) return sendJSON(res, 404, { error: '未知接口' });

  // ---- 静态文件 ----
  let path = normalize(join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!path.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`江湖编年史 · http://localhost:${PORT}  （名剑 ${swords.length} / 剑客 ${swordsmen.length}）`);
});
