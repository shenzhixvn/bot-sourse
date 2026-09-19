// ============================================================
//  BOT — 本地文件管理器
//  功能：白名单安全校验、高危操作检测、统一文件操作接口
//  支持：.txt / .md / .docx / .xlsx 等常用办公文档
// ============================================================

const path = require('path');
const fs = require('fs');
const PythonBridge = require('./python');
const PowerShellBridge = require('./powershell');

// 系统关键目录（禁止访问）
const SYSTEM_DIRS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
];

// 纯文本扩展名
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.html', '.htm',
  '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
  '.h', '.hpp', '.log', '.ini', '.cfg', '.conf', '.yaml', '.yml',
  '.toml', '.sh', '.bat', '.ps1', '.sql', '.r', '.go', '.rs', '.swift',
  '.kt', '.php', '.rb', '.lua', '.vim', '.env', '.gitignore',
]);

class FileManager {
  /**
   * @param {Object} options
   * @param {string[]} options.whitelist - 允许访问的目录白名单
   * @param {boolean} options.autoOpen - 操作完成后是否自动打开文件
   * @param {Function} options.onLog - 日志回调 (level, message, detail)
   */
  constructor(options = {}) {
    this.whitelist = options.whitelist || [];
    this.autoOpen = options.autoOpen !== false;
    this.onLog = options.onLog || null;
    this.py = new PythonBridge();
    this.ps = new PowerShellBridge();
    this.logs = [];
  }

  // ── 日志系统 ──

  log(level, message, detail = '') {
    const entry = {
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      level,
      message,
      detail,
    };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    if (this.onLog) {
      try { this.onLog(entry); } catch {}
    }
    return entry;
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }

  // ── 路径工具 ──

