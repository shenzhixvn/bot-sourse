/**
 * smoke-ingest.js — 验证对话内容自动沉淀进记忆库（走 conv:saveMessages）
 */
const http = require('http');
const getJSON = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const targets = await getJSON('http://127.0.0.1:9222/json');
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await evl('window.api.memory.clear()');
  const before = await evl(`window.api.memory.stats().then(s=>s.count)`);
  const messages = [
    { role: 'user', content: '帮我把这个学期的课表做一个在线查询网页' },
    { role: 'assistant', content: '好的，已经为你部署好课表网页，公网地址是 www.x6m.top/kebiao/，支持按周查看。' },
    { role: 'user', content: 'ok' }, // 太短，应被过滤
  ];
  await evl(`window.api.conv.saveMessages('main', ${JSON.stringify(messages)})`);
  await new Promise(r => setTimeout(r, 1500));
  const after = await evl(`window.api.memory.stats().then(s=>s.count)`);
  console.log(`沉淀前 ${before} 条 → 沉淀后 ${after} 条`);
  const hit = await evl(`window.api.memory.search('课表网页地址', {topK:1})`);
  const ok = after === before + 2 && hit.length && hit[0].text.includes('kebiao');
  console.log(`${ok ? '✅' : '❌'} 对话自动沉淀 + 可召回`, hit[0] ? `score=${hit[0].score.toFixed(3)}` : '(空)');
  // 再次保存同样内容，应因去重不再增长
  await evl(`window.api.conv.saveMessages('main', ${JSON.stringify(messages)})`);
  await new Promise(r => setTimeout(r, 1200));
  const after2 = await evl(`window.api.memory.stats().then(s=>s.count)`);
  console.log(`${after2 === after ? '✅' : '❌'} 重复沉淀被去重（${after} → ${after2}）`);
  process.exit(ok && after2 === after ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
