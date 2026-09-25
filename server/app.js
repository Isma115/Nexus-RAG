const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { openDatabase } = require('./database/db');
const { installRoutes } = require('./routes');

function resolveEnvironment(environment = process.env) {
  const resolved = { ...environment };
  if (!resolved.JWT_SECRET) resolved.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  return resolved;
}

function createApp({ dbPath, environment = process.env, offlineOnly = null } = {}) {
  const resolvedEnv = resolveEnvironment(environment);
  const useOfflineOnly = typeof offlineOnly === 'boolean'
    ? offlineOnly
    : String(resolvedEnv.OFFLINE_ONLY ?? 'true').toLowerCase() !== 'false';
  const app = express();
  const db = openDatabase(dbPath);
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.dbPath = db.path;
  app.locals.offlineOnly = useOfflineOnly;

  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  installRoutes(app, db, resolvedEnv, { offlineOnly: useOfflineOnly });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

function startServer({ port = 3330, host = '127.0.0.1', dbPath, environment, offlineOnly = null } = {}) {
  const app = createApp({ dbPath, environment, offlineOnly });
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        app, server,
        port: typeof address === 'object' && address ? address.port : port,
        host,
        close: () => new Promise((done) => server.close(() => { app.locals.db.close(); done(); }))
      });
    });
  });
}

if (require.main === module) {
  startServer({ port: Number(process.env.PORT) || 3330 })
    .then(({ port }) => console.log(`nexus-rag escuchando en http://127.0.0.1:${port}`))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { createApp, startServer };
