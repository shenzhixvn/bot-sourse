/**
 * test-memory.js — BOT 长期记忆模块离线自测（不依赖 Electron）
 * 运行：node test-memory.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { MemoryStore } = require('./core/memoryStore');

const DIR = path.join(require('os').tmpdir(), 'bot-memory-test-' + Date.now());

function ok(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  console.log('数据目录:', DIR);
  const store = new MemoryStore({ dir: DIR, maxItems: 1000 });
  await store.init();

  // 1) 写入若干记忆
  const facts = [
    '我叫沈志勋，齐鲁理工学院计算机科学与技术3班，学号241051011526。',
    '我准备考研，目标是浙江工业大学和杭州电子科技大学的计算机专业，考408统考。',
    '我有一台叫「佛系云」的腾讯云服务器，域名是 www.x6m.top。',
    '我的儿子在阿里云服务器上开发一个叫 my-agent 的 AI 助手。',
    '我平时喜欢玩我的世界，热衷红石电路和生电玩法。',
    '我用的百度网盘 VIP 账号，通过 bypy 上传备份文件。',
    '我在写一篇数字图像处理和 GAN 相关的论文。',
    '所有 AI 帮我设置的密码统一用 Szx20060201。',
  ];
  for (const f of facts) await store.add(f, { source: 'test' });
  ok('写入 8 条记忆', store.stats().count === 8, `count=${store.stats().count}`);

  // 2) 去重
  const dup = await store.add(facts[0]);
  ok('重复内容被跳过', dup.skipped === true && dup.reason === 'duplicate');

  // 3) 语义检索
  const tests = [
    { q: '我考研考哪个学校', expect: '浙江工业大学' },
    { q: '服务器域名是什么', expect: 'x6m.top' },
    { q: '游戏方面我喜欢什么', expect: '我的世界' },
    { q: '论文写的什么方向', expect: 'GAN' },
    { q: '统一密码是多少', expect: 'Szx20060201' },
  ];
  let hit = 0;
  for (const t of tests) {
    const r = await store.search(t.q, { topK: 1 });
    const top = r[0];
    const good = top && top.text.includes(t.expect);
    if (good) hit++;
    console.log(`   「${t.q}」→ ${top ? top.text.slice(0, 24) + '…' : '(空)'}  相似度=${top ? top.score.toFixed(3) : '-'}`);
  }
  ok(`语义检索命中 Top-1`, hit === tests.length, `${hit}/${tests.length}`);

  // 4) Top-K 与阈值
  const multi = await store.search('服务器和 AI 助手', { topK: 3, minScore: 0.05 });
  ok('Top-K 返回多条', multi.length >= 2, `返回 ${multi.length} 条`);

  // 5) 持久化：重开一个实例读取
  await store.flush();
  const store2 = new MemoryStore({ dir: DIR });
  await store2.init();
  ok('重启后数据仍在', store2.stats().count === 8, `count=${store2.stats().count}`);
  const r2 = await store2.search('考研目标学校', { topK: 1 });
  ok('重启后检索仍可用', r2[0] && r2[0].text.includes('浙江工业大学'));

  // 6) 删除 & 清空
  const del = await store2.remove(store2.list({ limit: 1 })[0].id);
  ok('删除单条', del.removed === 1 && store2.stats().count === 7);
  await store2.clear();
  ok('清空', store2.stats().count === 0);

  // 7) 维度信息
  console.log('   嵌入器:', store.stats().embedder, '维度:', store.stats().dim);

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(process.exitCode ? '\n❌ 有测试未通过' : '\n🎉 全部通过');
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
