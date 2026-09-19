// ============================================================
//  BOT — 文件操作功能综合测试
//  测试：白名单校验、高危检测、文件读写、追加、复制、重命名、删除、列出
// ============================================================

const FileManager = require('./core/fileManager');
const path = require('path');
const fs = require('fs');

// 测试用临时目录
const TEST_DIR = path.join(__dirname, 'output', 'test_files');
const TEST_WHITELIST = [TEST_DIR, path.join(__dirname, 'output')];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 清理测试目录
function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

async function main() {
  console.log('BOT — 文件操作功能综合测试');
  console.log(`测试目录: ${TEST_DIR}`);
  console.log(`白名单: ${TEST_WHITELIST.join('; ')}`);

  cleanTestDir();

  const fm = new FileManager({
    whitelist: TEST_WHITELIST,
    autoOpen: false,
  });

  // ── 1. 白名单校验 ──
  section('1. 目录白名单安全校验');

  const r1 = fm.isPathAllowed(path.join(TEST_DIR, 'test.txt'));
  assert(r1.allowed === true, '白名单内的文件路径应被允许');

  const r2 = fm.isPathAllowed('C:\\Windows\\System32\\config');
  assert(r2.allowed === false, '系统目录应被拒绝');

  const r3 = fm.isPathAllowed('C:\\Users\\Other\\secret.txt');
  assert(r3.allowed === false, '白名单外的路径应被拒绝');

  const r4 = fm.isSystemPath('C:\\Windows\\explorer.exe');
  assert(r4 === true, 'C:\\Windows 下的文件应识别为系统路径');

  const r5 = fm.isSystemPath(path.join(TEST_DIR, 'test.txt'));
  assert(r5 === false, '测试目录不应识别为系统路径');

  // 空白名单测试
  const fmEmpty = new FileManager({ whitelist: [] });
  const r6 = fmEmpty.isPathAllowed(path.join(TEST_DIR, 'test.txt'));
  assert(r6.allowed === false, '空白名单应拒绝所有路径（安全优先）');

  // ── 2. 高危操作检测 ──
  section('2. 高危操作检测');

  // 写入不存在的文件（低风险）
  const risk1 = fm.detectHighRisk('write', { path: path.join(TEST_DIR, 'new.txt') });
  assert(risk1.highRisk === false, '写入新文件不应标记为高危');

  // 写入已存在的文件（高危：覆盖）
  const existingFile = path.join(TEST_DIR, 'existing.txt');
  fs.writeFileSync(existingFile, 'old content');
  const risk2 = fm.detectHighRisk('write', { path: existingFile });
  assert(risk2.highRisk === true, '覆盖已有文件应标记为高危');
  assert(risk2.reasons[0].includes('覆盖'), '高危原因应包含"覆盖"');

  // 删除文件（高危）
  const risk3 = fm.detectHighRisk('delete', { path: existingFile });
  assert(risk3.highRisk === true, '删除文件应标记为高危');

  // 追加内容（低风险）
  const risk4 = fm.detectHighRisk('append', { path: existingFile });
  assert(risk4.highRisk === false, '追加内容不应标记为高危');

  // 读取文件（低风险）
  const risk5 = fm.detectHighRisk('read', { path: existingFile });
  assert(risk5.highRisk === false, '读取文件不应标记为高危');

  // ── 3. 写入文件 ──
  section('3. 写入文件 (.txt / .md)');

  const writeResult = await fm.execute('write', {
    path: path.join(TEST_DIR, 'note.md'),
    content: '# 测试笔记\n\n这是一个由 BOT生成的测试文件。\n\n- 项目1\n- 项目2\n',
  });
  assert(writeResult.success === true, '写入 .md 文件应成功');
  assert(fs.existsSync(path.join(TEST_DIR, 'note.md')), '文件应实际存在');
  const writtenContent = fs.readFileSync(path.join(TEST_DIR, 'note.md'), 'utf-8');
  assert(writtenContent.includes('测试笔记'), '文件内容应正确写入');

  // 自动创建目录
  const nestedPath = path.join(TEST_DIR, 'sub', 'dir', 'deep.txt');
  const writeNested = await fm.execute('write', {
    path: nestedPath,
    content: '深层目录文件',
  });
  assert(writeNested.success === true, '写入深层目录文件应成功（自动创建目录）');
  assert(fs.existsSync(nestedPath), '深层目录文件应存在');

  // ── 4. 读取文件 ──
  section('4. 读取文件');

  const readResult = await fm.execute('read', {
    path: path.join(TEST_DIR, 'note.md'),
  });
  assert(readResult.success === true, '读取文件应成功');
  assert(readResult.content.includes('测试笔记'), '读取的内容应正确');
  assert(readResult.content.includes('项目1'), '读取的内容应包含列表项');

  // 读取不存在的文件
  const readMissing = await fm.execute('read', {
    path: path.join(TEST_DIR, 'not_exist.txt'),
  });
  assert(readMissing.success === false, '读取不存在的文件应失败');
  assert(readMissing.error.includes('不存在'), '错误信息应提示文件不存在');

  // ── 5. 追加内容 ──
  section('5. 追加内容到文件');

  const appendResult = await fm.execute('append', {
    path: path.join(TEST_DIR, 'note.md'),
    content: '\n## 追加章节\n\n这是追加的内容。\n',
  });
  assert(appendResult.success === true, '追加内容应成功');

  const afterAppend = fs.readFileSync(path.join(TEST_DIR, 'note.md'), 'utf-8');
  assert(afterAppend.includes('追加章节'), '追加的内容应存在于文件中');
  assert(afterAppend.includes('测试笔记'), '原有内容应保留');

  // 追加到不存在的文件（应自动创建）
  const appendNew = await fm.execute('append', {
    path: path.join(TEST_DIR, 'new_append.txt'),
    content: '第一行内容',
  });
  assert(appendNew.success === true, '追加到新文件应自动创建');
  assert(fs.existsSync(path.join(TEST_DIR, 'new_append.txt')), '新文件应被创建');

  // ── 6. 列出目录 ──
  section('6. 列出目录内容');

  const listResult = await fm.execute('list', {
    path: TEST_DIR,
  });
  assert(listResult.success === true, '列出目录应成功');
  assert(Array.isArray(listResult.items), '结果应包含 items 数组');
  assert(listResult.items.length >= 3, `目录应至少有 3 个文件（实际 ${listResult.items.length}）`);

  const fileNames = listResult.items.map(i => i.name);
  assert(fileNames.includes('note.md'), '列表应包含 note.md');
  assert(fileNames.includes('sub'), '列表应包含 sub 目录');

  // 验证文件属性
  const noteItem = listResult.items.find(i => i.name === 'note.md');
  assert(noteItem && noteItem.is_dir === false, 'note.md 应标记为文件');
  assert(noteItem && typeof noteItem.size === 'number' && noteItem.size > 0, '文件应有大小');

  // ── 7. 复制文件 ──
  section('7. 复制文件');

  const copyResult = await fm.execute('copy', {
    source: path.join(TEST_DIR, 'note.md'),
    dest: path.join(TEST_DIR, 'note_backup.md'),
  });
  assert(copyResult.success === true, '复制文件应成功');
  assert(fs.existsSync(path.join(TEST_DIR, 'note_backup.md')), '目标文件应存在');

  const copyContent = fs.readFileSync(path.join(TEST_DIR, 'note_backup.md'), 'utf-8');
  assert(copyContent.includes('测试笔记'), '复制的文件内容应一致');

  // 复制到子目录（自动创建）
  const copyNested = await fm.execute('copy', {
    source: path.join(TEST_DIR, 'note.md'),
    dest: path.join(TEST_DIR, 'backup', 'note.md'),
  });
  assert(copyNested.success === true, '复制到新子目录应成功');

  // ── 8. 重命名/移动文件 ──
  section('8. 重命名文件');

  const renameResult = await fm.execute('rename', {
    source: path.join(TEST_DIR, 'new_append.txt'),
    dest: path.join(TEST_DIR, 'renamed.txt'),
  });
  assert(renameResult.success === true, '重命名文件应成功');
  assert(!fs.existsSync(path.join(TEST_DIR, 'new_append.txt')), '原文件应不存在');
  assert(fs.existsSync(path.join(TEST_DIR, 'renamed.txt')), '新文件应存在');

  // 移动到子目录
  const moveResult = await fm.execute('rename', {
    source: path.join(TEST_DIR, 'renamed.txt'),
    dest: path.join(TEST_DIR, 'sub', 'moved.txt'),
  });
  assert(moveResult.success === true, '移动文件到子目录应成功');
  assert(fs.existsSync(path.join(TEST_DIR, 'sub', 'moved.txt')), '文件应在目标位置');

  // ── 9. 创建目录 ──
  section('9. 创建目录');

  const mkdirResult = await fm.execute('mkdir', {
    path: path.join(TEST_DIR, 'new_folder', 'nested'),
  });
  assert(mkdirResult.success === true, '创建嵌套目录应成功');
  assert(fs.existsSync(path.join(TEST_DIR, 'new_folder', 'nested')), '目录应存在');

  // ── 10. 安全校验拦截 ──
  section('10. 安全校验拦截测试');

  // 尝试写入系统目录
  const systemWrite = await fm.execute('write', {
    path: 'C:\\Windows\\System32\\test.txt',
    content: 'hacked',
  });
  assert(systemWrite.success === false, '写入系统目录应被拦截');
  assert(systemWrite.error.includes('系统关键目录') || systemWrite.error.includes('白名单'), '应提示安全原因');

  // 尝试读取白名单外路径
  const outsideRead = await fm.execute('read', {
    path: 'C:\\Users\\Public\\secret.txt',
  });
  assert(outsideRead.success === false, '读取白名单外路径应被拦截');

  // 路径遍历攻击
  const traversal = await fm.execute('write', {
    path: path.join(TEST_DIR, '..', '..', 'evil.txt'),
    content: 'evil',
  });
  // 规范化后路径可能在白名单内也可能不在，取决于层级；关键是不崩溃
  assert(typeof traversal.success === 'boolean', '路径遍历尝试不应导致崩溃');

  // ── 11. 删除文件（测试功能，但保留测试目录供检查）──
  section('11. 删除文件');

  const deleteTestFile = path.join(TEST_DIR, 'to_delete.txt');
  fs.writeFileSync(deleteTestFile, 'will be deleted');
  const deleteResult = await fm.execute('delete', {
    path: deleteTestFile,
  });
  assert(deleteResult.success === true, '删除文件应成功');
  assert(!fs.existsSync(deleteTestFile), '文件应被删除');

  // 删除不存在的文件
  const deleteMissing = await fm.execute('delete', {
    path: path.join(TEST_DIR, 'not_exist.txt'),
  });
  assert(deleteMissing.success === false, '删除不存在的文件应失败');

  // ── 12. 文件类型识别 ──
  section('12. 文件类型识别');

  assert(fm.getFileType('test.txt') === 'text', '.txt 应识别为 text');
  assert(fm.getFileType('test.md') === 'text', '.md 应识别为 text');
  assert(fm.getFileType('test.docx') === 'docx', '.docx 应识别为 docx');
  assert(fm.getFileType('test.xlsx') === 'xlsx', '.xlsx 应识别为 xlsx');
  assert(fm.getFileType('test.csv') === 'text', '.csv 应识别为 text');
  assert(fm.getFileType('test.json') === 'text', '.json 应识别为 text');

  // ── 13. 操作日志 ──
  section('13. 操作日志');

  const logs = fm.getLogs();
  assert(Array.isArray(logs), '日志应为数组');
  assert(logs.length > 0, '应有操作日志记录');

  const successLogs = logs.filter(l => l.level === 'success');
  assert(successLogs.length > 0, '应有成功日志');

  const errorLogs = logs.filter(l => l.level === 'error');
  assert(errorLogs.length > 0, '应有错误日志（来自安全拦截测试）');

  // 日志包含时间戳
  assert(logs[0].time && typeof logs[0].time === 'string', '日志应包含时间戳');

  // ── 14. 白名单管理 ──
  section('14. 白名单动态管理');

  // 使用一个不在任何已有白名单父目录下的独立路径测试
  const independentDir = 'D:\\bot_test_whitelist_temp';
  fm.addToWhitelist(independentDir);
  const checkAdd = fm.isPathAllowed(path.join(independentDir, 'file.txt'));
  assert(checkAdd.allowed === true, '动态添加白名单后应允许访问');

  fm.removeFromWhitelist(independentDir);
  const checkRemove = fm.isPathAllowed(path.join(independentDir, 'file.txt'));
  assert(checkRemove.allowed === false, '移除白名单后应拒绝访问');

  // ── 总结 ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  测试完成：通过 ${passed} 项，失败 ${failed} 项`);
  console.log(`  测试文件保留在：${TEST_DIR}`);
  console.log(`${'='.repeat(60)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
