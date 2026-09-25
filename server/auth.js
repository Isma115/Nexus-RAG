// Auth reutilizada de NexusData: sesión offline JWT en cookie + cuentas
// online preparadas tras USERS_ENABLED=true (a futuro). Sin cambios de UX.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const COOKIE_NAME = 'nexusrag_session';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const OFFLINE_USER = { id: null, username: 'Modo offline', role: 'owner', offline: true };
const OFFLINE_ONLY_MESSAGE = 'Esta versión solo funciona en modo offline.';
const USERS_DISABLED_MESSAGE = 'Gestión multi-usuario preparada pero desactivada (USERS_ENABLED=false).';

function sessionDuration(env = process.env) { return env.SESSION_DURATION || '8h'; }
function sessionMs(duration = sessionDuration()) {
  const m = /^(\d+)\s*([smhd])$/i.exec(String(duration));
  if (!m) return 8 * 60 * 60 * 1000;
  return Number(m[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()]);
}
function jwtSecret(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('La configuración de sesión no está disponible');
  return env.JWT_SECRET;
}
function usersEnabled(env = process.env) {
  return String(env.USERS_ENABLED ?? 'false').toLowerCase() === 'true';
}
function normalizeUsername(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function validateCredentials(body = {}) {
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USERNAME_RE.test(username)) return { error: 'Usuario 3-50 chars (letras, números, punto, guion).' };
  if (password.length < 8 || password.length > 72) return { error: 'Contraseña 8-72 caracteres.' };
  return { username, password };
}
function cookieOptions(env = process.env) {
  return { httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production', maxAge: sessionMs(sessionDuration(env)), path: '/' };
}
function issueOfflineSession(res, env = process.env) {
  const token = jwt.sign({ sub: 'offline', offline: true, role: 'owner' }, jwtSecret(env), { expiresIn: sessionDuration(env) });
  res.cookie(COOKIE_NAME, token, cookieOptions(env));
}
function issueSession(res, user, env = process.env) {
  const token = jwt.sign({ sub: String(user.id), username: user.username, role: user.role || 'user' }, jwtSecret(env), { expiresIn: sessionDuration(env) });
  res.cookie(COOKIE_NAME, token, cookieOptions(env));
}
function loginLimiter() {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos.' } });
}
// Preparado a futuro: almacén mínimo de usuarios sobre SQLite (misma tabla users del schema).
function createUserStore(db) {
  return {
    async findByUsername(username) {
      return db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username) || null;
    },
    async create(username, passwordHash, role = 'user') {
      const { id } = require('../rtk');
      const { now } = require('./database/db');
      const userId = id('user');
      db.run('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', userId, username, passwordHash, role, now());
      return db.get('SELECT * FROM users WHERE id = ?', userId);
    }
  };
}
function requireAuth(env = process.env, { offlineOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) return res.status(401).json({ error: 'Sesión no válida.' });
      const session = jwt.verify(token, jwtSecret(env));
      if (offlineOnly && session.offline !== true) return res.status(403).json({ error: OFFLINE_ONLY_MESSAGE });
      if (session.offline === true) {
        req.user = { ...OFFLINE_USER };
        return next();
      }
      req.user = { id: session.sub, username: session.username, role: session.role || 'user' };
      return next();
    } catch { return res.status(401).json({ error: 'Sesión no válida.' }); }
  };
}
// Preparado a futuro: control por rol (admin > user). Hoy todo pasa como owner offline.
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sesión no válida.' });
    if (req.user.offline === true) return next();
    if (allowed.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Sin permiso para esta acción.' });
  };
}
function installAuthRoutes(app, env = process.env, { offlineOnly = false } = {}) {
  app.post('/api/auth/offline', (req, res) => {
    try {
      issueOfflineSession(res, env);
      return res.json({ user: { ...OFFLINE_USER } });
    } catch {
      return res.status(503).json({ error: 'Modo offline no disponible.' });
    }
  });
  // Cuentas reales: preparadas, bloqueadas hasta USERS_ENABLED=true.
  app.post('/api/auth/register', loginLimiter(), async (req, res) => {
    if (offlineOnly || !usersEnabled(env)) return res.status(403).json({ error: usersEnabled(env) ? OFFLINE_ONLY_MESSAGE : USERS_DISABLED_MESSAGE });
    const creds = validateCredentials(req.body);
    if (creds.error) return res.status(400).json({ error: creds.error });
    try {
      const store = createUserStore(req.app.locals.db);
      if (await store.findByUsername(creds.username)) return res.status(409).json({ error: 'Ese nombre ya está en uso.' });
      const user = await store.create(creds.username, await bcrypt.hash(creds.password, 12), 'user');
      issueSession(res, { id: user.id, username: user.username, role: user.role }, env);
      return res.status(201).json({ user: { id: user.id, username: user.username, role: user.role } });
    } catch { return res.status(503).json({ error: 'No se pudo crear la cuenta.' }); }
  });
  app.post('/api/auth/login', loginLimiter(), async (req, res) => {
    if (offlineOnly || !usersEnabled(env)) return res.status(403).json({ error: usersEnabled(env) ? OFFLINE_ONLY_MESSAGE : USERS_DISABLED_MESSAGE });
    const creds = validateCredentials(req.body);
    if (creds.error) return res.status(400).json({ error: creds.error });
    try {
      const store = createUserStore(req.app.locals.db);
      const user = await store.findByUsername(creds.username);
      if (!user || !await bcrypt.compare(creds.password, user.password_hash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      issueSession(res, { id: user.id, username: user.username, role: user.role }, env);
      return res.json({ user: { id: user.id, username: user.username, role: user.role } });
    } catch { return res.status(503).json({ error: 'No se pudo iniciar sesión.' }); }
  });
  app.get('/api/auth/me', requireAuth(env, { offlineOnly }), (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production', path: '/' });
    res.status(204).end();
  });
}

module.exports = { COOKIE_NAME, OFFLINE_ONLY_MESSAGE, USERS_DISABLED_MESSAGE, OFFLINE_USER, requireAuth, requireRole, installAuthRoutes, usersEnabled, validateCredentials, normalizeUsername };
