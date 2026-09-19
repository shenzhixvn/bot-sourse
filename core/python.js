const { spawn } = require('child_process');
const path = require('path');

class PythonBridge {
  constructor() {
    this.scriptPath = path.join(__dirname, '..', 'scripts', 'file_handler.py');
  }

  async run(args) {
    return new Promise((resolve, reject) => {
      const py = spawn('python', [this.scriptPath, ...args],
        { maxBuffer: 50 * 1024 * 1024 });
      let stdout = '', stderr = '';
      py.stdout.on('data', d => stdout += d);
      py.stderr.on('data', d => stderr += d);
      py.on('close', code => {
        if (code !== 0) {
          // 尝试解析 stdout 中的 JSON 错误
          try {
            const parsed = JSON.parse(stdout.trim());
            return resolve(parsed);
          } catch {
            return reject({ error: `Python exit ${code}`, stderr, stdout });
          }
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ status: 'ok', output: stdout.trim() });
        }
      });
      py.on('error', (err) => {
        reject({ error: 'Python 进程启动失败', detail: err.message });
      });
    });
  }

  // ── 纯文本 ──
  async writeFile(filePath, content) {
    return this.run(['write', filePath, content]);
  }

  async readFile(filePath) {
    return this.run(['read', filePath]);
  }

  async appendFile(filePath, content) {
    return this.run(['append', filePath, content]);
  }

  // ── Word (.docx) ──
  async readDocx(filePath) {
    return this.run(['read_docx', filePath]);
  }

  async writeDocx(filePath, content) {
    return this.run(['write_docx', filePath, content]);
  }

  // ── Excel (.xlsx) ──
  async readXlsx(filePath) {
    return this.run(['read_xlsx', filePath]);
  }

  async writeXlsx(filePath, content) {
    return this.run(['write_xlsx', filePath, content]);
  }

  // ── Office 统一入口（自动识别扩展名）──
  async readOfficeFile(filePath, fileType) {
    if (fileType === 'docx') return this.readDocx(filePath);
    if (fileType === 'xlsx') return this.readXlsx(filePath);
    return this.readFile(filePath);
  }

  async writeOfficeFile(filePath, content, fileType) {
    if (fileType === 'docx') return this.writeDocx(filePath, content);
    if (fileType === 'xlsx') return this.writeXlsx(filePath, content);
    return this.writeFile(filePath, content);
  }

  // ── 文件管理 ──
  async mkdir(dirPath) {
    return this.run(['mkdir', dirPath]);
  }

  async listDir(dirPath) {
    return this.run(['list', dirPath]);
  }

  async copyFile(source, dest) {
    return this.run(['copy', source, dest]);
  }

  async renameFile(source, dest) {
    return this.run(['rename', source, dest]);
  }

  async deleteFile(filePath) {
    return this.run(['delete', filePath]);
  }

  async openFile(filePath) {
    return this.run(['open', filePath]);
  }

  async execCode(code) {
    return this.run(['exec', code]);
  }
}

module.exports = PythonBridge;
