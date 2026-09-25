// Contrato común de fuentes. Hoy solo 'local' implementada;
// 'rest'/'web'/'db' dejan stub preparado para iterar a futuro.
class SourceProvider {
  constructor(type) { this.type = type; }
  async test(source) { throw new Error(`Fuente '${this.type}' no implementada todavía`); }
  async sync(db, source, services) { throw new Error(`Fuente '${this.type}' no implementada todavía`); }
}

module.exports = { SourceProvider };
