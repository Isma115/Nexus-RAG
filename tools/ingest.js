// tools/ingest.js — CLI mínima: crea fuente local e indexa. Uso: npm run ingest -- ./docs "Nombre"
require('dotenv').config();
const path = require('node:path');
const { openDatabase, now, parseJson } = require('../server/database/db');
const { id } = require('../server/rtk');
const { providerFor } = require('../server/sources/registry');

async function main() {
  const [dir, name] = process.argv.slice(2);
  if (!dir) {
    console.error('Uso: node tools/ingest.js <carpeta> [nombre]');
    process.exitCode = 1;
    return;
  }
  const db = openDatabase();
  const full = path.resolve(dir);
  const sourceName = name || path.basename(full) || 'docs';
  const existing = db.all("SELECT * FROM sources WHERE type = 'local'").find((row) => {
    const cfg = parseJson(row.config_json);
    return Array.isArray(cfg.paths) && cfg.paths.includes(full);
  });
  const sourceId = existing?.id || id('source');
  if (existing) {
    db.run('UPDATE sources SET name = ?, status = ?, last_error = NULL WHERE id = ?', sourceName, 'pending', sourceId);
  } else {
    db.run('INSERT INTO sources (id, name, type, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      sourceId, sourceName, 'local', JSON.stringify({ paths: [full] }), 'pending', now());
  }
  db.run('UPDATE sources SET status = ? WHERE id = ?', 'syncing', sourceId);
  const source = db.get('SELECT * FROM sources WHERE id = ?', sourceId);
  const result = await providerFor('local').sync(db, source, { env: process.env });
  db.run('UPDATE sources SET status = ?, last_sync_at = ?, last_error = NULL WHERE id = ?', 'ready', now(), sourceId);
  console.log(JSON.stringify({ sourceId, ...result }, null, 2));
  db.close();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
