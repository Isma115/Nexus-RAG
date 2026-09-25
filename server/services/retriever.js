// BM25 local sobre chunks SQLite. Sin dependencias, suficiente para RAG local.
const { tokenize } = require('../rtk');

const K1 = 1.2;
const B = 0.75;

function bm25Search(db, query, { sourceId = null, topK = 6 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const params = [];
  const where = sourceId ? 'WHERE c.source_id = ?' : '';
  if (sourceId) params.push(sourceId);
  const rows = db.all(
    `SELECT c.id, c.document_id, c.source_id, c.ord, c.content,
            d.title AS doc_title, d.path AS doc_path, d.type AS doc_type, s.name AS source_name
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN sources s ON s.id = c.source_id ${where}`,
    ...params
  );
  if (!rows.length) return [];
  const N = rows.length;
  const docFreq = new Map();
  const tokenized = rows.map((row) => {
    const tokens = tokenize(row.content);
    const freq = new Map();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
    for (const t of new Set(tokens)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    return { row, tokens, freq };
  });
  const avgLen = tokenized.reduce((a, d) => a + d.tokens.length, 0) / Math.max(1, tokenized.length);
  const scored = [];
  for (const { row, tokens, freq } of tokenized) {
    let score = 0;
    for (const term of terms) {
      const f = freq.get(term) || 0;
      if (!f) continue;
      const df = docFreq.get(term) || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * tokens.length) / Math.max(1, avgLen))));
    }
    // Bonus título/ruta: itera mejor sobre nombres de documento.
    const haystack = `${row.doc_title} ${row.doc_path}`.toLowerCase();
    for (const term of terms) if (term.length > 2 && haystack.includes(term)) score += 0.6;
    if (score > 0) scored.push({ score: Math.round(score * 100) / 100, row });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(topK, 1), 20))
    .map(({ score, row }, i) => ({
      rank: i + 1,
      score,
      chunkId: row.id,
      documentId: row.document_id,
      sourceId: row.source_id,
      ord: row.ord,
      content: row.content,
      documentTitle: row.doc_title,
      documentPath: row.doc_path,
      documentType: row.doc_type,
      sourceName: row.source_name
    }));
}

module.exports = { bm25Search };
