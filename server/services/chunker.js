// Troceado por caracteres con solape, sobre texto normalizado.
function chunkText(content, { chunkSize = 900, overlap = 120 } = {}) {
  const clean = String(content || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      const breakAt = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (breakAt > start + chunkSize * 0.4) end = breakAt + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
    if (chunks.length > 2000) break;
  }
  return chunks.filter(Boolean);
}

module.exports = { chunkText };
