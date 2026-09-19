const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');
const FileManager = require('../core/fileManager');
const ProviderManager = require('../core/providerManager');
const { MemoryStore } = require('../core/memoryStore');
const providerManager = new ProviderManager();

// ============================================================
//  全局状态
// ============================================================
let mainWindow = null;        // 主窗口（标签页 + 聊天）
let managerWindow = null;     // 会话管理器窗口（历史会话）
let tray = null;
let fileManager = null;
let memoryStore = null;   // 本地长期记忆（方案 A：嵌入式向量存储）

// 长期记忆默认配置
const MEMORY_DEFAULTS = {
  memoryEnabled: true,
  memoryTopK: 5,
  memoryMinScore: 0.12,
  embeddingModel: '', // 留空 = 本地哈希嵌入（离线可用）；填写则走 API 嵌入
};

function applyMemoryDefaults(cfg) {
  for (const k of Object.keys(MEMORY_DEFAULTS)) {
    if (cfg[k] === undefined || cfg[k] === null) cfg[k] = MEMORY_DEFAULTS[k];
  }
  return cfg;
}

// 初始化（或重建）长期记忆存储
async function initMemoryStore(cfg) {
  applyMemoryDefaults(cfg);
  const dir = path.join(app.getPath('userData'), 'memory');
  // 嵌入器用当前激活提供商的凭据（若配置了 embeddingModel）
  const active = providerManager.getActiveConfig() || {};
  const embedConfig = {
    baseUrl: active.baseUrl || cfg.baseUrl,
    apiKey: active.apiKey || cfg.apiKey,
    embeddingModel: cfg.embeddingModel || '',
  };
  if (!memoryStore) {
    memoryStore = new MemoryStore({ dir, embedConfig });
    await memoryStore.init();
  } else {
    await memoryStore.reconfigure(embedConfig);
  }
  const s = memoryStore.stats();
  console.log(`[memory] 长期记忆库已就绪: ${s.count} 条 / 维度 ${s.dim} / 嵌入 ${s.embedder}`);
  return memoryStore;
}

// 从最近一条用户消息召回相关记忆，拼成提示词
async function recallMemoryText(cfg, messages) {
  if (!cfg.memoryEnabled || !memoryStore || !memoryStore.ready) return '';
  const lastUser = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
  if (!lastUser || lastUser.content.trim().length < 2) return '';
  try {
    const hits = await memoryStore.search(lastUser.content, {
      topK: cfg.memoryTopK || 5,
      minScore: cfg.memoryMinScore ?? 0.12,
    });
    if (!hits.length) return '';
    const lines = hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
    return `## 长期记忆（从本地记忆库中召回，仅供参考）\n以下是与你当前问题可能相关的历史信息，如与问题无关请忽略，不要生硬复述：\n${lines}`;
  } catch (e) {
    console.error('[memory] 召回失败:', e.message);
    return '';
  }
}

// 把对话中的用户/助手消息沉淀进记忆库（内容 hash 去重）
async function ingestConversation(messages) {
  if (!memoryStore || !memoryStore.ready) return;
  const cfg = loadConfigSafe();
  if (!cfg.memoryEnabled) return;
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string') continue;
    const text = m.content.trim();
    if (text.length < 8 || text.length > 2000) continue;
    if (text.startsWith('!!!') || text.startsWith('```')) continue; // 跳过工具指令/代码块
    try {
      await memoryStore.add(text, { role: m.role, ts: Date.now() });
    } catch (e) {
      console.error('[memory] 沉淀失败:', e.message);
    }
  }
}

function loadConfigSafe() {
  try {
    return applyMemoryDefaults(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch {
    return applyMemoryDefaults({ ...MEMORY_DEFAULTS });
  }
}

// 会话数据目录
const conversationsDir = path.join(app.getPath('userData'), 'conversations');
const indexFile = path.join(conversationsDir, 'index.json');

// 主会话固定 ID
const MAIN_CONVERSATION_ID = 'main';

// 确保会话目录存在
function ensureConversationsDir() {
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }
}

// 确保主会话存在（固定 ID，不可删除，有记忆）
function ensureMainConversation() {
  ensureConversationsDir();
  const index = loadConversationIndex();
  const mainIdx = index.findIndex(c => c.id === MAIN_CONVERSATION_ID);
  if (mainIdx === -1) {
    const mainConv = {
      id: MAIN_CONVERSATION_ID,
      title: '主对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      isMain: true,
      pinned: true,
    };
    index.unshift(mainConv);
    saveConversationIndex(index);

    const convFile = path.join(conversationsDir, `${MAIN_CONVERSATION_ID}.json`);
    if (!fs.existsSync(convFile)) {
      fs.writeFileSync(convFile, JSON.stringify({ id: MAIN_CONVERSATION_ID, messages: [] }, null, 2));
    }
  } else {
    // 强制修正主会话标题为"主对话"，防止被意外更改
    if (index[mainIdx].title !== '主对话') {
      index[mainIdx].title = '主对话';
      saveConversationIndex(index);
    }
  }
}

// ============================================================
//  会话元数据管理 (index.json)
// ============================================================
function loadConversationIndex() {
  ensureConversationsDir();
  try {
    if (fs.existsSync(indexFile)) {
      return JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    }
  } catch (e) {
    console.error('加载会话索引失败:', e.message);
  }
  return [];
}

function saveConversationIndex(index) {
  ensureConversationsDir();
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

function generateId() {
  return 'conv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function createConversation(title) {
  const id = generateId();
  const now = Date.now();
  // 读取默认角色
  let defaultAgentId = 'default';
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    defaultAgentId = cfg.defaultAgentId || 'default';
  } catch {}
  const conversation = {
    id,
    title: title || '新对话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    pinned: false,
    agentId: defaultAgentId,
  };

  const index = loadConversationIndex();
  index.unshift(conversation);
  saveConversationIndex(index);

  const convFile = path.join(conversationsDir, `${id}.json`);
  fs.writeFileSync(convFile, JSON.stringify({ id, messages: [] }, null, 2));

  return conversation;
}

function deleteConversation(id) {
  // 主会话不可删除
  if (id === MAIN_CONVERSATION_ID) {
    return false;
  }
  const index = loadConversationIndex();
  const filtered = index.filter(c => c.id !== id);
  saveConversationIndex(filtered);

  const convFile = path.join(conversationsDir, `${id}.json`);
  if (fs.existsSync(convFile)) {
    fs.unlinkSync(convFile);
  }
  return true;
}

// 重命名会话（主会话不可重命名）
function renameConversation(id, newTitle) {
  if (id === MAIN_CONVERSATION_ID) {
    return false;
  }
  const title = (newTitle || '').trim() || '新对话';
  updateConversationMeta(id, { title });
  return true;
}

// 切换会话置顶状态（主会话始终置顶，不可取消）
function togglePinConversation(id) {
  if (id === MAIN_CONVERSATION_ID) {
    return false;
  }
  const index = loadConversationIndex();
  const idx = index.findIndex(c => c.id === id);
  if (idx !== -1) {
    index[idx].pinned = !index[idx].pinned;
    index[idx].updatedAt = Date.now();
    saveConversationIndex(index);
    return index[idx].pinned;
  }
  return false;
}

function updateConversationMeta(id, updates) {
  const index = loadConversationIndex();
  const idx = index.findIndex(c => c.id === id);
  if (idx !== -1) {
    index[idx] = { ...index[idx], ...updates, updatedAt: Date.now() };
    saveConversationIndex(index);
  }
}

function loadConversationMessages(id) {
  const convFile = path.join(conversationsDir, `${id}.json`);
  try {
    if (fs.existsSync(convFile)) {
      const data = JSON.parse(fs.readFileSync(convFile, 'utf-8'));
      return data.messages || [];
    }
  } catch (e) {
    console.error('加载会话消息失败:', e.message);
  }
  return [];
}

function saveConversationMessages(id, messages) {
  ensureConversationsDir();
  const convFile = path.join(conversationsDir, `${id}.json`);
  const data = { id, messages, savedAt: Date.now() };
  fs.writeFileSync(convFile, JSON.stringify(data, null, 2));

  const count = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
  // 主会话标题固定为"主对话"，不随消息内容更改
  let title;
  if (id === MAIN_CONVERSATION_ID) {
    title = '主对话';
  } else {
    title = '新对话';
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) {
      title = firstUser.content.length > 30 ? firstUser.content.substring(0, 30) + '...' : firstUser.content;
    }
  }
  updateConversationMeta(id, { title, messageCount: count });
}

