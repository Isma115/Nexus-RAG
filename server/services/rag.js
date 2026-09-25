const { bm25Search } = require('./retriever');
const { generateWithLlm } = require('./llm');
const { tokenize } = require('../rtk');

function pickSentences(content, queryTerms, max = 2) {
  const sentences = String(content).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((s) => s.length > 20).slice(0, 12);
  const scored = sentences.map((s) => {
    const low = s.toLowerCase();
    let score = 0;
    for (const t of queryTerms) if (t.length > 2 && low.includes(t)) score += 1;
    return { s: s.trim(), score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.filter((x) => x.score > 0).slice(0, max).map((x) => x.s);
  return (best.length ? best : scored.slice(0, 1).map((x) => x.s)).filter(Boolean);
}

async function askRag(db, question, { sourceId = null, topK = 6, env = process.env } = {}) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Escribe una pregunta');
  const k = Math.min(Math.max(Number(topK) || 6, 1), 20);
  const hits = bm25Search(db, q, { sourceId: sourceId || null, topK: k });
  if (!hits.length) {
    return { answer: 'Sin pasajes relevantes en las fuentes indexadas. Indexa más rutas o reformula la pregunta.', citations: [], chunks: [] };
  }
  // Hook LLM futuro: si proveedor externo activo, delega con mismos pasajes.
  if ((env.LLM_PROVIDER || 'extractive') !== 'extractive') {
    const passages = hits.map((h) => ({ documentTitle: h.documentTitle, ord: h.ord, content: h.content }));
    return generateWithLlm(env.LLM_PROVIDER, { question: q, passages }, env);
  }
  const queryTerms = [...new Set(tokenize(q))];
  const citations = hits.map((h, i) => ({
    n: i + 1,
    documentId: h.documentId,
    documentTitle: h.documentTitle,
    documentPath: h.documentPath,
    chunk: h.ord,
    score: h.score
  }));
  const lines = hits.map((h, i) => {
    const sentences = pickSentences(h.content, queryTerms, 2);
    return `[${i + 1}] ${h.documentTitle} §${h.ord}: ${sentences.join(' ')}`;
  });
  const answer = `Respuesta basada en ${hits.length} pasaje(s):\n\n${lines.join('\n\n')}\n\nFuentes: ${citations.map((c) => `[${c.n}] ${c.documentTitle}`).join(', ')}.`;
  return { answer, citations, chunks: hits };
}

module.exports = { askRag };
