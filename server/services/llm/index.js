// Contrato LLM futuro. Hoy 'extractive' resuelve local sin red.
// 'ollama'/'openai' dejan stub preparado: mismo input/output.
async function generateWithLlm(provider, { question, passages }, env = process.env) {
  const name = provider || env.LLM_PROVIDER || 'extractive';
  if (name === 'extractive') return null; // el servicio rag compone respuesta local
  if (name === 'ollama') {
    throw new Error(`LLM 'ollama' preparado a futuro (${env.OLLAMA_URL}, ${env.OLLAMA_MODEL}). Actívalo cuando haya modelo local.`);
  }
  if (name === 'openai') {
    throw new Error(`LLM 'openai' preparado a futuro (${env.OPENAI_MODEL}). Define OPENAI_API_KEY para activarlo.`);
  }
  throw new Error(`Proveedor LLM desconocido: ${name}`);
}

module.exports = { generateWithLlm };
