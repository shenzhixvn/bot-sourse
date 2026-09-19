const Dispatcher = require('./core/dispatcher');

async function main() {
  const dispatcher = new Dispatcher();

  console.log('=== 测试1：Python 生成并运行代码 ===');
  const r1 = await dispatcher.execute({
    type: 'generate_code',
    filename: 'hello.py',
    language: 'python',
    code: 'print("你好，BOT！")\nfor i in range(5):\n    print(f"第 {i+1} 次运行")',
    autoRun: true
  });
  console.log(r1);

  console.log('\n=== 测试2：PowerShell 查看系统信息 ===');
  const r2 = await dispatcher.execute({ type: 'system_info' });
  const info = JSON.parse(r2);
  console.log('系统:', info.WindowsProductName);
  console.log('主机名:', info.CsName);

  console.log('\n=== 测试3：列出输出目录 ===');
  const r3 = await dispatcher.execute({ type: 'list_dir' });
  console.log(r3);
}

main().catch(console.error);
