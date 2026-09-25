const $ = (id) => document.getElementById(id);
const api = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
let convId = null;

$('btnOffline').onclick = async () => {
  const { user } = await api('POST', '/api/auth/offline');
  $('me').textContent = `· ${user.username}`;
  refreshSources();
};
$('btnSource').onclick = async () => {
  const created = await api('POST', '/api/sources', { name: $('srcName').value || 'docs', type: 'local', config: { paths: [$('srcPath').value || './docs'] } });
  await api('POST', `/api/sources/${created.id}/sync`);
  refreshSources();
};
async function refreshSources() {
  const sources = await api('GET', '/api/sources').catch(() => []);
  $('sources').innerHTML = sources.map((s) => `<li><b>${s.name}</b> · ${s.type} · ${s.status} · ${s.documentCount} docs <button data-sync="${s.id}">sync</button></li>`).join('');
  document.querySelectorAll('[data-sync]').forEach((b) => { b.onclick = async () => { await api('POST', `/api/sources/${b.dataset.sync}/sync`); refreshSources(); }; });
}
$('btnAsk').onclick = async () => {
  const url = convId ? `/api/conversations/${convId}/ask` : '/api/rag/ask';
  const r = await api('POST', url, { question: $('q').value, topK: Number($('topK').value) || 6 });
  $('answer').textContent = r.answer;
  $('cites').innerHTML = (r.citations || []).map((c) => `<li>[${c.n}] ${c.documentTitle} §${c.chunk} (score ${c.score})</li>`).join('');
  if (convId) loadHistory();
};
$('btnConv').onclick = async () => {
  const c = await api('POST', '/api/conversations', { title: $('q').value.slice(0, 60) || 'Conversación' });
  convId = c.id;
  $('convId').textContent = convId;
  loadHistory();
};
async function loadHistory() {
  if (!convId) return;
  const c = await api('GET', `/api/conversations/${convId}`);
  $('history').innerHTML = c.messages.map((m) => `<li><b>${m.role}:</b> ${m.content.slice(0, 500)}</li>`).join('');
}
