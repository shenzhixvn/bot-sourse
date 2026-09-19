const ShellBridge = require('./powershell');
const PythonBridge = require('./python');
const path = require('path');

class Dispatcher {
  constructor() {
    this.shell = new ShellBridge();
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
        return this.shell.exec(params.command);

      case 'open_app':
        return this.shell.open(params.app);

      case 'kill_process':
        return this.shell.killProcess(params.name);

      case 'system_info':
        return this.shell.systemInfo();

      case 'generate_code':
        const filePath = path.join(this.outputDir, params.filename);
        await this.py.writeFile(filePath, params.code);
        if (params.autoRun) {
          if (params.language === 'python') {
            return this.shell.exec(`python3 "${filePath}"`);
          } else if (params.language === 'node') {
            return this.shell.exec(`node "${filePath}"`);
          }
        }
        return { status: 'ok', path: filePath };

      default:
        return { status: 'error', message: `Unknown task type: ${type}` };
    }
  }
}

module.exports = Dispatcher;
