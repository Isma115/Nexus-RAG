const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { now, parseJson, sourceForResponse, documentShape, DOCUMENT_SELECT } = require('../database/db');
const { id, asText, ok, fail, clampInt } = require('../rtk');
const { providerFor } = require('../sources/registry');
const { askRag } = require('../services/rag');
const { installAuthRoutes, requireAuth } = require('../auth');
const { installUserRoutes } = require('../services/users');

const ACTIVE_TYPES = ['local']; // resto preparado a futuro en registry

function sourceRow(db, sourceId) {
  return db.get(
    `SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS document_count
     FROM sources s WHERE s.id = ?`, sourceId);
}

function setStatus(db, sourceId, status, lastError = null) {
  db.run('UPDATE sources SET status = ?, last_error = ? WHERE id = ?', status, lastError, sourceId);
}

async function syncSource(db, source, env = process.env) {
  const provider = providerFor(source.type);
  if (!provider) throw new Error(`Tipo de fuente no soportado: ${source.type}`);
  setStatus(db, source.id, 'syncing', null);
  try {
    const result = await provider.sync(db, source, { env });
    const syncedAt = now();
    db.run('UPDATE sources SET status = ?, last_sync_at = ?, last_error = NULL WHERE id = ?', 'ready', syncedAt, source.id);
    return { ...result, syncedAt, source: sourceForResponse(sourceRow(db, source.id)) };
  } catch (error) {
    setStatus(db, source.id, 'error', error.message);
    error.syncSource = sourceForResponse(sourceRow(db, source.id));
    throw error;
  }
}

function validateSourceInput(body = {}) {
  const name = asText(body.name).slice(0, 120);
  const type = asText(body.type, 'local');
  if (!name) throw new Error('El nombre es obligatorio');
  if (!ACTIVE_TYPES.includes(type)) throw new Error(`Tipo '${type}' preparado a futuro. Hoy solo: ${ACTIVE_TYPES.join(', ')}`);
  const config = body.config && typeof body.config === 'object' ? { ...body.config } : {};
  const paths = [...new Set((config.paths || []).filter((p) => typeof p === 'string' && p.trim()))].slice(0, 50);
  if (!paths.length) throw new Error('Indica al menos una ruta local');
  config.paths = paths.map((p) => path.resolve(p));
  return { name, type, config };
}

