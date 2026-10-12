import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { db } from './db.js';
import { authRouter, getSessionUser, requireAuth, requireAuthPage } from './auth.js';

const PORT = Number(process.env.PORT) || 3000;
const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';
const RECEIVE_API_KEY = process.env.RECEIVE_API_KEY || '';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.disable('x-powered-by');
const TRUST_PROXY = (process.env.TRUST_PROXY || '').trim();
if (TRUST_PROXY && TRUST_PROXY !== 'false') {
  const value = TRUST_PROXY;
  app.set('trust proxy', value === 'true' ? true : /^\d+$/.test(value) ? Number(value) : value);
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeBody(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { body: null, encoding: 'utf8', size: 0 };
  }
  try {
    return { body: utf8Decoder.decode(buffer), encoding: 'utf8', size: buffer.length };
  } catch {
    return { body: buffer.toString('base64'), encoding: 'base64', size: buffer.length };
  }
}

function receiveCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Vary', 'Origin');
  if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
    res.set(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || '*',
    );
    res.set('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
}

function checkApiKey(req, res, next) {
  if (RECEIVE_API_KEY && req.get('x-api-key') !== RECEIVE_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }
  next();
}

const insertRequest = db.prepare(`
  INSERT INTO requests (method, path, query, headers, content_type, body, body_encoding, body_size, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

app.all(
  '/api/receive{/*path}',
  receiveCors,
  checkApiKey,
  express.raw({ type: () => true, limit: BODY_LIMIT }),
  (req, res) => {
    const headers = { ...req.headers };
    if (headers['x-api-key']) headers['x-api-key'] = '***';
    const { body, encoding, size } = decodeBody(req.body);

    const { lastInsertRowid } = insertRequest.run(
      req.method,
      req.originalUrl.split('?')[0],
      JSON.stringify(req.query ?? {}),
      JSON.stringify(headers),
      req.get('content-type') ?? null,
      body,
      encoding,
      size,
      req.ip ?? null,
    );
    res.status(201).json({ ok: true, id: Number(lastInsertRowid) });
  },
);

app.use('/auth', authRouter);

const admin = express.Router();
admin.use(requireAuth);

admin.get('/requests', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const method = typeof req.query.method === 'string' ? req.query.method.trim().toUpperCase() : '';

  const where = [];
  const params = [];
  if (method) {
    where.push('method = ?');
    params.push(method);
  }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      `(path LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR headers LIKE ? ESCAPE '\\' OR query LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM requests ${whereSql}`).get(...params);
  const items = db
    .prepare(
      `SELECT id, method, path, content_type, ip, body_encoding, body_size, created_at,
              substr(body, 1, 200) AS body_preview
         FROM requests ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, (page - 1) * limit);

  res.json({ ok: true, items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

admin.get('/requests/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Data tidak ditemukan' });
  res.json({
    ok: true,
    item: { ...row, query: JSON.parse(row.query), headers: JSON.parse(row.headers) },
  });
});

admin.delete('/requests/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM requests WHERE id = ?').run(Number(req.params.id));
  if (!changes) return res.status(404).json({ ok: false, error: 'Data tidak ditemukan' });
  res.json({ ok: true });
});

admin.delete('/requests', (req, res) => {
  const { changes } = db.prepare('DELETE FROM requests').run();
  res.json({ ok: true, deleted: Number(changes) });
});

app.use('/admin/api', admin);

app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

app.get('/login', (req, res) => {
  if (getSessionUser(req)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, error: status >= 500 ? 'Internal server error' : err.message });
});

app.listen(PORT, () => {
  console.log(`ShowYourResponse running on http://localhost:${PORT}`);
  console.log(`Receive endpoint: http://localhost:${PORT}/api/receive`);
});
