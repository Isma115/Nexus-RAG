// tools/reindex.js — re-trocea todo o una fuente. Uso: node tools/reindex.js [--source <id>]
require('dotenv').config();
const { openDatabase, now } = require('../server/database/db');
const { providerFor } = require('../server/sources/registry');

async function main() {
  const flagIndex = process.argv.indexOf('--source');
  const onlySource = flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
  const db = openDatabase();
  const targets = onlySource
    ? [db.get('SELECT * FROM sources WHERE id = ?', onlySource)].filter(Boolean)
    : db.all('SELECT * FROM sources WHERE type = ?', 'local');
  if (!targets.length) {
    console.error('Sin fuentes locales para reindexar');
    process.exitCode = 1;
    return;
  }
  for (const target of targets) {
    db.run('UPDATE sources SET status = ? WHERE id = ?', 'syncing', target.id);
    const result = await providerFor('local').sync(db, target, { env: process.env });
    db.run('UPDATE sources SET status = ?, last_sync_at = ?, last_error = NULL WHERE id = ?', 'ready', now(), target.id);
    console.log(JSON.stringify({ sourceId: target.id, ...result }));
  }
  db.close();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