// ============================================================
//  窗口创建
// ============================================================

// 创建主窗口（标签页 + 聊天）
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 500,
    minHeight: 480,
    x: Math.floor((screenW - 820) / 2),
    y: Math.floor((screenH - 640) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // 监听最大化状态变化，通知渲染进程更新按钮图标
  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized', true);
    }
  });
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized', false);
    }
  });

  return mainWindow;
}

// 创建会话管理器窗口
function createManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
    return managerWindow;
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  managerWindow = new BrowserWindow({
    width: 380,
    height: 520,
    x: Math.floor((screenW - 380) / 2),
    y: Math.floor((screenH - 520) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    skipTaskbar: false,
    alwaysOnTop: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  managerWindow.loadFile(path.join(__dirname, 'manager.html'));
  managerWindow.on('closed', () => { managerWindow = null; });

  return managerWindow;
}

// ============================================================
//  托盘
// ============================================================
function createTray() {
  // 使用应用图标作为托盘图标，调整为合适大小
  const iconPath = path.join(__dirname, '../build/icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      throw new Error('图标文件为空');
    }
    // 调整为托盘合适尺寸
    icon = icon.resize({ width: 16, height: 16 });
  } catch (e) {
    //  fallback 到绿色圆点
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAQ9JREFUWEftlrENwjAQRf8lgBQUzMAIjMAIjMAIjMAIjMAIjMAIjMAI7AAVUzACIzACJRw5WbYlp7hJL07+3f/f3bMd0ONnegS7EwT+JwUCoVAKBQCoVAIhEIhEAqFQCgUAqFQCIRCoRIKvQBsAGwBzA0jPwK4ADgBODuFdwOwB3AAkBlGfgJwAXACcHIK7w7gAOAAILcHkIrJA8B00F8mKt8DeAI4AjjYd0JxBSkA3IbhLX1LwzmAOYBJ4BzRNgCwAvAEcAawAPAIXCK6EaQAcBuGt/RdGs4AzAFMAueItiGAFYBn4BxRGsBtGN7S92g4BzAHMAmcI9oGAFYAnoFzRGkAt2F4S9+j4RzAHMAkcI5oGwBYAXgGzhGlAdyG4S19j4ZzAHMAk8A5om0AYAXgGThHlAZwG4a39D0azgHMAUwC54i2AYAVgGfgHFEaIPEL3QK4Azj+AYdMJsFKAAAAAElFTkSuQmCC'
    );
  }
  tray = new Tray(icon);
  tray.setToolTip('BOT');
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createMainWindow();
    }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => createMainWindow() },
    { label: '会话管理', click: () => createManagerWindow() },
    { label: '新建对话', click: () => {
      createMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tab:new');
      }
    }},
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

// ============================================================
//  IPC: 窗口控制
// ============================================================
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:close', () => {
  // 根据配置决定关闭行为：最小化到托盘 或 直接退出
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (cfg.closeBehavior === 'quit') {
      app.quit();
      return;
    }
  } catch {}
  mainWindow?.hide();
});

// 最大化/还原
ipcMain.on('win:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('win:isMaximized', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
});

// 窗口置顶切换
ipcMain.handle('window:toggle-always-on-top', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const isTop = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!isTop);
    return !isTop;
  }
  return false;
});

ipcMain.handle('window:is-always-on-top', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isAlwaysOnTop() : false;
});

// ============================================================
//  IPC: 全局快捷键
// ============================================================
let currentShortcut = null;

