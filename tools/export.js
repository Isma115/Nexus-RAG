// tools/export.js — vuelca workspace RAG a JSON. Uso: node tools/export.js [--out file]
require('dotenv').config();
const fs = require('node:fs');
const { openDatabase } = require('../server/database/db');

function main() {
  const flagIndex = process.argv.indexOf('--out');
  const out = flagIndex >= 0 ? process.argv[flagIndex + 1] : 'rag-export.json';
  const db = openDatabase();
  const snapshot = {
    exportedAt: new Date().toISOString(),
    sources: db.all('SELECT * FROM sources ORDER BY created_at'),
    documents: db.all('SELECT id, source_id, external_id, title, type, path, created_at, updated_at FROM documents ORDER BY updated_at DESC LIMIT 2000'),
    chunkCount: db.get('SELECT COUNT(*) AS n FROM chunks').n,
    conversations: db.all('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 200'),
    messages: db.all('SELECT * FROM messages ORDER BY created_at DESC LIMIT 2000')
  };
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log(`Exportado a ${out}`);
  db.close();
}

main();
