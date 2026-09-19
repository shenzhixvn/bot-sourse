# BOT — 一款桌面 AI 助手

一款运行在 **Windows 10/11** 上的现代化 AI 桌面助手（基于 Electron），连接 OpenAI 兼容的大模型 API，内置语音、文件操作、系统命令、截图识别等能力。

- **开发者**：沈若萱
- **版本**：1.3.0
- **更新服务器**：https://bot.x6m.top/

> 助手的**名称与身份跟随当前所连接的 API 供应商**（例如配置小米 MiMo 接口时，它就以「小米 MiMo」自称；换成 DeepSeek 就以「DeepSeek」自称）。

## ✨ 特性

- 🪟 **窗口化** — 轻量悬浮窗，可拖拽缩放，不干扰工作
- 🎨 **双主题** — 一键切换亮色/暗色模式，自动保存偏好
- ⚡ **流式输出** — 逐字显示 AI 回复，无需等待
- 💬 **上下文记忆** — 保持最近 20 轮对话历史
- 🧠 **长期记忆（本地向量库）** — 对话自动沉淀，提问时按语义召回相关记忆；数据仅存本机、离线可用
- 🧩 **多提供商** — 支持任意 OpenAI 兼容接口（可同时配置多家并切换）
- 🎭 **角色/智能体** — 自定义角色、模型、温度、可用工具
- 🎤 **语音输入 / 语音电话** — 语音转文字、AI 语音播报对话
- 📁 **文件操作** — 受白名单约束的本地文件读写
- 🖥 **系统命令 / 截图识别** — 需确认后执行
- ✂️ **选词助手** — 选中文字快捷键唤起翻译/总结/解释/润色
- 📌 **系统托盘** — 最小化到托盘，随时唤起
- 🚀 **自动更新** — 支持打包为 `.exe` 安装程序并在线升级

## 🚀 快速开始

### 环境要求

