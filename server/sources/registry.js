const { SourceProvider } = require('./base');
const { LocalProvider } = require('./local');

// Registro de fuentes: solo 'local' activo. El resto deja stub con
// mensaje claro para iterar a futuro sin romper el contrato.
class FutureProvider extends SourceProvider {
  async test() { return { ok: false, prepared: true, message: `Fuente '${this.type}' preparada a futuro, aún no implementada` }; }
  async sync() { throw new Error(`Fuente '${this.type}' preparada a futuro, aún no implementada`); }
}

const registry = {
  local: new LocalProvider(),
  rest: new FutureProvider('rest'),
  web: new FutureProvider('web'),
  db: new FutureProvider('db')
};

function providerFor(type) {
  return registry[type] || null;
}

module.exports = { registry, providerFor };
