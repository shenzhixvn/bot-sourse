const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口控制
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  maximize: () => ipcRenderer.send('win:maximize'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximized: (cb) => {
    const handler = (_event, isMax) => cb(isMax);
    ipcRenderer.on('win:maximized', handler);
    return () => ipcRenderer.removeListener('win:maximized', handler);
  },
  // 窗口置顶
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),

  // 全局快捷键
  registerShortcut: (accelerator) => ipcRenderer.invoke('shortcut:register', accelerator),
  unregisterShortcut: (accelerator) => ipcRenderer.invoke('shortcut:unregister', accelerator),
  unregisterAllShortcuts: () => ipcRenderer.invoke('shortcut:unregister-all'),

  // 导出对话
  exportMarkdown: (content, defaultName) => ipcRenderer.invoke('export:markdown', { content, defaultName }),

  // 标签页事件（来自托盘/主进程）
  onTabNew: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('tab:new', handler);
    return () => ipcRenderer.removeListener('tab:new', handler);
  },
  onTabOpen: (cb) => {
    const handler = (_event, conversationId) => cb(conversationId);
    ipcRenderer.on('tab:open', handler);
    return () => ipcRenderer.removeListener('tab:open', handler);
  },

  // 聊天 API（流式）
  chat: (messages, config) => ipcRenderer.invoke('api:chat', { messages, config }),
  abort: () => ipcRenderer.invoke('api:abort'),
  onChunk: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('api:chunk', handler);
    return () => ipcRenderer.removeListener('api:chunk', handler);
  },

  // 配置
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // Windows 系统控制
  winExec: (command) => ipcRenderer.invoke('win:exec', { command }),
  winConfirm: (command) => ipcRenderer.invoke('win:confirm', { command }),

  // ============================================================
  //  会话管理 API
  // ============================================================
  conv: {
    // 获取会话列表
    list: () => ipcRenderer.invoke('conv:list'),
    // 创建新会话并打开窗口
    create: (title) => ipcRenderer.invoke('conv:create', title),
    // 打开指定会话窗口
    open: (conversationId) => ipcRenderer.invoke('conv:open', conversationId),
    // 删除会话
    delete: (conversationId) => ipcRenderer.invoke('conv:delete', conversationId),
    // 重命名会话
    rename: (conversationId, title) => ipcRenderer.invoke('conv:rename', { conversationId, title }),
    // 设置会话角色
    setAgent: (conversationId, agentId) => ipcRenderer.invoke('conv:setAgent', { conversationId, agentId }),
    // 切换会话置顶
    togglePin: (conversationId) => ipcRenderer.invoke('conv:togglePin', conversationId),
    // 加载会话消息
    loadMessages: (conversationId) => ipcRenderer.invoke('conv:loadMessages', conversationId),
    // 保存会话消息
    saveMessages: (conversationId, messages) => ipcRenderer.invoke('conv:saveMessages', { conversationId, messages }),
    // 显示会话管理器窗口
    showManager: () => ipcRenderer.invoke('conv:showManager'),
    // 监听会话列表更新
    onListUpdated: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('conv:list-updated', handler);
      return () => ipcRenderer.removeListener('conv:list-updated', handler);
    },
  },

  // ============================================================
  //  文件操作 API
  // ============================================================
  file: {
    // 统一执行入口
    execute: (action, params) => ipcRenderer.invoke('file:execute', { action, params }),

    // 具体操作
    read: (filePath) => ipcRenderer.invoke('file:read', { path: filePath }),
    write: (filePath, content) => ipcRenderer.invoke('file:write', { path: filePath, content }),
    append: (filePath, content) => ipcRenderer.invoke('file:append', { path: filePath, content }),
    list: (dirPath) => ipcRenderer.invoke('file:list', { path: dirPath }),
    copy: (source, dest) => ipcRenderer.invoke('file:copy', { source, dest }),
    rename: (source, dest) => ipcRenderer.invoke('file:rename', { source, dest }),
    delete: (filePath) => ipcRenderer.invoke('file:delete', { path: filePath }),
    open: (filePath) => ipcRenderer.invoke('file:open', { path: filePath }),
    mkdir: (dirPath) => ipcRenderer.invoke('file:mkdir', { path: dirPath }),

    // 安全校验
    checkRisk: (action, params) => ipcRenderer.invoke('file:checkRisk', { action, params }),
    checkPath: (filePath) => ipcRenderer.invoke('file:checkPath', { path: filePath }),
    confirm: (action, params, reasons) => ipcRenderer.invoke('file:confirm', { action, params, reasons }),

    // 白名单管理
    getWhitelist: () => ipcRenderer.invoke('file:whitelist:get'),
    setWhitelist: (dirs) => ipcRenderer.invoke('file:whitelist:set', { dirs }),

    // 日志
    getLogs: () => ipcRenderer.invoke('file:logs'),
    onLog: (cb) => {
      const handler = (_event, entry) => cb(entry);
      ipcRenderer.on('file:log', handler);
      return () => ipcRenderer.removeListener('file:log', handler);
    },
  },

  // ============================================================
  //  语音输入(STT) API
  // ============================================================
  voice: {
    // 本地 STT 状态
    localSTTAvailable: () => ipcRenderer.invoke('voice:localSTTAvailable'),
    speechToText: (audioData, format) => ipcRenderer.invoke('voice:speechToText', { audioData, format }),
    getLocalSTTConfig: () => ipcRenderer.invoke('voice:getLocalSTTConfig'),
    setLocalSTTConfig: (config) => ipcRenderer.invoke('voice:setLocalSTTConfig', config),
  },

  // ============================================================
  //  自动更新 API
  // ============================================================
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getState: () => ipcRenderer.invoke('update:getState'),
    onStateChange: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    },
  },

  // ============================================================
  //  本地长期记忆（方案 A：嵌入式向量存储）
  // ============================================================
  memory: {
    stats: () => ipcRenderer.invoke('memory:stats'),
    search: (query, opts) => ipcRenderer.invoke('memory:search', { query, ...(opts || {}) }),
    list: (opts) => ipcRenderer.invoke('memory:list', opts || {}),
    add: (text, meta) => ipcRenderer.invoke('memory:add', { text, meta }),
    remove: (id) => ipcRenderer.invoke('memory:remove', { id }),
    clear: () => ipcRenderer.invoke('memory:clear'),
    reconfigure: () => ipcRenderer.invoke('memory:reconfigure'),
  },

  // ============================================================
  //  多 API 提供商管理
  // ============================================================
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    getActive: () => ipcRenderer.invoke('provider:getActive'),
    save: (config) => ipcRenderer.invoke('provider:save', config),
    remove: (id) => ipcRenderer.invoke('provider:remove', id),
    setActive: (id) => ipcRenderer.invoke('provider:setActive', id),
    test: (id) => ipcRenderer.invoke('provider:test', id),
  },

  // ============================================================
  //  截图识别
  // ============================================================
  screenshot: {
    start: () => ipcRenderer.invoke('screenshot:start'),
    clipboard: () => ipcRenderer.invoke('screenshot:clipboard'),
    onResult: (cb) => {
      const handler = (_event, dataUrl) => cb(dataUrl);
      ipcRenderer.on('screenshot:result', handler);
      return () => ipcRenderer.removeListener('screenshot:result', handler);
    },
  },

  // ============================================================
  //  角色/智能体管理
  // ============================================================
  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    save: (agent) => ipcRenderer.invoke('agent:save', agent),
    remove: (id) => ipcRenderer.invoke('agent:remove', id),
  },

  // ============================================================
  //  选词助手（剪贴板选词快速操作）
  // ============================================================
  quickAction: {
    getSelectedText: () => ipcRenderer.invoke('quickAction:getSelectedText'),
    process: (params) => ipcRenderer.invoke('quickAction:process', params),
    abort: () => ipcRenderer.invoke('quickAction:abort'),
    close: () => ipcRenderer.send('quickAction:close'),
    onChunk: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on('quickAction:chunk', handler);
      return () => ipcRenderer.removeListener('quickAction:chunk', handler);
    },
  },
});
