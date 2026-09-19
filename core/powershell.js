const { exec } = require('child_process');

class PowerShellBridge {
  async run(command) {
    return new Promise((resolve, reject) => {
      const escaped = command.replace(/"/g, '`"');
      exec(`powershell -NoProfile -Command "${escaped}"`, 
        { maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return reject({ error: err.message, stderr });
          resolve(stdout.trim());
        });
    });
  }

  async createFile(path, content) {
    const escapedContent = content.replace(/'/g, "''");
    return this.run(`Set-Content -Path '${path}' -Value '${escapedContent}' -Encoding UTF8`);
  }

  async listDir(path) {
    return this.run(`Get-ChildItem '${path}' | Select-Object Name, Length, LastWriteTime | ConvertTo-Json`);
  }

  async exec(command) {
    return this.run(command);
  }
}

module.exports = PowerShellBridge;
