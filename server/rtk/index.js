// rtk: micro-toolkit compartido (ids, respuestas, texto). Todo el server lo usa.
const crypto = require('node:crypto');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function ok(res, data, status = 200) {
  return res.status(status).json(data);
}

function fail(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ');
}

function tokenize(s) {
  return normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2).slice(0, 2000);
}

module.exports = { id, asText, ok, fail, clampInt, normalize, tokenize };
