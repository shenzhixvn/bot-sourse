// 生成应用图标
// 用法: node scripts/gen-icon.js
// 实际由 gen-png.js 生成 build/icon.png（纯 Node.js，无依赖）
// electron-builder 打包时会自动从 PNG 生成 .ico

require('./gen-png.js');
