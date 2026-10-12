import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    method        TEXT NOT NULL,
    path          TEXT NOT NULL,
    query         TEXT NOT NULL DEFAULT '{}',
    headers       TEXT NOT NULL DEFAULT '{}',
    content_type  TEXT,
    body          TEXT,
    body_encoding TEXT NOT NULL DEFAULT 'utf8',
    body_size     INTEGER NOT NULL DEFAULT 0,
    ip            TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at);

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
if (count === 0) {
  const username = process.env.DEFAULT_USERNAME || 'admin';
  const password = process.env.DEFAULT_PASSWORD || '12345678';
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    username,
    await hashPassword(password),
  );
  console.log(`Default user "${username}" created`);
}

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
