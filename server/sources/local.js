const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SourceProvider } = require('./base');
const { now, parseJson } = require('../database/db');
const { chunkText } = require('../services/chunker');

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.ts', '.py', '.html', '.htm', '.css', '.yaml', '.yml', '.xml', '.csv']);

function maxBytes(env = process.env) {
  return Number(env.RAG_MAX_DOC_BYTES) || 1500000;
}

function readLocalFile(filePath, env = process.env) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size > maxBytes(env)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXT.has(ext)) return null;
  let content = fs.readFileSync(filePath, 'utf8');
  if (ext === '.html' || ext === '.htm') content = content.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  content = content.replace(/\r/g, '').trim();
  if (!content) return null;
  const type = ext === '.md' || ext === '.markdown' ? 'markdown' : ext === '.html' || ext === '.htm' ? 'html' : ext.replace('.', '') || 'text';
  return { content, type };
}

function walkFiles(paths) {
  const files = [];
  for (const p of paths) {
    try {
      const stats = fs.statSync(p);
      if (stats.isFile()) { files.push(p); continue; }
      if (!stats.isDirectory()) continue;
      const stack = [p];
      while (stack.length && files.length < 5000) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile()) files.push(full);
        }
      }
    } catch { /* ruta ilegible: se ignora */ }
  }
  return [...new Set(files)];
}

function upsertDocumentWithChunks(db, sourceId, doc, env = process.env) {
  const timestamp = now();
  const externalId = doc.externalId;
  const existing = db.get('SELECT id, created_at FROM documents WHERE source_id = ? AND external_id = ?', sourceId, externalId);
  const docId = existing?.id || `doc_${crypto.createHash('sha256').update(`${sourceId}:${externalId}`).digest('hex').slice(0, 24)}`;
  db.run(
    `INSERT INTO documents (id, source_id, external_id, title, content, type, path, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, external_id) DO UPDATE SET
       title = excluded.title, content = excluded.content, type = excluded.type,
       path = excluded.path, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
    docId, sourceId, externalId, doc.title, doc.content, doc.type, doc.path,
    JSON.stringify(doc.metadata || {}), existing?.created_at || timestamp, timestamp
  );
  db.run('DELETE FROM chunks WHERE document_id = ?', docId);
  const chunks = chunkText(doc.content, {
    chunkSize: Number(env.RAG_CHUNK_SIZE) || 900,
    overlap: Number(env.RAG_CHUNK_OVERLAP) || 120
  });
  chunks.forEach((content, ord) => {
    db.run('INSERT INTO chunks (id, document_id, source_id, ord, content, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `chunk_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, docId, sourceId, ord, content, content.split(/\s+/).length, timestamp);
  });
  return { id: docId, updated: Boolean(existing), chunks: chunks.length };
}

class LocalProvider extends SourceProvider {
  constructor() { super('local'); }
  async test(source) {
    const config = parseJson(source.config_json);
    const paths = Array.isArray(config.paths) ? config.paths : [];
    const accessible = paths.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
    return { ok: accessible.length > 0, paths: accessible.length, totalPaths: paths.length };
  }
  async sync(db, source, { env = process.env } = {}) {
    const config = parseJson(source.config_json);
    const paths = [...new Set((config.paths || []).filter((p) => typeof p === 'string'))].map((p) => path.resolve(p)).slice(0, 50);
    if (!paths.length) throw new Error('La fuente no tiene rutas');
    const files = walkFiles(paths);
    let created = 0, updated = 0, chunks = 0;
    const errors = [];
    db.transaction(() => {
      const seen = new Set();
      for (const file of files) {
        try {
          const loaded = readLocalFile(file, env);
          if (!loaded) continue;
          seen.add(file);
          const r = upsertDocumentWithChunks(db, source.id, {
            externalId: file,
            title: path.basename(file),
            content: loaded.content.slice(0, maxBytes(env)),
            type: loaded.type,
            path: file,
            metadata: { ext: path.extname(file).toLowerCase() }
          }, env);
          if (r.updated) updated += 1; else created += 1;
          chunks += r.chunks;
        } catch (error) {
          if (errors.length < 20) errors.push(`${file}: ${error.message}`);
        }
      }
      // prune: borra documentos cuyas rutas ya no existen
      for (const row of db.all('SELECT id, external_id FROM documents WHERE source_id = ?', source.id)) {
        if (!seen.has(row.external_id)) db.run('DELETE FROM documents WHERE id = ?', row.id);
      }
    });
    const total = db.get('SELECT COUNT(*) AS n FROM documents WHERE source_id = ?', source.id).n;
    return { created, updated, total: Number(total), chunks, errors };
  }
}

module.exports = { LocalProvider, walkFiles, readLocalFile, upsertDocumentWithChunks };