  /**
   * 规范化路径为绝对路径，统一使用反斜杠
   */
  normalizePath(p) {
    return path.resolve(p).replace(/\//g, '\\');
  }

  /**
   * 获取文件类型：text / docx / xlsx / unknown
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') return 'docx';
    if (ext === '.xlsx') return 'xlsx';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return 'unknown';
  }

  // ── 安全校验 ──

  /**
   * 检查路径是否在白名单内
   * @returns {{allowed: boolean, reason?: string}}
   */
  isPathAllowed(p) {
    if (!p) return { allowed: false, reason: '路径为空' };

    // 白名单为空时，默认禁止所有操作（安全优先）
    if (!this.whitelist || this.whitelist.length === 0) {
      return { allowed: false, reason: '未配置允许访问的目录白名单，请在设置中添加授权目录' };
    }

    const normalized = this.normalizePath(p);

    for (const allowed of this.whitelist) {
      if (!allowed) continue;
      // 去掉末尾反斜杠，避免盘符根目录（如 D:\）拼接后变成双反斜杠 D:\\ 导致匹配失败
      const allowedNorm = this.normalizePath(allowed).replace(/\\+$/, '');
      // 精确匹配或子目录匹配
      if (normalized === allowedNorm || normalized.startsWith(allowedNorm + '\\')) {
        return { allowed: true };
      }
    }

    return { allowed: false, reason: `路径不在授权白名单内：${normalized}` };
  }

  /**
   * 检查是否为系统关键目录
   */
  isSystemPath(p) {
    const norm = this.normalizePath(p).toLowerCase();
    for (const sysDir of SYSTEM_DIRS) {
      if (norm.startsWith(sysDir.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检测高危操作
   * @returns {{highRisk: boolean, reasons: string[]}}
   */
  detectHighRisk(action, params) {
    const reasons = [];

    switch (action) {
      case 'write':
        reasons.push('即将写入文件，执行后将创建或覆盖目标文件内容');
        if (params.path && fs.existsSync(params.path)) {
          reasons.push('目标文件已存在，执行将覆盖原文件内容');
        }
        break;

      case 'delete':
        reasons.push('删除操作不可恢复，文件将被永久移除');
        break;

      case 'rename':
        if (params.dest && fs.existsSync(params.dest)) {
          reasons.push('目标路径已存在文件，重命名将覆盖该文件');
        }
        break;

      case 'copy':
        if (params.dest && fs.existsSync(params.dest)) {
          reasons.push('目标路径已存在文件，复制将覆盖该文件');
        }
        break;

      case 'append':
        reasons.push('即将向文件追加内容');
        break;
    }

    return { highRisk: reasons.length > 0, reasons };
  }

  /**
   * 完整校验操作（白名单 + 系统目录 + 路径合法性）
   * @returns {{valid: boolean, reason?: string}}
   */
  validate(action, params) {
    const pathsToCheck = [params.path, params.source, params.dest]
      .filter(Boolean)
      .filter(p => typeof p === 'string' && p.trim());

    if (pathsToCheck.length === 0 && action !== 'list') {
      return { valid: false, reason: '缺少必要的路径参数' };
    }

    for (const p of pathsToCheck) {
      // 检查系统目录
      if (this.isSystemPath(p)) {
        return { valid: false, reason: `禁止操作系统关键目录：${p}` };
      }

      // 检查白名单
      const check = this.isPathAllowed(p);
      if (!check.allowed) {
        return { valid: false, reason: check.reason };
      }

      // 检查路径中是否包含危险字符
      if (p.includes('..') || p.includes('\0')) {
        return { valid: false, reason: `路径包含非法字符：${p}` };
      }
    }

    return { valid: true };
  }

  // ── 统一执行入口 ──

  /**
   * 执行文件操作
   * @param {string} action - read / write / append / list / copy / rename / delete / open / mkdir
   * @param {Object} params - 操作参数
   * @returns {Promise<Object>}
   */
  async execute(action, params) {
    this.log('info', `[文件操作] 开始执行 ${action}`, JSON.stringify(params));

    // 安全校验
    const validation = this.validate(action, params);
    if (!validation.valid) {
      this.log('error', '[文件操作] 安全校验失败', validation.reason);
      return { success: false, error: validation.reason, action };
    }

    try {
      let result;

      switch (action) {
        case 'read':
          result = await this.read(params.path);
          break;
        case 'write':
          result = await this.write(params.path, params.content || '');
          break;
        case 'append':
          result = await this.append(params.path, params.content || '');
          break;
        case 'list':
          result = await this.list(params.path || this.whitelist[0] || '.');
          break;
        case 'copy':
          result = await this.copy(params.source, params.dest);
          break;
        case 'rename':
          result = await this.rename(params.source, params.dest);
          break;
        case 'delete':
          result = await this.delete(params.path);
          break;
        case 'open':
          result = await this.open(params.path);
          break;
        case 'mkdir':
          result = await this.mkdir(params.path);
          break;
        default:
          throw new Error(`未知操作类型：${action}`);
      }

      this.log('success', `[文件操作] ${action} 执行成功`, result.path || result.dest || '');
      return { success: true, action, ...result };

    } catch (err) {
      this.log('error', `[文件操作] ${action} 执行失败`, err.message);
      return { success: false, action, error: err.message };
    }
  }

  // ── 具体操作实现 ──

  async read(filePath) {
    const fileType = this.getFileType(filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在：${filePath}`);
    }

    this.log('info', `读取文件 [${fileType}]`, filePath);

    if (fileType === 'docx' || fileType === 'xlsx') {
      const result = await this.py.readOfficeFile(filePath, fileType);
      if (result.status === 'error') {
        throw new Error(result.message || 'Office 文件读取失败');
      }
      return result;
    }

    // 纯文本
    const result = await this.py.readFile(filePath);
    if (result.status === 'error') {
      throw new Error(result.message || '文件读取失败');
    }
    return result;
  }

  async write(filePath, content) {
    const fileType = this.getFileType(filePath);

    // 自动创建目录
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.log('info', '自动创建目录', dir);
    }

    this.log('info', `写入文件 [${fileType}]`, `${filePath} (${Buffer.byteLength(content, 'utf8')} 字节)`);

    if (fileType === 'docx' || fileType === 'xlsx') {
      const result = await this.py.writeOfficeFile(filePath, content, fileType);
      if (result.status === 'error') {
        throw new Error(result.message || 'Office 文件写入失败');
      }
      return result;
    }

    // 纯文本
    const result = await this.py.writeFile(filePath, content);
    if (result.status === 'error') {
      throw new Error(result.message || '文件写入失败');
    }
    return result;
  }

  async append(filePath, content) {
    this.log('info', '追加内容到文件', filePath);

    if (fs.existsSync(filePath)) {
      const fileType = this.getFileType(filePath);
      if (fileType === 'docx' || fileType === 'xlsx') {
        // Office 文件：读取后合并再写入
        const existing = await this.read(filePath);
        const merged = (existing.content || '') + '\n' + content;
        return this.write(filePath, merged);
      }
      // 纯文本：直接追加
      const result = await this.py.appendFile(filePath, content);
      if (result.status === 'error') {
        throw new Error(result.message || '追加失败');
      }
      return result;
    }

    // 文件不存在则新建
    return this.write(filePath, content);
  }

  async list(dirPath) {
    this.log('info', '列出目录内容', dirPath);

    if (!fs.existsSync(dirPath)) {
      throw new Error(`目录不存在：${dirPath}`);
    }

    const result = await this.py.listDir(dirPath);
    if (result.status === 'error') {
      throw new Error(result.message || '列出目录失败');
    }
    return result;
  }

  async copy(source, dest) {
    this.log('info', '复制文件', `${source} -> ${dest}`);

    if (!fs.existsSync(source)) {
      throw new Error(`源文件不存在：${source}`);
    }

    // 自动创建目标目录
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const result = await this.py.copyFile(source, dest);
    if (result.status === 'error') {
      throw new Error(result.message || '复制失败');
    }
    return result;
  }

  async rename(source, dest) {
    this.log('info', '重命名文件', `${source} -> ${dest}`);

    if (!fs.existsSync(source)) {
      throw new Error(`源文件不存在：${source}`);
    }

    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const result = await this.py.renameFile(source, dest);
    if (result.status === 'error') {
      throw new Error(result.message || '重命名失败');
    }
    return result;
  }

  async delete(filePath) {
    this.log('warn', '删除文件', filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在：${filePath}`);
    }

    const result = await this.py.deleteFile(filePath);
    if (result.status === 'error') {
      throw new Error(result.message || '删除失败');
    }
    return result;
  }

  async open(filePath) {
    this.log('info', '用默认程序打开文件', filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在：${filePath}`);
    }

    const result = await this.py.openFile(filePath);
    if (result.status === 'error') {
      // 回退到 PowerShell
      try {
        await this.ps.exec(`Start-Process "${filePath}"`);
        return { path: filePath, opened: true, method: 'powershell' };
      } catch (e) {
        throw new Error(result.message || e.message || '打开文件失败');
      }
    }
    return result;
  }

  async mkdir(dirPath) {
    this.log('info', '创建目录', dirPath);

    const result = await this.py.mkdir(dirPath);
    if (result.status === 'error') {
      throw new Error(result.message || '创建目录失败');
    }
    return result;
  }

  // ── 白名单管理 ──

  setWhitelist(dirs) {
    this.whitelist = Array.isArray(dirs) ? dirs.filter(Boolean) : [];
    this.log('info', '更新目录白名单', this.whitelist.join('; '));
  }

  addToWhitelist(dir) {
    const normalized = this.normalizePath(dir);
    if (!this.whitelist.includes(normalized)) {
      this.whitelist.push(normalized);
      this.log('info', '添加授权目录', normalized);
    }
  }

  removeFromWhitelist(dir) {
    const normalized = this.normalizePath(dir);
    this.whitelist = this.whitelist.filter(d => this.normalizePath(d) !== normalized);
    this.log('info', '移除授权目录', normalized);
  }
}

module.exports = FileManager;
