// ============================================================
//  BOT — 跨平台 Shell 命令桥
//  Windows: PowerShell
//  Linux:   bash
//  macOS:   zsh (fallback bash)
// ============================================================

const { exec } = require('child_process');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

class ShellBridge {
  /**
   * 执行系统命令（跨平台）
   */
  async run(command) {
    return new Promise((resolve, reject) => {
      let cmdLine;
      if (isWin) {
        const escaped = command.replace(/"/g, '`"');
        cmdLine = 'powershell -NoProfile -Command "' + escaped + '"';
      } else {
        cmdLine = command;
      }
      exec(cmdLine, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject({ error: err.message, stderr });
        resolve((stdout || '').trim());
      });
    });
  }

  /**
   * 打开应用/文件/URL
   */
  async open(target) {
    if (isWin) {
      return this.run("Start-Process '" + target.replace(/'/g, "''") + "'");
    } else if (isMac) {
      return this.run('open "' + target + '"');
    } else {
      return this.run('xdg-open "' + target + '"');
    }
  }

  /**
   * 终止进程
   */
  async killProcess(name) {
    if (isWin) {
      return this.run("Stop-Process -Name '" + name.replace(/'/g, "''") + "' -Force");
    } else if (isMac) {
      return this.run('killall -9 "' + name + '"');
    } else {
      return this.run('pkill -9 "' + name + '"');
    }
  }

  /**
   * 获取系统信息
   */
  async systemInfo() {
    if (isWin) {
      return this.run('Get-ComputerInfo | ConvertTo-Json -Depth 3');
    } else {
      const os = isMac ? await this.run('sw_vers') : await this.run('cat /etc/os-release | grep PRETTY_NAME');
      const kernel = await this.run('uname -a');
      const disk = await this.run('df -h /');
      const mem = isMac ? await this.run('vm_stat | head -5') : await this.run('free -h');
      return JSON.stringify({ os, kernel, disk, mem });
    }
  }

  /**
   * 列出目录
   */
  async listDir(dirPath) {
    if (isWin) {
      return this.run("Get-ChildItem '" + dirPath.replace(/'/g, "''") + "' | Select-Object Name, Length, LastWriteTime | ConvertTo-Json");
    } else {
      return this.run('ls -la "' + dirPath + '"');
    }
  }

  /**
   * 创建文件
   */
  async createFile(filePath, content) {
    if (isWin) {
      const escapedContent = content.replace(/'/g, "''");
      return this.run("Set-Content -Path '" + filePath.replace(/'/g, "''") + "' -Value '" + escapedContent + "' -Encoding UTF8");
    } else {
      return this.run('cat > "' + filePath + '" << \'BOTEOF\'\n' + content + '\nBOTEOF');
    }
  }

  /**
   * 执行任意命令
   */
  async exec(command) {
    return this.run(command);
  }
}

module.exports = ShellBridge;