function saveConversationTurn(db, conversationId, question, result) {
  const timestamp = now();
  db.run('INSERT INTO messages (id, conversation_id, role, content, citations_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id('msg'), conversationId, 'user', question, '[]', timestamp);
  db.run('INSERT INTO messages (id, conversation_id, role, content, citations_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id('msg'), conversationId, 'assistant', result.answer, JSON.stringify(result.citations || []), timestamp);
}

function installRoutes(app, db, env = process.env, { offlineOnly = false } = {}) {
  app.get('/api/health', (req, res) => ok(res, { ok: true, name: 'nexus-rag', timestamp: now() }));
  installAuthRoutes(app, env, { offlineOnly });
  app.use('/api', requireAuth(env, { offlineOnly }));
  installUserRoutes(app, db, env);

  // ---- Sources (local hoy, resto preparado) ----
  app.get('/api/sources', (req, res) => {
    const rows = db.all(`SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS document_count FROM sources s ORDER BY s.created_at DESC`);
    ok(res, rows.map(sourceForResponse));
  });
  app.post('/api/sources', (req, res) => {
    try {
      const input = validateSourceInput(req.body || {});
      const sourceId = id('source');
      db.run('INSERT INTO sources (id, name, type, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        sourceId, input.name, input.type, JSON.stringify(input.config), 'pending', now());
      ok(res, sourceForResponse(sourceRow(db, sourceId)), 201);
    } catch (error) { fail(res, error.message); }
  });
  app.put('/api/sources/:id', (req, res) => {
    const existing = sourceRow(db, req.params.id);
    if (!existing) return fail(res, 'Fuente no encontrada', 404);
    try {
      const input = validateSourceInput({ type: existing.type, ...req.body });
      db.run('UPDATE sources SET name = ?, type = ?, config_json = ?, status = ?, last_error = NULL WHERE id = ?',
        input.name, input.type, JSON.stringify(input.config), 'pending', req.params.id);
      ok(res, sourceForResponse(sourceRow(db, req.params.id)));
    } catch (error) { fail(res, error.message); }
  });
  app.delete('/api/sources/:id', (req, res) => {
    if (!sourceRow(db, req.params.id)) return fail(res, 'Fuente no encontrada', 404);
    db.run('DELETE FROM sources WHERE id = ?', req.params.id);
    res.status(204).end();
  });
  app.post('/api/sources/:id/test', async (req, res) => {
    const source = sourceRow(db, req.params.id);
    if (!source) return fail(res, 'Fuente no encontrada', 404);
    try {
      const provider = providerFor(source.type);
      ok(res, await provider.test(source));
    } catch (error) { fail(res, error.message, 502); }
  });
  app.post('/api/sources/:id/sync', async (req, res) => {
    const source = sourceRow(db, req.params.id);
    if (!source) return fail(res, 'Fuente no encontrada', 404);
    try { ok(res, await syncSource(db, source, env)); }
    catch (error) { res.status(502).json({ error: error.message, source: error.syncSource }); }
  });

  // ---- Documents & search ----
  app.get('/api/documents', (req, res) => {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const params = [];
    let where = '';
    if (req.query.source) { where = 'WHERE d.source_id = ?'; params.push(req.query.source); }
    if (req.query.q) { where += (where ? ' AND' : 'WHERE') + ' (d.title LIKE ? OR d.content LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const rows = db.all(`${DOCUMENT_SELECT} ${where} ORDER BY d.updated_at DESC LIMIT ${limit}`, ...params);
    ok(res, { total: rows.length, documents: rows.map(documentShape) });
  });
  app.get('/api/documents/:id', (req, res) => {
    const row = db.get(`${DOCUMENT_SELECT} WHERE d.id = ?`, req.params.id);
    if (!row) return fail(res, 'Documento no encontrado', 404);
    ok(res, { ...documentShape(row), content: row.content, metadata: parseJson(row.metadata_json) });
  });
  app.get('/api/search', (req, res) => {
    const q = asText(req.query.q);
    const limit = clampInt(req.query.limit, 50, 1, 200);
    if (!q) return ok(res, { query: q, total: 0, results: [] });
    const like = `%${q}%`;
    const params = [like, like];
    let where = 'WHERE (d.title LIKE ? OR d.content LIKE ?)';
    if (req.query.source) { where += ' AND d.source_id = ?'; params.push(req.query.source); }
    const rows = db.all(`${DOCUMENT_SELECT} ${where} ORDER BY d.updated_at DESC LIMIT ${limit}`, ...params);
    ok(res, {
      query: q, total: rows.length,
      results: rows.map((r) => {
        const clean = String(r.content || '').replace(/\s+/g, ' ').trim();
        const idx = clean.toLowerCase().indexOf(q.toLowerCase());
        const snippet = idx < 0 ? clean.slice(0, 220) : `${idx > 75 ? '…' : ''}${clean.slice(Math.max(0, idx - 75), idx + q.length + 145)}`;
        return { ...documentShape(r), snippet };
      })
    });
  });

  // ---- RAG: iterar documentos ----
  app.post('/api/rag/ask', async (req, res) => {
    try {
      const result = await askRag(db, req.body?.question, { sourceId: asText(req.body?.sourceId) || null, topK: req.body?.topK || Number(env.RAG_TOP_K) || 6, env });
      ok(res, { question: asText(req.body?.question), ...result });
    } catch (error) { fail(res, error.message); }
  });
  app.post('/api/rag/reindex', async (req, res) => {
    try {
      const sourceId = asText(req.body?.sourceId) || null;
      const targets = sourceId ? [sourceRow(db, sourceId)].filter(Boolean) : db.all('SELECT * FROM sources WHERE type = ?', 'local');
      if (!targets.length) return fail(res, 'Sin fuentes locales para reindexar', 404);
      const results = [];
      for (const target of targets) results.push({ sourceId: target.id, ...(await syncSource(db, target, env)) });
      ok(res, { reindexed: results.length, results });
    } catch (error) { fail(res, error.message, 502); }
  });

  // ---- Conversations: historial de iteración ----
  app.get('/api/conversations', (req, res) => {
    ok(res, db.all('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 100'));
  });
  app.post('/api/conversations', (req, res) => {
    const convId = id('conv');
    const title = asText(req.body?.title, 'Conversación').slice(0, 120) || 'Conversación';
    db.run('INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)', convId, title, now());
    ok(res, db.get('SELECT * FROM conversations WHERE id = ?', convId), 201);
  });
  app.get('/api/conversations/:id', (req, res) => {
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
    if (!conv) return fail(res, 'Conversación no encontrada', 404);
    ok(res, { ...conv, messages: db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at', req.params.id).map((m) => ({ ...m, citations: parseJson(m.citations_json, []) })) });
  });
  app.post('/api/conversations/:id/ask', async (req, res) => {
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
    if (!conv) return fail(res, 'Conversación no encontrada', 404);
    try {
      const result = await askRag(db, req.body?.question, { sourceId: asText(req.body?.sourceId) || null, topK: req.body?.topK || Number(env.RAG_TOP_K) || 6, env });
      saveConversationTurn(db, conv.id, asText(req.body?.question), result);
      ok(res, { conversationId: conv.id, question: asText(req.body?.question), ...result });
    } catch (error) { fail(res, error.message); }
  });
  app.delete('/api/conversations/:id', (req, res) => {
    db.run('DELETE FROM conversations WHERE id = ?', req.params.id);
    res.status(204).end();
  });

  // ---- Stats ----
  app.get('/api/stats', (req, res) => {
    const counts = db.get(`SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM chunks) AS chunks,
      (SELECT COUNT(*) FROM sources) AS sources,
      (SELECT COUNT(*) FROM conversations) AS conversations,
      (SELECT MAX(last_sync_at) FROM sources) AS last_sync_at`);
    ok(res, { documents: Number(counts.documents), chunks: Number(counts.chunks), sources: Number(counts.sources), conversations: Number(counts.conversations), lastSyncAt: counts.last_sync_at });
  });
}

module.exports = { installRoutes, syncSource, validateSourceInput };
