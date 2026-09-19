/**
 * smoke-memory.js — 通过 CDP 对运行中的 BOT 做端到端记忆链路测试
 * 前置：BOT 以 --remote-debugging-port=9222 启动
 */
const http = require('http');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  // 等目标就绪
  let targets = [];
  for (let i = 0; i < 40; i++) {
    try {
      targets = await getJSON('http://127.0.0.1:9222/json');
      if (targets.some((t) => t.type === 'page' && t.url.includes('index.html'))) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
    || targets.find((t) => t.type === 'page');
  if (!page) { console.error('❌ 未找到页面 target'); process.exit(1); }
  console.log('页面 target:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) =>
    new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => (ws.onopen = r));

  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  const results = [];
  const check = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };

  check('渲染层已注入 window.api.memory', await evl(`!!(window.api && window.api.memory)`));

  await evl(`window.api.memory.clear()`);
  const stats0 = await evl(`window.api.memory.stats()`);
  check('初始记忆库为空', stats0.count === 0, `count=${stats0.count}, embedder=${stats0.embedder}, dim=${stats0.dim}`);

  const facts = [
    '我叫沈志勋，齐鲁理工学院计科3班，学号241051011526。',
    '我的服务器叫佛系云，域名 www.x6m.top。',
    '我在写数字图像处理和 GAN 相关的论文。',
    '所有 AI 设置的密码统一用 Szx20060201。',
  ];
  for (const f of facts) await evl(`window.api.memory.add(${JSON.stringify(f)}, {source:'smoke'})`);
  const stats1 = await evl(`window.api.memory.stats()`);
  check('写入记忆成功', stats1.count === 4, `count=${stats1.count}`);

  const dup = await evl(`window.api.memory.add(${JSON.stringify(facts[0])})`);
  check('重复内容去重', dup.skipped === true);

  const r1 = await evl(`window.api.memory.search('我考研考的学校', {topK:1})`);
  check('语义召回：能关联到本人信息', r1.length > 0 && r1[0].text.includes('齐鲁理工学院'),
    r1[0] ? `score=${r1[0].score.toFixed(3)}` : '空');

  const r2 = await evl(`window.api.memory.search('服务器域名是什么', {topK:1})`);
  check('语义召回：服务器域名', r2.length > 0 && r2[0].text.includes('x6m.top'));

  const list = await evl(`window.api.memory.list({limit:10})`);
  check('列表接口', Array.isArray(list) && list.length === 4, `${list.length} 条`);

  const removed = await evl(`window.api.memory.remove(${JSON.stringify(list[0].id)})`);
  check('删除接口', removed.success === true && removed.removed === 1);

  const cfg = await evl(`window.api.loadConfig()`);
  check('配置含长期记忆字段', cfg.memoryEnabled !== undefined && cfg.memoryTopK !== undefined, `memoryEnabled=${cfg.memoryEnabled}, topK=${cfg.memoryTopK}`);

  // 保留 4 条数据供人工查看，不清理
  console.log('\n最终状态:', JSON.stringify(await evl(`window.api.memory.stats()`)));
  console.log(results.every(Boolean) ? '\n🎉 端到端链路全部通过' : '\n❌ 存在失败项');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
