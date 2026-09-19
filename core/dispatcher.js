const PowerShellBridge = require('./powershell');
const PythonBridge = require('./python');
const path = require('path');

class Dispatcher {
  constructor() {
    this.ps = new PowerShellBridge();
    this.py = new PythonBridge();
    this.outputDir = path.join(__dirname, '..', 'output');
  }

  async execute(task) {
    const { type, ...params } = task;
    
    switch (type) {
      case 'create_file':
        return this.py.writeFile(
          path.join(this.outputDir, params.filename),
          params.content
        );
      
      case 'read_file':
        return this.py.readFile(params.path);
      
      case 'list_dir':
        return this.py.listDir(params.path || this.outputDir);

      case 'run_command':
        return this.ps.exec(params.command);
      
      case 'open_app':
        return this.ps.exec(`Start-Process '${params.app}'`);
      
      case 'kill_process':
        return this.ps.exec(`Stop-Process -Name '${params.name}' -Force`);
      
      case 'system_info':
        return this.ps.exec('Get-ComputerInfo | ConvertTo-Json -Depth 3');

      case 'generate_code':
        const filePath = path.join(this.outputDir, params.filename);
        await this.py.writeFile(filePath, params.code);
        if (params.autoRun) {
          if (params.language === 'python') {
            return this.ps.exec(`python "${filePath}"`);
          } else if (params.language === 'node') {
            return this.ps.exec(`node "${filePath}"`);
          }
        }
        return { status: 'ok', path: filePath };

      default:
        return { status: 'error', message: `Unknown task type: ${type}` };
    }
  }
}

module.exports = Dispatcher;