ipcMain.handle('shortcut:register', (event, accelerator) => {
  try {
    // 先注销之前的快捷键
    if (currentShortcut) {
      globalShortcut.unregister(currentShortcut);
    }
    // 注册新快捷键
    const success = globalShortcut.register(accelerator, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
    if (success) {
      currentShortcut = accelerator;
      return { success: true };
    } else {
      return { success: false, error: '快捷键注册失败，可能被其他应用占用' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('shortcut:unregister', (event, accelerator) => {
  globalShortcut.unregister(accelerator);
  if (currentShortcut === accelerator) {
    currentShortcut = null;
  }
  return { success: true };
});

ipcMain.handle('shortcut:unregister-all', () => {
  globalShortcut.unregisterAll();
  currentShortcut = null;
  return { success: true };
});

// ============================================================
//  IPC: 导出对话
// ============================================================
ipcMain.handle('export:markdown', async (event, { content, defaultName }) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出对话为 Markdown',
      defaultPath: defaultName || '对话记录.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (filePath) {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    }
    return { success: false, cancelled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
//  IPC: 会话管理
// ============================================================

ipcMain.handle('conv:list', () => {
  const list = loadConversationIndex();
  // 排序：主会话最前 → 置顶子会话（按更新时间降序）→ 普通子会话（按更新时间降序）
  return list.sort((a, b) => {
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
});

ipcMain.handle('conv:create', (event, title) => {
  return createConversation(title);
});

ipcMain.handle('conv:delete', (event, conversationId) => {
  const success = deleteConversation(conversationId);
  if (success && managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send('conv:list-updated');
  }
  return success;
});

ipcMain.handle('conv:rename', (event, { conversationId, title }) => {
  const success = renameConversation(conversationId, title);
  if (success && managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send('conv:list-updated');
  }
  return success;
});

ipcMain.handle('conv:setAgent', (event, { conversationId, agentId }) => {
  try {
    const index = loadConversationIndex();
    const conv = index.find(c => c.id === conversationId);
    if (conv) {
      conv.agentId = agentId;
      conv.updatedAt = Date.now();
      saveConversationIndex(index);
      return { success: true };
    }
    return { success: false, error: '会话不存在' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('conv:togglePin', (event, conversationId) => {
  const result = togglePinConversation(conversationId);
  if (result !== false && managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send('conv:list-updated');
  }
  return result;
});

ipcMain.handle('conv:loadMessages', (event, conversationId) => {
  return loadConversationMessages(conversationId);
});

ipcMain.handle('conv:saveMessages', (event, { conversationId, messages }) => {
  saveConversationMessages(conversationId, messages);
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send('conv:list-updated');
  }
  // 沉淀进本地长期记忆（异步，不阻塞 UI）
  ingestConversation(messages).catch(e => console.error('[memory] 沉淀异常:', e.message));
  return true;
});

// ============================================================
//  IPC: 本地长期记忆（方案 A）
// ============================================================
ipcMain.handle('memory:stats', async () => {
  if (!memoryStore || !memoryStore.ready) return { count: 0, dim: 0, embedder: '-', ready: false };
  return { ...memoryStore.stats(), ready: true };
});

ipcMain.handle('memory:search', async (event, { query, topK, minScore }) => {
  if (!memoryStore || !memoryStore.ready) return [];
  return memoryStore.search(query, { topK: topK || 5, minScore: minScore ?? 0.1 });
});

ipcMain.handle('memory:list', async (event, { limit, offset } = {}) => {
  if (!memoryStore || !memoryStore.ready) return [];
  return memoryStore.list({ limit: limit || 100, offset: offset || 0 });
});

ipcMain.handle('memory:add', async (event, { text, meta }) => {
  if (!memoryStore || !memoryStore.ready) return { success: false, error: '记忆库未就绪' };
  try {
    const r = await memoryStore.add(text, meta || {});
    return { success: true, ...r };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('memory:remove', async (event, { id }) => {
  if (!memoryStore || !memoryStore.ready) return { success: false, error: '记忆库未就绪' };
  return { success: true, ...(await memoryStore.remove(id)) };
});

ipcMain.handle('memory:clear', async () => {
  if (!memoryStore || !memoryStore.ready) return { success: false, error: '记忆库未就绪' };
  return { success: true, ...(await memoryStore.clear()) };
});

// 配置变更后重建记忆库（例如切换了 embeddingModel）
ipcMain.handle('memory:reconfigure', async () => {
  try {
    const cfg = loadConfigSafe();
    await initMemoryStore(cfg);
    return { success: true, ...memoryStore.stats() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('conv:showManager', () => {
  createManagerWindow();
  return true;
});

// 在主窗口中打开指定会话（切换到对应标签）
ipcMain.handle('conv:openInMain', (event, conversationId) => {
  createMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab:open', conversationId);
  }
  return true;
});

// ============================================================
//  IPC: API 请求（流式，走 ProviderManager 多提供商）
// ============================================================

ipcMain.handle('api:chat', async (event, { messages, config }) => {
  const provider = providerManager.getActive();
  if (!provider) {
    return { success: false, error: '没有可用的 AI 提供商，请在设置中配置' };
  }

  // 身份：bot 的名称/身份跟随当前激活的 API 供应商
  const activeCfg = providerManager.getActiveConfig();
  let processedMessages = injectSystemMessage(
    messages,
    buildProviderIdentityPrompt(activeCfg && activeCfg.name)
  );

  // 长期记忆召回（本地嵌入式向量检索），拼进系统提示词
  try {
    const memoryText = await recallMemoryText(loadConfigSafe(), messages);
    if (memoryText) processedMessages = injectSystemMessage(processedMessages, memoryText);
  } catch (e) {
    console.error('[memory] 召回注入失败:', e.message);
  }

  // 如果开启了联网搜索，在系统提示词中添加联网搜索能力说明
  if (config.webSearchEnabled) {
    const webSearchNote = `## 联网搜索能力（已开启）
你现在具备联网搜索能力！当用户询问实时信息（如新闻、天气、价格、最新事件、地点信息等）时，系统会自动进行联网搜索并返回搜索结果。你可以基于搜索结果回答用户问题，并在回复中引用搜索来源。
不需要联网时（如知识问答、创意写作、代码编写），直接用自身知识回答即可。`;

    processedMessages = processedMessages.map(msg => {
      if (msg.role === 'system') {
        return { ...msg, content: webSearchNote + '\n\n' + msg.content };
      }
      return msg;
    });

    if (!processedMessages.some(m => m.role === 'system')) {
      processedMessages.unshift({ role: 'system', content: webSearchNote });
    }
  }

  const options = {
    model: config.model,
    maxTokens: config.maxTokens,
    webSearch: config.webSearchEnabled || false,
    webSearchMaxKeyword: config.webSearchMaxKeyword || 3,
  };

  try {
    await provider.stream(
      processedMessages,
      options,
      (delta) => {
        mainWindow?.webContents.send('api:chunk', { content: delta });
      },
      (sources) => {
        mainWindow?.webContents.send('api:chunk', { sources });
      }
    );

    mainWindow?.webContents.send('api:chunk', { done: true });
    return { success: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      mainWindow?.webContents.send('api:chunk', { done: true, aborted: true });
      return { success: true, aborted: true };
    }
    return { success: false, error: err.message };
  }
});

// 手动停止当前生成
ipcMain.handle('api:abort', () => {
  const provider = providerManager.getActive();
  if (provider) {
    provider.abort();
    return { success: true };
  }
  return { success: false, error: '没有正在进行的请求' };
});

// ============================================================
//  IPC: 多提供商管理
// ============================================================
ipcMain.handle('provider:list', () => {
  return providerManager.list();
});

ipcMain.handle('provider:getActive', () => {
  return providerManager.getActiveConfig();
});

ipcMain.handle('provider:save', (event, providerConfig) => {
  const saved = providerManager.save(providerConfig);
  // 同步保存到配置文件
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const exported = providerManager.exportConfig();
    cfg.providers = exported.providers;
    cfg.activeProvider = exported.activeProvider;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch {}
  return saved;
});

ipcMain.handle('provider:remove', (event, id) => {
  const ok = providerManager.remove(id);
  if (ok) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const exported = providerManager.exportConfig();
      cfg.providers = exported.providers;
      cfg.activeProvider = exported.activeProvider;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    } catch {}
  }
  return { success: ok };
});

ipcMain.handle('provider:setActive', (event, id) => {
  const ok = providerManager.setActive(id);
  if (ok) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      cfg.activeProvider = id;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    } catch {}
  }
  return { success: ok };
});

ipcMain.handle('provider:test', async (event, id) => {
  return await providerManager.test(id);
});

// ============================================================
//  IPC: 角色/智能体管理
// ============================================================
function getDefaultAgents() {
  return [
    {
      id: 'default',
      name: '默认助手',
      avatar: '🤖',
      systemPrompt: '',
      model: '',
      temperature: 0.7,
      tools: { file: true, command: true, screenshot: true },
    },
    {
      id: 'coder',
      name: '代码专家',
      avatar: '💻',
      systemPrompt: '你是一位资深程序员和代码架构师。擅长多种编程语言和框架，能够编写高质量、可维护的代码。回答代码问题时，优先给出完整可运行的代码，然后简要说明关键思路。代码风格简洁清晰，注释适度。',
      model: '',
      temperature: 0.3,
      tools: { file: true, command: false, screenshot: true },
    },
    {
      id: 'writer',
      name: '文档写作',
      avatar: '✍️',
      systemPrompt: '你是一位专业的文档写作专家。擅长撰写技术文档、项目报告、学习笔记、工作总结等各类文档。写作风格专业、条理清晰、逻辑严谨，善于使用标题、列表、表格等结构化表达。',
      model: '',
      temperature: 0.5,
      tools: { file: true, command: false, screenshot: false },
    },
    {
      id: 'translator',
      name: '翻译官',
      avatar: '🌐',
      systemPrompt: '你是一位专业翻译官，精通中英文互译。翻译时保持原文意思准确、语言自然流畅，符合目标语言的表达习惯。专业术语翻译准确，必要时保留原文并加注。',
      model: '',
      temperature: 0.3,
      tools: { file: false, command: false, screenshot: false },
    },
    {
      id: 'chat',
      name: '纯聊天',
      avatar: '💬',
      systemPrompt: '你是一个轻松友好的聊天伙伴，擅长日常闲聊、情感陪伴、兴趣交流。回复简洁有趣，像朋友一样自然。不使用任何工具，不执行文件操作或系统命令。',
      model: '',
      temperature: 0.8,
      tools: { file: false, command: false, screenshot: false },
    },
  ];
}

function ensureAgents(cfg) {
  if (!cfg.agents || !Array.isArray(cfg.agents) || cfg.agents.length === 0) {
    cfg.agents = getDefaultAgents();
  }
  if (!cfg.defaultAgentId) {
    cfg.defaultAgentId = 'default';
  }
  return cfg;
}

ipcMain.handle('agent:list', () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    ensureAgents(cfg);
    return cfg.agents;
  } catch {
    return getDefaultAgents();
  }
});

ipcMain.handle('agent:save', (event, agent) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    ensureAgents(cfg);
    if (agent.id) {
      const idx = cfg.agents.findIndex(a => a.id === agent.id);
      if (idx >= 0) {
        cfg.agents[idx] = { ...cfg.agents[idx], ...agent };
      } else {
        cfg.agents.push(agent);
      }
    } else {
      agent.id = 'agent-' + Date.now();
      cfg.agents.push(agent);
    }
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return agent;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('agent:remove', (event, id) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    ensureAgents(cfg);
    if (cfg.agents.length <= 1) {
      return { success: false, error: '至少保留一个角色' };
    }
    cfg.agents = cfg.agents.filter(a => a.id !== id);
    if (cfg.defaultAgentId === id) {
      cfg.defaultAgentId = cfg.agents[0].id;
    }
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
//  IPC: 配置读写
// ============================================================
const configPath = path.join(app.getPath('userData'), 'config.json');

ipcMain.handle('config:load', async () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.systemPrompt = migrateSystemPrompt(cfg.systemPrompt);
    if (!cfg.systemPrompt) {
      cfg.systemPrompt = getDefaultSystemPrompt();
    }
    ensureAgents(cfg);
    applyMemoryDefaults(cfg);
    initFileManager(cfg);
    providerManager.loadConfig(cfg);
    await initMemoryStore(cfg);
    return cfg;
  } catch {
    const defaultCfg = {
      apiKey: '',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro',
      systemPrompt: getDefaultSystemPrompt(),
      fileWhitelist: getDefaultWhitelist(),
      quickActionShortcut: 'Control+Alt+Q',
      closeBehavior: 'tray',
      ...MEMORY_DEFAULTS,
    };
    ensureAgents(defaultCfg);
    applyMemoryDefaults(defaultCfg);
    initFileManager(defaultCfg);
    providerManager.loadConfig(defaultCfg);
    await initMemoryStore(defaultCfg);
    return defaultCfg;
  }
});

function initFileManager(config) {
  const whitelist = config.fileWhitelist || getDefaultWhitelist();
  fileManager = new FileManager({
    whitelist,
    autoOpen: true,
    onLog: (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:log', entry);
      }
      if (managerWindow && !managerWindow.isDestroyed()) {
        managerWindow.webContents.send('file:log', entry);
      }
    },
  });
}

// 身份提示词：bot 的名称/身份跟随当前 API 供应商
function buildProviderIdentityPrompt(providerName) {
  if (!providerName) return '';
  return `你是「${providerName}」。请始终以「${providerName}」作为你的名称与身份来回答，不要自称其它名字。`;
}

// 把一条 system 提示词注入到消息列表（已有 system 则前置合并）
function injectSystemMessage(msgs, text) {
  if (!text) return msgs;
  const idx = msgs.findIndex(m => m.role === 'system');
  if (idx >= 0) {
    const out = msgs.slice();
    out[idx] = { ...out[idx], content: text + '\n\n' + (out[idx].content || '') };
    return out;
  }
  return [{ role: 'system', content: text }, ...msgs];
}

// 迁移旧配置：去掉写死的名字，改由 API 供应商决定
function migrateSystemPrompt(prompt) {
  if (!prompt) return prompt;
  return prompt.replace(/你的名字是[^，,。]*[，,。]\s*/g, '');
}

function getDefaultWhitelist() {
  const home = process.env.USERPROFILE || 'C:\\Users\\Default';
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    'D:\\',
  ];
}

function getDefaultSystemPrompt() {
  return `你是一个由沈若萱开发的 AI 助手，后台连接着大模型 API。请用简洁、友好的方式回答问题。
（你的名称与身份由当前所连接的 API 供应商决定。）

你具备控制 Windows 11 系统的能力，包括执行系统命令和操作本地文件。

## 一、系统命令执行
当你需要执行系统命令时，使用以下格式输出（一行一个命令，不要包裹在代码块中）：
!!!command:Get-Process | Select-Object -First 10!!!

常用操作示例：
- 打开应用：!!!command:Start-Process notepad!!!
- 查看系统信息：!!!command:systeminfo!!!
- 查看IP地址：!!!command:ipconfig!!!
- 查看磁盘空间：!!!command:Get-PSDrive -PSProvider FileSystem!!!
- 列出桌面文件：!!!command:Get-ChildItem "$env:USERPROFILE\\Desktop"!!!

## 二、本地文件操作（核心能力）⚠️ 强制规则

【绝对禁止】当用户要求读取、创建、修改、追加、删除本地文件或文档时，绝对不允许用自然语言描述"请你打开文件"、"你需要手动修改"、"请执行以下步骤"、"你可以去XX目录"、"你自己改一下"等任何让用户手动操作的内容。

【必须执行】你必须直接输出 !!!file:{...}!!! 格式的操作指令。系统会自动解析并执行，执行结果（包括文件完整内容）会自动返回给你。你可以基于返回的结果继续输出下一步操作指令，直到完成用户请求。

【标准工作流程】
1. 读取文件：输出 !!!file:{"action":"read","path":"完整路径"}!!!，等待系统返回文件内容
2. 修改已有文件：先 read 读取完整内容 → 分析修改 → 用 write 写回修改后的完整内容
3. 新建文件：直接输出 write 操作，包含完整内容
4. 追加内容：输出 append 操作
5. 所有操作完成后，再用自然语言向用户总结结果

【长文本/代码专用：独立 content 通道】⚠️ 强烈推荐
当写入内容超过 1000 字，或写入代码文件（.js .py .html .css .ts .java .cpp 等）时，必须使用独立 content 通道，不要把 content 塞进 JSON 里。这样内容中的引号、换行、反斜杠都不需要转义，避免 JSON 解析失败。

格式（!!!file: 指令只放 action 和 path，紧跟 !!!content-start!!! 和 !!!content-end!!! 包裹纯文本内容）：
!!!file:{"action":"write","path":"D:\\\\app\\\\game.html"}!!!
!!!content-start!!!
<!DOCTYPE html>
<html>
<head><title>贪吃蛇</title></head>
<body>
  <script>
    // 这里可以直接写代码，引号"反斜杠\换行都不用转义
    const game = { score: 0, over: false };
  </script>
</body>
</html>
!!!content-end!!!

【超长文本分块写入】⚠️ 必须遵守
当写入内容超过 1500 字时，必须分块写入，不要试图一次性输出超长内容（会被截断导致写入失败）：
1. 第一块：用 write 操作创建文件，写入前 1000-1500 字
2. 后续每一块：用 append 操作追加 1000-1500 字
3. 每块都使用独立 content 通道（!!!content-start!!! ... !!!content-end!!!）
4. 系统会自动依次执行 write + 多次 append，全部完成后返回结果

分块示例（写一篇 5000 字的长文）：
第一轮输出：
!!!file:{"action":"write","path":"D:\\\\notes\\\\长文.md"}!!!
!!!content-start!!!
# 标题
第一段...（约1200字）
!!!content-end!!!

系统执行后自动返回结果，你继续第二轮输出：
!!!file:{"action":"append","path":"D:\\\\notes\\\\长文.md"}!!!
!!!content-start!!!
第二段...（约1200字）
!!!content-end!!!

继续第三轮、第四轮...直到全部内容写完，最后用自然语言总结。

格式（短内容 < 1000 字可直接用传统格式）：!!!file:{"action":"操作类型","path":"文件完整路径","content":"文件内容"}!!!

支持的操作类型：
- write：新建或覆盖文件（支持 .txt .md .docx .xlsx）
- read：读取文件内容
- append：追加内容到文件末尾
- list：列出目录内所有文件
- copy：复制文件（需 source 和 dest 参数）
- rename：重命名/移动文件（需 source 和 dest 参数）
- delete：删除文件
- open：用系统默认程序打开文件
- mkdir：创建文件夹

### 文件操作示例

1. 保存文本到 Markdown 文件：
!!!file:{"action":"write","path":"D:\\\\notes\\\\学习笔记.md","content":"# 电路交换知识点\\n\\n电路交换是通信网中最早出现的一种交换方式..."}!!!

2. 读取本地文档：
!!!file:{"action":"read","path":"C:\\\\Users\\\\shenz\\\\Desktop\\\\课表.docx"}!!!

3. 追加内容：
!!!file:{"action":"append","path":"D:\\\\notes\\\\日志.txt","content":"\\n2026-09-09 新增记录"}!!!

4. 列出目录：
!!!file:{"action":"list","path":"D:\\\\notes"}!!!

5. 复制文件：
!!!file:{"action":"copy","source":"D:\\\\a.txt","dest":"D:\\\\backup\\\\a.txt"}!!!

6. 重命名：
!!!file:{"action":"rename","source":"D:\\\\old.txt","dest":"D:\\\\new.txt"}!!!

7. 删除文件：
!!!file:{"action":"delete","path":"D:\\\\temp\\\\old.log"}!!!

8. 打开文件：
!!!file:{"action":"open","path":"D:\\\\notes\\\\报告.docx"}!!!

### 重要规则
- 路径必须使用双反斜杠 \\\\ 或正斜杠 /
- 传统格式中 content 的换行符用 \\n 表示；使用独立 content 通道时不需要任何转义
- 超过 1000 字或代码文件必须使用独立 content 通道（!!!content-start!!! ... !!!content-end!!!），不要把长内容塞进 JSON
- 超过 1500 字必须分块写入：第一块用 write，后续每块用 append，每块 1000-1500 字
- .docx 和 .xlsx 文件会自动转换为纯文本处理
- 写入文件时如果目录不存在会自动创建
- 覆盖已有文件、删除文件等高危操作会弹出确认框，需用户确认后才执行
- 只能操作用户预先授权的目录（白名单），系统目录禁止访问
- 读取文件后，文件内容会自动返回给你，直接基于内容进行分析、整理、修改，然后写回原文件或另存新文件，不要让用户手动转述文件内容
- 每次回复中可以包含多个 !!!file: 操作指令，系统会依次执行并把全部结果返回给你

## 三、安全规则
- 只执行用户明确请求的操作
- 对于危险操作（删除文件、修改注册表等），先向用户说明风险
- 不要执行任何可能损害系统的命令
- 命令和文件操作会被系统弹窗拦截，用户确认后才会执行`;
}

ipcMain.handle('config:save', (event, config) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  if (fileManager && config.fileWhitelist) {
    fileManager.setWhitelist(config.fileWhitelist);
  }
  // 刷新提供商配置
  providerManager.loadConfig(config);
  // 如果选词快捷键变更，重新注册
  if (config.quickActionShortcut && config.quickActionShortcut !== quickActionShortcutRegistered) {
    registerQuickActionShortcut(config.quickActionShortcut);
  }
  return true;
});

// ============================================================
//  IPC: 截图识别
// ============================================================
let screenshotWindow = null;
let screenCaptureDataUrl = null;

// 捕获主显示器屏幕
async function capturePrimaryScreen() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
  return primarySource.thumbnail.toDataURL();
}

// 打开截图窗口
ipcMain.handle('screenshot:start', async () => {
  if (screenshotWindow) {
    screenshotWindow.focus();
    return { success: false, error: '截图窗口已打开' };
  }

  try {
    screenCaptureDataUrl = await capturePrimaryScreen();

    screenshotWindow = new BrowserWindow({
      width: screen.getPrimaryDisplay().size.width,
      height: screen.getPrimaryDisplay().size.height,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreen: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    screenshotWindow.loadFile(path.join(__dirname, 'screenshot.html'));

    screenshotWindow.webContents.on('did-finish-load', () => {
      screenshotWindow.webContents.send('screenshot:image', screenCaptureDataUrl);
    });

    screenshotWindow.on('closed', () => {
      screenshotWindow = null;
      screenCaptureDataUrl = null;
    });

    return { success: true };
  } catch (err) {
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
    return { success: false, error: err.message };
  }
});

// 截图窗口确认选择
ipcMain.on('screenshot:confirm', async (event, rect) => {
  try {
    // 从屏幕截图中裁剪选中区域
    const img = nativeImage.createFromDataURL(screenCaptureDataUrl);
    const cropped = img.crop({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.w),
      height: Math.round(rect.h),
    });
    const croppedDataUrl = cropped.toDataURL();

    // 关闭截图窗口
    if (screenshotWindow) {
      screenshotWindow.close();
    }

    // 将截图发送到主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshot:result', croppedDataUrl);
    }
  } catch (err) {
    console.error('截图裁剪失败:', err);
    if (screenshotWindow) screenshotWindow.close();
  }
});

// 截图窗口取消
ipcMain.on('screenshot:cancel', () => {
  if (screenshotWindow) {
    screenshotWindow.close();
  }
});

// 从剪贴板读取图片
ipcMain.handle('screenshot:clipboard', async () => {
  const { clipboard } = require('electron');
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { success: false, error: '剪贴板中没有图片' };
  }
  return { success: true, dataUrl: image.toDataURL() };
});

// ============================================================
//  IPC: 选词助手（剪贴板选词快速操作）
// ============================================================
let quickWindow = null;
let quickActionAbortController = null;

// 创建选词浮窗
function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    return quickWindow;
  }

  // 获取鼠标位置，计算浮窗位置
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;

  const winWidth = 380;
  const winHeight = 480;

  // 默认在鼠标右下方，超出屏幕则调整到左侧/上方
  let x = cursorPoint.x + 10;
  let y = cursorPoint.y + 10;
  if (x + winWidth > workArea.x + workArea.width) {
    x = cursorPoint.x - winWidth - 10;
  }
  if (y + winHeight > workArea.y + workArea.height) {
    y = cursorPoint.y - winHeight - 10;
  }
  // 确保不超出工作区
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winWidth));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - winHeight));

  quickWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 360,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  quickWindow.loadFile(path.join(__dirname, 'quick.html'));
  quickWindow.on('closed', () => {
    quickWindow = null;
    if (quickActionAbortController) {
      quickActionAbortController.abort();
      quickActionAbortController = null;
    }
  });

  // 失去焦点时自动关闭（可选，先注释掉，用户可能需要复制结果）
  // quickWindow.on('blur', () => {
  //   if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close();
  // });

  return quickWindow;
}

// 模拟 Ctrl+C 复制选中的文本，然后读取剪贴板
async function getSelectedTextFromClipboard() {
  const { clipboard } = require('electron');

  // 保存当前剪贴板内容（用于恢复）
  const previousText = clipboard.readText();
  const previousImage = clipboard.readImage();
  const hadImage = !previousImage.isEmpty();

  try {
    // 清空剪贴板，确保能检测到新复制的内容
    clipboard.clear();

    // 模拟 Ctrl+C（用 PowerShell SendKeys）
    await new Promise((resolve) => {
      const psCmd = `powershell.exe -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"`;
      exec(psCmd, { encoding: 'utf8', timeout: 5000, windowsHide: true }, () => resolve());
    });

    // 等待剪贴板更新
    await new Promise(resolve => setTimeout(resolve, 250));

    // 读取剪贴板文本
    const text = clipboard.readText();

    if (text && text.trim()) {
      return { success: true, text: text.trim() };
    }

    return { success: false, text: '', error: '未获取到选中文本，请确保已在其他窗口中选中文字' };
  } finally {
    // 恢复原剪贴板内容（延迟一点，确保浮窗已经拿到文本）
    setTimeout(() => {
      try {
        if (hadImage) {
          clipboard.writeImage(previousImage);
        } else if (previousText) {
          clipboard.writeText(previousText);
        }
      } catch {}
    }, 500);
  }
}

// 获取选中文本（供浮窗初始化时调用）
ipcMain.handle('quickAction:getSelectedText', async () => {
  return await getSelectedTextFromClipboard();
});

// 处理 AI 请求（流式）
ipcMain.handle('quickAction:process', async (event, { messages }) => {
  const provider = providerManager.getActive();
  if (!provider) {
    return { success: false, error: '未配置 API 提供商，请先在设置中添加' };
  }

  quickActionAbortController = new AbortController();

  try {
    const fullText = await provider.stream(
      messages,
      { temperature: 0.3, maxTokens: 1024 },
      (delta) => {
        if (quickWindow && !quickWindow.isDestroyed()) {
          quickWindow.webContents.send('quickAction:chunk', { content: delta });
        }
      }
    );

    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.webContents.send('quickAction:chunk', { done: true });
    }
    return { success: true, text: fullText };
  } catch (err) {
    if (err.name === 'AbortError') {
      if (quickWindow && !quickWindow.isDestroyed()) {
        quickWindow.webContents.send('quickAction:chunk', { done: true, aborted: true });
      }
      return { success: true, aborted: true };
    }
    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.webContents.send('quickAction:chunk', { error: err.message });
    }
    return { success: false, error: err.message };
  } finally {
    quickActionAbortController = null;
  }
});

