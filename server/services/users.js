// Gestión multi-usuario preparada a futuro. Tablas y roles listos;
// rutas devuelven 501 hasta USERS_ENABLED=true. No rompe modo offline.
const { USERS_DISABLED_MESSAGE, usersEnabled } = require('../auth');

function usersPreparedGuard(env = process.env) {
  return (req, res, next) => {
    if (!usersEnabled(env)) return res.status(501).json({ error: USERS_DISABLED_MESSAGE });
    return next();
  };
}

function installUserRoutes(app, db, env = process.env) {
  const guard = usersPreparedGuard(env);
  app.get('/api/users', guard, (req, res) => {
    const rows = db.all('SELECT id, username, role, created_at FROM users ORDER BY created_at');
    res.json(rows.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at })));
  });
  app.patch('/api/users/:id/role', guard, (req, res) => {
    const role = String(req.body?.role || '');
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rol debe ser admin|user' });
    const target = db.get('SELECT id FROM users WHERE id = ?', req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    db.run('UPDATE users SET role = ? WHERE id = ?', role, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/users/:id', guard, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', req.params.id);
    res.status(204).end();
  });
}

module.exports = { installUserRoutes, usersPreparedGuard };
