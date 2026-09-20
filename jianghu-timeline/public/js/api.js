/** api.js —— 后端只读接口的访问层。 */
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export function fetchAll() {
  return Promise.all([fetchJSON('/api/swords'), fetchJSON('/api/swordsmen')]);
}

export function fetchDetail(kind, id) {
  const base = String(id).split('@')[0]; // 压测克隆条目去掉 @k 后缀
  return fetchJSON(kind === 'sword' ? `/api/swords/${base}` : `/api/swordsmen/${base}`);
}