// 停止生成
ipcMain.handle('quickAction:abort', () => {
  if (quickActionAbortController) {
    quickActionAbortController.abort();
    return { success: true };
  }
  const provider = providerManager.getActive();
  if (provider) provider.abort();
  return { success: true };
});

// 关闭浮窗
ipcMain.on('quickAction:close', () => {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.close();
  }
});

// ============================================================
//  IPC: Windows 系统命令执行
// ============================================================
ipcMain.handle('win:exec', async (event, { command }) => {
  return new Promise((resolve) => {
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const psCommand = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    exec(psCommand, { encoding: 'utf8', timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: stderr || error.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
});

ipcMain.handle('win:confirm', async (event, { command }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['执行', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '命令执行确认',
    message: 'BOT 请求执行以下系统命令：',
    detail: command,
    noLink: true,
  });
  return result.response === 0;
});

// ============================================================
//  文件操作 IPC 通道
// ============================================================
function ensureFileManager() {
  if (!fileManager) {
    fileManager = new FileManager({
      whitelist: getDefaultWhitelist(),
      autoOpen: true,
      onLog: (entry) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:log', entry);
        }
      },
    });
  }
  return fileManager;
}

ipcMain.handle('file:execute', async (event, { action, params }) => {
  const fm = ensureFileManager();
  return fm.execute(action, params);
});

ipcMain.handle('file:read', async (event, { path: filePath }) => {
  const fm = ensureFileManager();
  return fm.execute('read', { path: filePath });
});

ipcMain.handle('file:write', async (event, { path: filePath, content }) => {
  const fm = ensureFileManager();
  return fm.execute('write', { path: filePath, content });
});

ipcMain.handle('file:append', async (event, { path: filePath, content }) => {
  const fm = ensureFileManager();
  return fm.execute('append', { path: filePath, content });
});

ipcMain.handle('file:list', async (event, { path: dirPath }) => {
  const fm = ensureFileManager();
  return fm.execute('list', { path: dirPath });
});

ipcMain.handle('file:copy', async (event, { source, dest }) => {
  const fm = ensureFileManager();
  return fm.execute('copy', { source, dest });
});

ipcMain.handle('file:rename', async (event, { source, dest }) => {
  const fm = ensureFileManager();
  return fm.execute('rename', { source, dest });
});

ipcMain.handle('file:delete', async (event, { path: filePath }) => {
  const fm = ensureFileManager();
  return fm.execute('delete', { path: filePath });
});

ipcMain.handle('file:open', async (event, { path: filePath }) => {
  const fm = ensureFileManager();
  return fm.execute('open', { path: filePath });
});

ipcMain.handle('file:mkdir', async (event, { path: dirPath }) => {
  const fm = ensureFileManager();
  return fm.execute('mkdir', { path: dirPath });
});

ipcMain.handle('file:checkRisk', async (event, { action, params }) => {
  const fm = ensureFileManager();
  return fm.detectHighRisk(action, params);
});

ipcMain.handle('file:checkPath', async (event, { path: filePath }) => {
  const fm = ensureFileManager();
  const allowed = fm.isPathAllowed(filePath);
  const isSystem = fm.isSystemPath(filePath);
  return { ...allowed, isSystemPath: isSystem };
});

ipcMain.handle('file:confirm', async (event, { action, params, reasons }) => {
  const detailLines = [];
  if (params.path) detailLines.push(`路径：${params.path}`);
  if (params.source) detailLines.push(`源：${params.source}`);
  if (params.dest) detailLines.push(`目标：${params.dest}`);
  if (reasons && reasons.length) {
    detailLines.push('', '风险提示：');
    reasons.forEach((r, i) => detailLines.push(`${i + 1}. ${r}`));
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['确认执行', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '文件操作确认',
    message: `BOT 请求执行文件操作：${action}`,
    detail: detailLines.join('\n'),
    noLink: true,
  });
  return result.response === 0;
});

ipcMain.handle('file:whitelist:get', async () => {
  const fm = ensureFileManager();
  return fm.whitelist;
});

ipcMain.handle('file:whitelist:set', async (event, { dirs }) => {
  const fm = ensureFileManager();
  fm.setWhitelist(dirs);
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.fileWhitelist = dirs;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch {}
  return fm.whitelist;
});

ipcMain.handle('file:logs', async () => {
  const fm = ensureFileManager();
  return fm.getLogs();
});

// ============================================================
//  语音输入(STT) IPC 通道
// ============================================================
let localSTTConfig = {
  enabled: false,
  engine: 'vosk',
  modelPath: '',
  sampleRate: 16000,
};

ipcMain.handle('voice:localSTTAvailable', async () => {
  return {
    available: localSTTConfig.enabled && !!localSTTConfig.modelPath,
    engine: localSTTConfig.engine,
    message: localSTTConfig.enabled
      ? (localSTTConfig.modelPath ? '本地 STT 已配置' : '未设置模型路径')
      : '本地 STT 未启用，当前使用 Web Speech API',
  };
});

ipcMain.handle('voice:speechToText', async (event, { audioData, format }) => {
  if (!localSTTConfig.enabled || !localSTTConfig.modelPath) {
    return {
      success: false,
      text: '',
      error: '本地 STT 未启用，请在设置中配置本地语音识别引擎',
    };
  }
  return {
    success: false,
    text: '',
    error: '本地 STT 引擎待接入',
  };
});

ipcMain.handle('voice:setLocalSTTConfig', async (event, config) => {
  localSTTConfig = { ...localSTTConfig, ...config };
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.localSTT = localSTTConfig;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch {}
  return { success: true, config: localSTTConfig };
});

ipcMain.handle('voice:getLocalSTTConfig', async () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (cfg.localSTT) {
      localSTTConfig = { ...localSTTConfig, ...cfg.localSTT };
    }
  } catch {}
  return localSTTConfig;
});