- **Node.js 18+**（推荐 20+）— [下载](https://nodejs.org/)
- **Python 3.8+**（可选，用于 Office 文档读写和本地 Whisper 语音识别）— [下载](https://www.python.org/downloads/)
- **Windows 10/11**（64 位）

> 项目根目录已内置 `.npmrc`，配置了国内镜像源（npmmirror），`npm install` 时会自动使用，无需额外配置。

### 1. 安装依赖

```bash
cd bot
npm install
```

### 2. 开发运行

```bash
npm start
```

### 3. 配置 API Key

首次启动后点击标题栏 ⚙ 打开设置：

1. 前往 [小米 MiMo 开放平台](https://platform.xiaomimimo.com) 注册，获取 API Key（`sk-` 开头的按量计费 Key）
2. 填入设置面板，点击保存

> 💡 **推荐使用小米大模型，也支持其他大模型。**
> 如需更换服务商，可在 **API 提供商管理** 中添加（如 DeepSeek、通义千问、智谱等）。助手的名称会跟随所选供应商自动变化。

## 📦 打包为 .exe 安装程序

### 一键打包

```bash
npm run build
```

打包完成后，在 `dist/` 目录下会生成：

```
dist/
├── BOT Setup 1.3.0.exe    # 安装程序
└── BOT Setup 1.3.0.exe.blockmap
```

### 仅打包便携版（免安装）

```bash
npm run build:portable
```

### 自定义图标

将你的图标文件放到 `build/icon.ico`（256x256 像素，ICO 格式），
打包时会自动使用。没有 ICO 文件也能打包，会使用默认图标。

## 🚀 自动更新

- 客户端通过 `electron-updater` 检查更新，更新源为 `https://bot.x6m.top/`
- 发布流程见 `deploy/publish.bat`（打包 → 上传 `dist/*.exe` 与 `dist/latest.yml` → 设置权限 → 校验）
- 服务端 nginx 配置见 `deploy/bot.x6m.top.nginx`（根目录 `/var/www/update`）

## ⌨️ 快捷键

| 操作 | 快捷键 |
|------|--------|
| 发送消息 | `Enter` |
| 换行 | `Shift + Enter` |
| 唤起/隐藏窗口 | `Ctrl + Alt + M`（可自定义） |
| 选词助手 | `Ctrl + Alt + Q`（可自定义） |
| 语音输入 | 点击 🎤 按钮 |
| 切换主题 | 点击 🌙/☀️ 按钮 |
| 清空对话 | 点击 🗑 按钮 |
| 关闭窗口 | 标题栏 ✕（可设为最小化到托盘） |

## 🔧 配置说明

| 字段 | 说明 | 默认值 |
|------|------|--------|
| API Key | 大模型平台密钥 | 无（必填） |
| API 地址 | 接口地址（OpenAI 兼容） | `https://api.xiaomimimo.com/v1` |
| 模型 | 模型名称 | `mimo-v2.5-pro` |
| 系统提示词 | AI 的角色设定 | 默认助手人设 |

> 默认接口为 OpenAI 兼容接口（小米 MiMo）；你也可以在「API 提供商管理」中换成其它服务商。
> 助手的名称/身份由当前激活的供应商决定，会自动注入到系统提示词中。

配置文件位置：`%APPDATA%/BOT/config.json`

## 📁 项目结构

```
bot/
├── src/
│   ├── main.js        # 主进程：窗口、API 请求、托盘、自动更新
│   ├── preload.js     # 安全 IPC 桥接
│   ├── index.html     # 主界面结构
│   ├── style.css      # 双主题样式（亮色 + 暗色）
│   ├── renderer.js    # 聊天、语音、主题切换逻辑
│   ├── voiceModule.js # 语音识别（STT）
│   ├── ttsModule.js   # 语音合成（TTS）
│   ├── manager.html   # 会话管理窗口
│   └── quick.html     # 选词助手窗口
├── core/
│   ├── aiProvider.js       # OpenAI 兼容 Provider 适配器
│   ├── providerManager.js  # 多提供商管理
│   ├── memoryStore.js      # 本地长期记忆（嵌入式向量存储）
│   ├── embedding.js        # 文本向量化（本地哈希 / API 嵌入）
│   ├── fileManager.js      # 本地文件管理（白名单）
│   ├── dispatcher.js       # 工具调用分发
│   ├── python.js           # Python 脚本调用
│   └── powershell.js       # PowerShell 调用
├── scripts/
│   ├── local_whisper_server.py  # 本地 Whisper 语音识别服务
│   └── start_whisper.bat        # 本地 Whisper 启动脚本
├── deploy/
│   ├── bot.x6m.top.nginx   # 更新服务器 nginx 配置
│   └── publish.bat         # 一键发布脚本
├── build/
│   └── icon.*              # 应用图标
├── package.json            # 含 electron-builder 打包配置
└── README.md
```

## 🧠 长期记忆（方案 A：本地嵌入式向量库）

BOT 内置一套**完全本地**的长期记忆系统，无需额外服务、不联网也可用：

- **自动沉淀** — 对话中的用户/助手消息会写入本机记忆库（内容 hash 去重，过短/代码块自动跳过）
- **自动召回** — 每次提问前按语义检索相关记忆，注入到系统提示词中
- **双嵌入模式**
  - 默认：内置本地哈希嵌入（512 维，中文友好，离线、零费用）
  - 可选：在设置里填写「嵌入模型」（如 `text-embedding-3-small`），改走当前提供商的 `/embeddings` 接口，语义更准
- **数据落盘** — `%APPDATA%/BOT/memory/memory.json`，仅保存在本机
- **可在设置中开关/调整召回条数/清空记忆库**

> 存储层为嵌入式纯 JS 向量索引（余弦相似度扫描），个人规模（万条以内）检索为毫秒级。
> 如需更大规模，可把 `core/memoryStore.js` 的存储层替换为 LanceDB / Milvus，接口不变。

## 🎤 语音说明

- **语音输入（STT）** — 默认复用内置语音识别，也可配置 HTTP STT（如 OpenAI Whisper）或本地 Whisper
- **语音电话（TTS）** — AI 回复转语音播报
- 需要系统授予麦克风权限

## 🌓 主题说明

- **暗色模式**（默认）— 深色背景，适合夜间使用
- **亮色模式** — 浅色背景，适合白天使用
- 主题偏好自动保存，下次启动自动恢复

## ⚠️ 注意事项

- 首次使用需在设置中配置大模型 API Key
- 关闭窗口默认不退出程序，而是隐藏到系统托盘
- 系统命令 / 文件操作受白名单与确认机制约束
- 打包需要网络下载 Electron 二进制文件
- 部分杀毒软件会拦截 `d3dcompiler_47.dll` 写入 `node_modules` 目录（该 DLL 常被恶意软件滥用，属安全软件特征拦截）。Electron 缺少此文件仍可正常运行，会自动回退到软件渲染或使用系统目录的 DLL；如需 GPU 硬件加速，可在杀毒软件中将项目目录添加为信任区后重新运行 `node node_modules/electron/install.js`
#   b o t - s o u r s e  
 