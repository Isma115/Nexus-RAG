const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Diseño heredado de NexusData: sources + documents, ampliado con chunks,
// conversations/messages para iterar, y users preparada a futuro.
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'rest', 'web', 'db')),
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`;

function now() {
  return new Date().toISOString();
}

function openDatabase(dbPath) {
  const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'nexus-rag.db');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec(SCHEMA);
  const api = {
    raw: database,
    path: resolvedPath,
    all(sql, ...params) { return database.prepare(sql).all(...params); },
    get(sql, ...params) { return database.prepare(sql).get(...params); },
    run(sql, ...params) { return database.prepare(sql).run(...params); },
    transaction(callback) {
      database.exec('BEGIN');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close() { database.close(); }
  };
  return api;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function sourceForResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: parseJson(row.config_json),
    status: row.status,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error || null,
    documentCount: Number(row.document_count || 0)
  };
}

function documentShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    source: row.source_name,
    externalId: row.external_id,
    title: row.title,
    type: row.type,
    path: row.path,
    excerpt: String(row.content || '').slice(0, 400),
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const DOCUMENT_SELECT = `SELECT d.*, s.name AS source_name, s.type AS source_type
  FROM documents d JOIN sources s ON s.id = d.source_id`;

module.exports = { openDatabase, now, parseJson, sourceForResponse, documentShape, DOCUMENT_SELECT };