// ============================================================
//  自动更新（electron-updater）
// ============================================================
let updateState = {
  status: 'idle',       // idle | checking | available | downloading | downloaded | error | uptodate
  version: null,
  releaseNotes: null,
  downloadProgress: 0,
  error: null,
};

function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:state', updateState);
  }
}

autoUpdater.autoDownload = false;       // 不自动下载，先通知用户
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装已下载的更新

autoUpdater.on('checking-for-update', () => {
  updateState = { ...updateState, status: 'checking', error: null };
  sendUpdateState();
});

autoUpdater.on('update-available', (info) => {
  updateState = {
    status: 'available',
    version: info.version,
    releaseNotes: info.releaseNotes || null,
    downloadProgress: 0,
    error: null,
  };
  sendUpdateState();
});

autoUpdater.on('update-not-available', () => {
  updateState = { ...updateState, status: 'uptodate', error: null };
  sendUpdateState();
});

autoUpdater.on('download-progress', (progress) => {
  updateState = {
    ...updateState,
    status: 'downloading',
    downloadProgress: Math.round(progress.percent),
  };
  sendUpdateState();
});

autoUpdater.on('update-downloaded', () => {
  updateState = { ...updateState, status: 'downloaded', downloadProgress: 100 };
  sendUpdateState();
});

