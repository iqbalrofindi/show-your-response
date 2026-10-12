import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import { hashPassword, verifyPassword } from './password.js';

const COOKIE_NAME = 'syr_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function getSessionUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.token_hash, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return { id: row.id, username: row.username, tokenHash: row.token_hash };
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.user = user;
  next();
}

export function requireAuthPage(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

function isLoginBlocked(ip) {
  const entry = failedLogins.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > FAILED_LOGIN_WINDOW_MS) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

function recordFailedLogin(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.firstAt > FAILED_LOGIN_WINDOW_MS) {
    failedLogins.set(ip, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

export const authRouter = express.Router();
authRouter.use(express.json({ limit: '10kb' }));

authRouter.get('/login', (req, res) => res.redirect('/login'));

authRouter.post('/login', async (req, res) => {
  if (isLoginBlocked(req.ip)) {
    return res
      .status(429)
      .json({ ok: false, error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
  }

  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Username dan password wajib diisi' });
  }

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username.trim());
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    recordFailedLogin(req.ip);
    return res.status(401).json({ ok: false, error: 'Username atau password salah' });
  }

  failedLogins.delete(req.ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    user.id,
    Date.now() + SESSION_TTL_MS,
  );
  setSessionCookie(res, token, SESSION_TTL_MS);
  res.json({ ok: true, user: { username: user.username } });
});

authRouter.post('/logout', (req, res) => {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: { username: req.user.username } });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ ok: false, error: 'Password lama dan baru wajib diisi' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password baru minimal 8 karakter' });
  }

  const { password_hash } = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(req.user.id);
  if (!(await verifyPassword(currentPassword, password_hash))) {
    return res.status(400).json({ ok: false, error: 'Password lama salah' });
  }

  db.prepare(
    `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
  ).run(await hashPassword(newPassword), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
    req.user.id,
    req.user.tokenHash,
  );
  res.json({ ok: true });
});