autoUpdater.on('error', (err) => {
  updateState = {
    ...updateState,
    status: 'error',
    error: err.message || String(err),
  };
  sendUpdateState();
});

ipcMain.handle('update:check', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
  return { success: true };
});

ipcMain.handle('update:getState', () => updateState);

// ============================================================
//  应用启动
// ============================================================

// 注册选词助手全局快捷键
let quickActionShortcutRegistered = null;
function registerQuickActionShortcut(accelerator) {
  if (!accelerator) return;
  try {
    if (quickActionShortcutRegistered) {
      globalShortcut.unregister(quickActionShortcutRegistered);
    }
    const success = globalShortcut.register(accelerator, () => {
      createQuickWindow();
    });
    if (success) {
      quickActionShortcutRegistered = accelerator;
      console.log(`选词助手快捷键已注册: ${accelerator}`);
    } else {
      console.warn(`选词助手快捷键注册失败（可能被占用）: ${accelerator}`);
    }
  } catch (err) {
    console.error('注册选词助手快捷键失败:', err.message);
  }
}

app.whenReady().then(() => {
  ensureConversationsDir();
  ensureMainConversation();
  createMainWindow();
  createTray();

  // 加载配置并注册选词助手快捷键 + 初始化长期记忆
  try {
    const cfg = loadConfigSafe();
    const shortcut = cfg.quickActionShortcut || 'Control+Alt+Q';
    registerQuickActionShortcut(shortcut);
    initMemoryStore(cfg).catch((e) => console.error('[memory] 初始化失败:', e.message));
  } catch {
    // 配置文件不存在时使用默认快捷键
    registerQuickActionShortcut('Control+Alt+Q');
  }

  // 启动 3 秒后自动检查更新（不阻塞 UI）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
});

app.on('window-all-closed', () => {
  // 不调用 app.quit()，程序继续在系统托盘运行
});

// 应用退出时注销所有全局快捷键，并把长期记忆落盘
app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  if (memoryStore) {
    try { await memoryStore.flush(); } catch (e) { console.error('[memory] 落盘失败:', e.message); }
  }
});
