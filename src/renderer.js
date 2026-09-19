// ========================================
// BOT — 渲染进程（左侧边栏会话管理）
// 主题切换 · 语音输入 · 流式聊天 · 主会话/子会话
// ========================================

const $ = (sel) => document.querySelector(sel);

// DOM 元素
const chatArea = $('#chat-area');
const input = $('#input');
const btnSend = $('#btn-send');
const btnMic = $('#btn-mic');
const btnTheme = $('#btn-theme');
const btnSettings = $('#btn-settings');
const settingsPanel = $('#settings-panel');
const btnSaveCfg = $('#btn-save-cfg');
const btnCancelCfg = $('#btn-cancel-cfg');
const btnMinimize = $('#btn-minimize');
const btnMaximize = $('#btn-maximize');
const btnClose = $('#btn-close');
const btnNewConv = $('#btn-new-conv');
const convListPinned = $('#conv-list-pinned');
const convListRecent = $('#conv-list-recent');

// 更新横幅元素
const updateBanner = $('#update-banner');
const updateBannerIcon = $('#update-banner-icon');
const updateBannerText = $('#update-banner-text');
const updateBannerProgress = $('#update-banner-progress');
const updateBannerProgressBar = $('#update-banner-progress-bar');
const updateBtnAction = $('#update-btn-action');
const updateBtnClose = $('#update-btn-close');

// 提供商管理元素
const providerList = $('#provider-list');
const btnAddProvider = $('#btn-add-provider');
const providerEditForm = $('#provider-edit-form');
const providerEditTitle = $('#provider-edit-title');
const providerEditId = $('#provider-edit-id');
const providerEditName = $('#provider-edit-name');
const providerEditType = $('#provider-edit-type');
const providerEditBaseUrl = $('#provider-edit-baseurl');
const providerEditApiKey = $('#provider-edit-apikey');
const providerEditModel = $('#provider-edit-model');
const providerEditMaxTokens = $('#provider-edit-maxtokens');
const providerEditSave = $('#provider-edit-save');
const providerEditTest = $('#provider-edit-test');
const providerEditCancel = $('#provider-edit-cancel');
const providerTestResult = $('#provider-test-result');

// 上传 & 附件元素
const btnUploadFile = $('#btn-upload-file');
const btnUploadImage = $('#btn-upload-image');
const btnScreenshot = $('#btn-screenshot');
const fileInput = $('#file-input');
const imageInput = $('#image-input');
const attachmentPreview = $('#attachment-preview');

// 附件状态：{ id, type: 'file'|'image', name, size, dataUrl, content?, mimeType }
let attachments = [];

// 角色/智能体状态
let agents = [];
let currentAgentId = null;
const agentSelector = $('#agent-selector');
const agentAvatar = $('#agent-avatar');
const agentName = $('#agent-name');
const agentDropdown = $('#agent-dropdown');
const agentList = $('#agent-list');
const btnAddAgent = $('#btn-add-agent');
const agentEditForm = $('#agent-edit-form');
const agentEditTitle = $('#agent-edit-title');
const agentEditId = $('#agent-edit-id');
const agentEditName = $('#agent-edit-name');
const agentEditAvatar = $('#agent-edit-avatar');
const agentEditPrompt = $('#agent-edit-prompt');
const agentEditModel = $('#agent-edit-model');
const agentEditTemperature = $('#agent-edit-temperature');
const agentEditToolFile = $('#agent-edit-tool-file');
const agentEditToolCommand = $('#agent-edit-tool-command');
const agentEditToolScreenshot = $('#agent-edit-tool-screenshot');
const agentEditSave = $('#agent-edit-save');
const agentEditCancel = $('#agent-edit-cancel');

// 主会话固定 ID
const MAIN_CONVERSATION_ID = 'main';

// 状态
let config = {};
let conversations = [];       // 会话元数据列表
let currentConversationId = null;
let messages = [];            // 当前会话消息
let isStreaming = false;
let agentLoopRunning = false;
let removeChunkListener = null;
let saveTimer = null;
let userAborted = false;  // 用户手动停止标记

// 唤醒词状态
let wakeWordManager = null;
let wakeWordActive = false;   // 唤醒词监听是否已启动

// 声纹识别状态
let voiceprintManager = null;
let voiceprintRecordings = [];  // 注册用的录音 Blob 数组
let voiceprintIsRecording = false;

// 保存发送按钮原始 HTML，用于停止/发送状态切换
const SEND_BTN_ORIGINAL_HTML = btnSend ? btnSend.innerHTML : '';

// 切换发送按钮状态：生成中显示停止按钮，空闲时显示发送按钮
function setSendButtonState(streaming) {
  if (!btnSend) return;
  if (streaming) {
    btnSend.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    btnSend.title = '停止生成';
    btnSend.style.background = 'var(--red)';
  } else {
    btnSend.innerHTML = SEND_BTN_ORIGINAL_HTML;
    btnSend.title = '发送';
    btnSend.style.background = '';
  }
}

// 手动停止当前生成
function stopGeneration() {
  userAborted = true;
  window.api.abort();
}

// ========================================
// 自动更新横幅
// ========================================
let currentUpdateState = null;

function showUpdateBanner() {
  if (updateBanner) updateBanner.classList.remove('hidden');
}

function hideUpdateBanner() {
  if (updateBanner) updateBanner.classList.add('hidden');
}

function handleUpdateState(state) {
  currentUpdateState = state;
  if (!updateBanner) return;

  switch (state.status) {
    case 'available':
      updateBannerIcon.textContent = '🚀';
      updateBannerText.textContent = `发现新版本 v${state.version}，点击更新`;
      if (updateBannerProgress) updateBannerProgress.classList.add('hidden');
      updateBtnAction.textContent = '立即更新';
      updateBtnAction.style.display = '';
      showUpdateBanner();
      break;

    case 'downloading':
      updateBannerIcon.textContent = '⬇️';
      updateBannerText.textContent = `正在下载 v${state.version}...`;
      if (updateBannerProgress) {
        updateBannerProgress.classList.remove('hidden');
        if (updateBannerProgressBar) {
          updateBannerProgressBar.style.width = state.downloadProgress + '%';
        }
      }
      updateBtnAction.style.display = 'none';
      showUpdateBanner();
      break;

    case 'downloaded':
      updateBannerIcon.textContent = '✅';
      updateBannerText.textContent = `v${state.version} 下载完成，重启安装`;
      if (updateBannerProgress) updateBannerProgress.classList.add('hidden');
      updateBtnAction.textContent = '重启安装';
      updateBtnAction.style.display = '';
      showUpdateBanner();
      break;

    case 'error':
      updateBannerIcon.textContent = '⚠️';
      updateBannerText.textContent = `更新失败：${state.error || '未知错误'}`;
      if (updateBannerProgress) updateBannerProgress.classList.add('hidden');
      updateBtnAction.textContent = '重试';
      updateBtnAction.style.display = '';
      showUpdateBanner();
      break;

    case 'checking':
      // 检查中不显示横幅，静默处理
      break;

    case 'uptodate':
    case 'idle':
    default:
      hideUpdateBanner();
      break;
  }
}

function initUpdateBanner() {
  if (!updateBanner) return;

  // 监听更新状态变化
  if (window.api.update && window.api.update.onStateChange) {
    window.api.update.onStateChange(handleUpdateState);
  }

  // 操作按钮
  if (updateBtnAction) {
    updateBtnAction.addEventListener('click', async () => {
      if (!currentUpdateState) return;
      try {
        if (currentUpdateState.status === 'available' || currentUpdateState.status === 'error') {
          await window.api.update.download();
        } else if (currentUpdateState.status === 'downloaded') {
          await window.api.update.install();
        }
      } catch (err) {
        console.error('更新操作失败:', err);
      }
    });
  }

  // 关闭按钮
  if (updateBtnClose) {
    updateBtnClose.addEventListener('click', hideUpdateBanner);
  }

  // 获取初始状态
  if (window.api.update && window.api.update.getState) {
    window.api.update.getState().then(handleUpdateState).catch(() => {});
  }

  // 设置面板中的检查更新按钮
  const btnCheckUpdate = $('#btn-check-update');
  const updateCheckResult = $('#update-check-result');
  if (btnCheckUpdate && window.api.update) {
    btnCheckUpdate.addEventListener('click', async () => {
      btnCheckUpdate.disabled = true;
      btnCheckUpdate.textContent = '⏳ 检查中...';
      if (updateCheckResult) updateCheckResult.textContent = '';

      try {
        await window.api.update.check();
        // 状态会通过 onStateChange 回调更新
        setTimeout(() => {
          if (currentUpdateState) {
            if (currentUpdateState.status === 'uptodate' || currentUpdateState.status === 'idle') {
              if (updateCheckResult) {
                updateCheckResult.textContent = '✅ 当前已是最新版本';
                updateCheckResult.style.color = '#22c55e';
              }
            } else if (currentUpdateState.status === 'available') {
              if (updateCheckResult) {
                updateCheckResult.textContent = `🚀 发现新版本 v${currentUpdateState.version}，顶部横幅可更新`;
                updateCheckResult.style.color = 'var(--accent)';
              }
            } else if (currentUpdateState.status === 'error') {
              if (updateCheckResult) {
                updateCheckResult.textContent = `⚠️ 检查失败：${currentUpdateState.error}`;
                updateCheckResult.style.color = '#ef4444';
              }
            }
          }
          btnCheckUpdate.disabled = false;
          btnCheckUpdate.textContent = '🔍 检查更新';
        }, 2000);
      } catch (err) {
        if (updateCheckResult) {
          updateCheckResult.textContent = `⚠️ 检查失败：${err.message}`;
          updateCheckResult.style.color = '#ef4444';
        }
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.textContent = '🔍 检查更新';
      }
    });
  }
}

// ========================================
// API 提供商管理
// ========================================
let providers = [];
let activeProviderId = null;

async function loadProviders() {
  if (!window.api.provider) return;
  try {
    providers = await window.api.provider.list();
    const active = await window.api.provider.getActive();
    activeProviderId = active ? active.id : null;
    renderProviderList();
  } catch (err) {
    console.error('加载提供商列表失败:', err);
  }
}

function renderProviderList() {
  if (!providerList) return;
  providerList.innerHTML = providers.map(p => `
    <div class="provider-item ${p.id === activeProviderId ? 'active' : ''}" data-id="${p.id}">
      <div class="provider-item-info">
        ${p.id === activeProviderId ? '<span class="provider-item-badge">当前</span>' : ''}
        <span class="provider-item-name">${escapeHtml(p.name)}</span>
        <span class="provider-item-model">${escapeHtml(p.model || '')}</span>
      </div>
      <div class="provider-item-actions">
        ${p.id !== activeProviderId ? `<button class="provider-item-btn set-active" onclick="setActiveProvider('${p.id}')">启用</button>` : ''}
        <button class="provider-item-btn" onclick="editProvider('${p.id}')">编辑</button>
        ${providers.length > 1 ? `<button class="provider-item-btn" onclick="deleteProvider('${p.id}')">删除</button>` : ''}
      </div>
    </div>
  `).join('');
}

function showProviderEditForm(provider) {
  if (!providerEditForm) return;
  providerEditForm.classList.remove('hidden');
  providerTestResult.className = 'provider-test-result';
  providerTestResult.textContent = '';

  if (provider) {
    providerEditTitle.textContent = '编辑提供商';
    providerEditId.value = provider.id;
    providerEditName.value = provider.name || '';
    providerEditType.value = provider.type || 'openai-compatible';
    providerEditBaseUrl.value = provider.baseUrl || '';
    providerEditApiKey.value = provider.apiKey || '';
    providerEditModel.value = provider.model || '';
    providerEditMaxTokens.value = provider.maxTokens || 2048;
  } else {
    providerEditTitle.textContent = '添加提供商';
    providerEditId.value = '';
    providerEditName.value = '';
    providerEditType.value = 'openai-compatible';
    providerEditBaseUrl.value = '';
    providerEditApiKey.value = '';
    providerEditModel.value = '';
    providerEditMaxTokens.value = 2048;
  }
}

function hideProviderEditForm() {
  if (providerEditForm) providerEditForm.classList.add('hidden');
}

async function saveProvider() {
  if (!window.api.provider) return;
  const data = {
    id: providerEditId.value || undefined,
    name: providerEditName.value.trim(),
    type: providerEditType.value,
    baseUrl: providerEditBaseUrl.value.trim(),
    apiKey: providerEditApiKey.value,
    model: providerEditModel.value.trim(),
    maxTokens: parseInt(providerEditMaxTokens.value) || 2048,
  };
  if (!data.name) { alert('请输入提供商名称'); return; }
  try {
    await window.api.provider.save(data);
    await loadProviders();
    hideProviderEditForm();
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

async function setActiveProvider(id) {
  if (!window.api.provider) return;
  try {
    await window.api.provider.setActive(id);
    await loadProviders();
  } catch (err) {
    alert('切换失败: ' + err.message);
  }
}

async function deleteProvider(id) {
  if (!window.api.provider) return;
  if (!confirm('确定删除此提供商？')) return;
  try {
    await window.api.provider.remove(id);
    await loadProviders();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

function editProvider(id) {
  const p = providers.find(x => x.id === id);
  if (p) showProviderEditForm(p);
}

async function testProvider() {
  if (!window.api.provider || !providerTestResult) return;
  const id = providerEditId.value;
  if (!id) {
    // 新增的提供商先保存再测试
    await saveProvider();
    return;
  }
  providerTestResult.className = 'provider-test-result';
  providerTestResult.textContent = '正在测试连接...';
  try {
    const result = await window.api.provider.test(id);
    if (result.success) {
      providerTestResult.className = 'provider-test-result success';
      providerTestResult.textContent = '✅ 连接成功';
    } else {
      providerTestResult.className = 'provider-test-result error';
      providerTestResult.textContent = '❌ 连接失败: ' + (result.error || '未知错误');
    }
  } catch (err) {
    providerTestResult.className = 'provider-test-result error';
    providerTestResult.textContent = '❌ 测试异常: ' + err.message;
  }
}

function initProviderManager() {
  if (!btnAddProvider) return;
  btnAddProvider.addEventListener('click', () => showProviderEditForm(null));
  if (providerEditSave) providerEditSave.addEventListener('click', saveProvider);
  if (providerEditCancel) providerEditCancel.addEventListener('click', hideProviderEditForm);
  if (providerEditTest) providerEditTest.addEventListener('click', testProvider);
  loadProviders();
}

// ========================================
// 文件/图片上传 & 附件管理
// ========================================

// 文件类型图标映射
const FILE_ICONS = {
  txt: '📄', md: '📝', doc: '📘', docx: '📘', pdf: '📕',
  xls: '📗', xlsx: '📗', csv: '📊', ppt: '📙', pptx: '📙',
  js: '📜', ts: '📜', py: '🐍', java: '☕', cpp: '⚙️', c: '⚙️',
  html: '🌐', css: '🎨', json: '⚡', xml: '📋', yaml: '⚙️', yml: '⚙️',
  zip: '📦', rar: '📦', '7z': '📦', exe: '⚙️', msi: '⚙️',
};

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return FILE_ICONS[ext] || '📎';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 读取文件为 base64 dataURL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 读取文本文件内容
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// 判断是否为文本类文件（可读取内容作为上下文）
function isTextFile(name) {
  const textExts = ['txt','md','markdown','doc','docx','pdf','xls','xlsx','csv',
    'js','ts','jsx','tsx','py','java','cpp','c','h','cs','go','rs','php','rb','swift','kt',
    'html','htm','css','scss','less','json','xml','yaml','yml','toml','ini','cfg','conf',
    'sql','sh','bat','ps1','vue','svelte','dart','lua','r','m','ex','exs','erl','hs','scala','clj'];
  const ext = name.split('.').pop().toLowerCase();
  return textExts.includes(ext);
}

// 添加附件
async function addAttachments(fileList, type) {
  for (const file of fileList) {
    const id = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const dataUrl = await readFileAsDataURL(file);

    const attachment = {
      id,
      type, // 'file' | 'image'
      name: file.name,
      size: file.size,
      mimeType: file.type,
      dataUrl,
    };

    // 文本类文件额外读取内容，用于上下文
    if (type === 'file' && isTextFile(file.name)) {
      try {
        attachment.content = await readFileAsText(file);
      } catch {}
    }

    attachments.push(attachment);
  }
  renderAttachmentPreview();
}

// 移除附件
function removeAttachment(id) {
  attachments = attachments.filter(a => a.id !== id);
  renderAttachmentPreview();
}

// 清空附件
function clearAttachments() {
  attachments = [];
  renderAttachmentPreview();
}

// 渲染附件预览
function renderAttachmentPreview() {
  if (!attachmentPreview) return;
  if (attachments.length === 0) {
    attachmentPreview.classList.add('hidden');
    attachmentPreview.innerHTML = '';
    return;
  }
  attachmentPreview.classList.remove('hidden');
  attachmentPreview.innerHTML = attachments.map(a => {
    if (a.type === 'image') {
      return `<div class="attachment-item" data-id="${a.id}">
        <img src="${a.dataUrl}" alt="${escapeHtml(a.name)}">
        <div>
          <div class="attachment-name">${escapeHtml(a.name)}</div>
          <div class="attachment-size">${formatFileSize(a.size)}</div>
        </div>
        <button class="attachment-remove" onclick="removeAttachment('${a.id}')">×</button>
      </div>`;
    }
    return `<div class="attachment-item" data-id="${a.id}">
      <div class="attachment-icon">${getFileIcon(a.name)}</div>
      <div>
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-size">${formatFileSize(a.size)}</div>
      </div>
      <button class="attachment-remove" onclick="removeAttachment('${a.id}')">×</button>
    </div>`;
  }).join('');
}

// 构建带附件的用户消息内容
// - 图片：使用多模态 content 数组格式
// - 文件：将文本内容拼接到消息文本中
function buildUserMessageWithAttachments(text) {
  const imageAttachments = attachments.filter(a => a.type === 'image');
  const fileAttachments = attachments.filter(a => a.type === 'file' && a.content);

  // 构建文件内容上下文
  let fileContext = '';
  if (fileAttachments.length > 0) {
    fileContext = fileAttachments.map(f =>
      `【文件：${f.name}】\n${f.content}\n`
    ).join('\n');
  }

  const fullText = fileContext ? (fileContext + '\n【用户问题】\n' + text) : text;

  // 有图片时使用多模态格式
  if (imageAttachments.length > 0) {
    const content = [{ type: 'text', text: fullText || '请描述这些图片' }];
    for (const img of imageAttachments) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    }
    return { role: 'user', content };
  }

  return { role: 'user', content: fullText };
}

// 初始化上传功能
function initUpload() {
  if (btnUploadFile && fileInput) {
    btnUploadFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        addAttachments(e.target.files, 'file');
        fileInput.value = '';
      }
    });
  }
  if (btnUploadImage && imageInput) {
    btnUploadImage.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        addAttachments(e.target.files, 'image');
        imageInput.value = '';
      }
    });
  }
  // 截图按钮
  if (btnScreenshot && window.api.screenshot) {
    btnScreenshot.addEventListener('click', async () => {
      try {
        const result = await window.api.screenshot.start();
        if (!result.success && result.error) {
          console.warn('截图启动失败:', result.error);
        }
      } catch (err) {
        console.error('截图失败:', err);
      }
    });
    // 监听截图结果
    window.api.screenshot.onResult((dataUrl) => {
      // 将截图作为图片附件添加
      const id = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      attachments.push({
        id,
        type: 'image',
        name: '截图.png',
        size: 0,
        mimeType: 'image/png',
        dataUrl,
      });
      renderAttachmentPreview();
      // 自动聚焦输入框
      if (input) input.focus();
    });
  }
  // 拖拽文件到聊天区域
  if (chatArea) {
    chatArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragOverlay = $('#drag-overlay');
      if (dragOverlay) dragOverlay.classList.remove('hidden');
    });
    chatArea.addEventListener('dragleave', (e) => {
      if (e.target === chatArea) {
        const dragOverlay = $('#drag-overlay');
        if (dragOverlay) dragOverlay.classList.add('hidden');
      }
    });
    chatArea.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragOverlay = $('#drag-overlay');
      if (dragOverlay) dragOverlay.classList.add('hidden');
      if (e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        const images = files.filter(f => f.type.startsWith('image/'));
        const others = files.filter(f => !f.type.startsWith('image/'));
        if (images.length > 0) addAttachments(images, 'image');
        if (others.length > 0) addAttachments(others, 'file');
      }
    });
  }
}

// ========================================
// 角色/智能体管理
// ========================================

// 获取当前角色配置
function getCurrentAgent() {
  return agents.find(a => a.id === currentAgentId) || agents[0] || null;
}

// 加载角色列表
async function loadAgents() {
  if (!window.api.agent) return;
  try {
    agents = await window.api.agent.list();
  } catch (err) {
    console.error('加载角色列表失败:', err);
  }
}

// 更新对话顶部角色显示
function updateAgentDisplay() {
  const agent = getCurrentAgent();
  if (!agent) return;
  if (agentAvatar) agentAvatar.textContent = agent.avatar || '🤖';
  if (agentName) agentName.textContent = agent.name || '默认助手';
}

// 渲染角色下拉列表
function renderAgentDropdown() {
  if (!agentDropdown) return;
  agentDropdown.innerHTML = agents.map(a => `
    <div class="agent-dropdown-item ${a.id === currentAgentId ? 'active' : ''}" onclick="switchAgent('${a.id}')">
      <span class="agent-dropdown-avatar">${a.avatar || '🤖'}</span>
      <span class="agent-dropdown-name">${escapeHtml(a.name)}</span>
      ${a.id === currentAgentId ? '<span class="agent-dropdown-check">✓</span>' : ''}
    </div>
  `).join('');
}

// 切换当前对话的角色
async function switchAgent(agentId) {
  currentAgentId = agentId;
  updateAgentDisplay();
  if (agentDropdown) agentDropdown.classList.add('hidden');
  // 保存到会话
  if (currentConversationId && window.api.conv) {
    try {
      await window.api.conv.setAgent(currentConversationId, agentId);
    } catch (err) {
      console.error('保存会话角色失败:', err);
    }
  }
}

// 角色选择器点击事件
function initAgentSelector() {
  if (!agentSelector) return;
  agentSelector.addEventListener('click', (e) => {
    e.stopPropagation();
    if (agentDropdown) {
      renderAgentDropdown();
      agentDropdown.classList.toggle('hidden');
    }
  });
  // 点击其他地方关闭下拉
  document.addEventListener('click', () => {
    if (agentDropdown) agentDropdown.classList.add('hidden');
  });
}

// 获取当前激活的 API 供应商名称（bot 的名称/身份跟随它）
function getActiveProviderName() {
  try {
    const list = (config && config.providers) || [];
    const id = config && config.activeProvider;
    const p = list.find(x => x.id === id) || list[0];
    if (p && p.name) return p.name;
  } catch (e) {}
  return (config && config.model) || '';
}

// 获取角色的系统提示词（合并全局默认）
function getAgentSystemPrompt() {
  const agent = getCurrentAgent();
  if (!agent || !agent.systemPrompt) {
    return config.systemPrompt || '';
  }
  // 角色有独立提示词时，在全局默认基础上追加角色设定
  const base = config.systemPrompt || '';
  return base + '\n\n## 角色设定\n' + agent.systemPrompt;
}

// 检查当前角色是否允许某工具
function isToolAllowed(tool) {
  const agent = getCurrentAgent();
  if (!agent || !agent.tools) return true;
  return agent.tools[tool] !== false;
}

// 渲染设置页角色列表
function renderAgentList() {
  if (!agentList) return;
  agentList.innerHTML = agents.map(a => `
    <div class="agent-item" data-id="${a.id}">
      <div class="agent-item-info">
        <span class="agent-item-avatar">${a.avatar || '🤖'}</span>
        <div>
          <div class="agent-item-name">${escapeHtml(a.name)}</div>
          <div class="agent-item-tools">
            ${a.tools?.file ? '📁' : ''}${a.tools?.command ? '⚡' : ''}${a.tools?.screenshot ? '📷' : ''}
            ${a.temperature ? ' · 温度' + a.temperature : ''}
          </div>
        </div>
      </div>
      <div class="agent-item-actions">
        <button class="provider-item-btn" onclick="editAgent('${a.id}')">编辑</button>
        ${agents.length > 1 ? `<button class="provider-item-btn" style="color:var(--red)" onclick="deleteAgent('${a.id}')">删除</button>` : ''}
      </div>
    </div>
  `).join('');
}

// 显示角色编辑表单
function showAgentEditForm(agent) {
  if (!agentEditForm) return;
  agentEditForm.classList.remove('hidden');
  if (agent) {
    agentEditTitle.textContent = '编辑角色';
    agentEditId.value = agent.id;
    agentEditName.value = agent.name || '';
    agentEditAvatar.value = agent.avatar || '🤖';
    agentEditPrompt.value = agent.systemPrompt || '';
    agentEditModel.value = agent.model || '';
    agentEditTemperature.value = agent.temperature || 0.7;
    agentEditToolFile.checked = agent.tools?.file !== false;
    agentEditToolCommand.checked = agent.tools?.command !== false;
    agentEditToolScreenshot.checked = agent.tools?.screenshot !== false;
  } else {
    agentEditTitle.textContent = '添加角色';
    agentEditId.value = '';
    agentEditName.value = '';
    agentEditAvatar.value = '🤖';
    agentEditPrompt.value = '';
    agentEditModel.value = '';
    agentEditTemperature.value = 0.7;
    agentEditToolFile.checked = true;
    agentEditToolCommand.checked = true;
    agentEditToolScreenshot.checked = true;
  }
}

function hideAgentEditForm() {
  if (agentEditForm) agentEditForm.classList.add('hidden');
}

async function saveAgent() {
  if (!window.api.agent) return;
  const data = {
    id: agentEditId.value || undefined,
    name: agentEditName.value.trim(),
    avatar: agentEditAvatar.value.trim() || '🤖',
    systemPrompt: agentEditPrompt.value,
    model: agentEditModel.value.trim(),
    temperature: parseFloat(agentEditTemperature.value) || 0.7,
    tools: {
      file: agentEditToolFile.checked,
      command: agentEditToolCommand.checked,
      screenshot: agentEditToolScreenshot.checked,
    },
  };
  if (!data.name) { alert('请输入角色名称'); return; }
  try {
    await window.api.agent.save(data);
    await loadAgents();
    renderAgentList();
    updateAgentDisplay();
    hideAgentEditForm();
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

function editAgent(id) {
  const agent = agents.find(a => a.id === id);
  if (agent) showAgentEditForm(agent);
}

async function deleteAgent(id) {
  if (!window.api.agent) return;
  if (!confirm('确定删除此角色？')) return;
  try {
    const result = await window.api.agent.remove(id);
    if (result.success) {
      await loadAgents();
      renderAgentList();
      if (currentAgentId === id) {
        currentAgentId = agents[0]?.id || null;
        updateAgentDisplay();
      }
    } else {
      alert(result.error || '删除失败');
    }
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

function initAgentManager() {
  if (btnAddAgent) btnAddAgent.addEventListener('click', () => showAgentEditForm(null));
  if (agentEditSave) agentEditSave.addEventListener('click', saveAgent);
  if (agentEditCancel) agentEditCancel.addEventListener('click', hideAgentEditForm);
  initAgentSelector();
}

// ========================================
// 会话管理
// ========================================

// 渲染侧边栏会话列表
function renderSidebar() {
  // 主会话（置顶）
  const mainConv = conversations.find(c => c.id === MAIN_CONVERSATION_ID);
  if (mainConv) {
    convListPinned.innerHTML = renderConversationItem(mainConv, true);
  } else {
    convListPinned.innerHTML = '';
  }

  // 子会话（最近）
  const subConvs = conversations.filter(c => c.id !== MAIN_CONVERSATION_ID);
  if (subConvs.length > 0) {
    convListRecent.innerHTML = subConvs.map(c => renderConversationItem(c, false)).join('');
  } else {
    convListRecent.innerHTML = '<div class="conv-empty">暂无对话</div>';
  }

  // 绑定点击事件
  document.querySelectorAll('.conv-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.conv-delete') || e.target.closest('.conv-clear') ||
          e.target.closest('.conv-rename') || e.target.closest('.conv-pin') ||
          e.target.closest('.conv-title-input')) return;
      const id = item.dataset.id;
      switchConversation(id);
    });
  });

  // 绑定删除事件（仅子会话）
  document.querySelectorAll('.conv-item:not(.is-main) .conv-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const confirmed = confirm('确定要删除这个对话吗？此操作不可撤销。');
      if (confirmed) {
        const success = await window.api.conv.delete(id);
        if (success) {
          // 如果删除的是当前会话，切换到主会话
          if (currentConversationId === id) {
            await switchConversation(MAIN_CONVERSATION_ID);
          }
          await loadConversations();
        }
      }
    });
  });

  // 绑定清空事件（主会话）
  document.querySelectorAll('.conv-item.is-main .conv-clear').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const confirmed = confirm('确定要清空主对话的所有内容吗？此操作不可撤销。');
      if (confirmed) {
        await clearConversation(id);
      }
    });
  });

  // 绑定重命名事件（仅子会话）
  document.querySelectorAll('.conv-item:not(.is-main) .conv-rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.conv-item');
      startRenameConversation(item);
    });
  });

  // 双击标题重命名（仅子会话）
  document.querySelectorAll('.conv-item:not(.is-main) .conv-title').forEach(titleEl => {
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const item = titleEl.closest('.conv-item');
      startRenameConversation(item);
    });
  });

  // 绑定置顶事件（仅子会话）
  document.querySelectorAll('.conv-item:not(.is-main) .conv-pin').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await window.api.conv.togglePin(id);
      await loadConversations();
    });
  });
}

// 开始重命名会话
function startRenameConversation(item) {
  const id = item.dataset.id;
  const titleEl = item.querySelector('.conv-title');
  const originalTitle = titleEl.textContent.trim();

  // 创建输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'conv-title-input';
  input.value = originalTitle;
  input.maxLength = 50;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;

  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const newTitle = input.value.trim();
    if (save && newTitle && newTitle !== originalTitle) {
      await window.api.conv.rename(id, newTitle);
      // 更新聊天头部标题
      if (currentConversationId === id) {
        const headerTitle = document.getElementById('chat-header-title');
        if (headerTitle) headerTitle.textContent = newTitle;
      }
    }
    await loadConversations();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });

  input.addEventListener('blur', () => {
    finish(true);
  });
}

// 渲染单个会话项
function renderConversationItem(conv, isMain) {
  const isActive = conv.id === currentConversationId;
  const icon = isMain ? '☁️' : '💬';
  const isPinned = conv.pinned || isMain;

  // 操作按钮：重命名 + 置顶 + 删除/清空
  const renameBtn = isMain ? '' : `
    <button class="conv-rename" data-id="${conv.id}" title="重命名（双击标题也可）">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    </button>
  `;

  const pinBtn = `
    <button class="conv-pin${isPinned ? ' pinned' : ''}" data-id="${conv.id}" title="${isMain ? '主对话默认置顶' : (isPinned ? '取消置顶' : '置顶')}" ${isMain ? 'disabled' : ''}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 17v5"></path>
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>
      </svg>
    </button>
  `;

  const deleteBtn = isMain ? `
    <button class="conv-clear" data-id="${conv.id}" title="清空对话内容">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  ` : `
    <button class="conv-delete" data-id="${conv.id}" title="删除对话">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  return `
    <div class="conv-item${isActive ? ' active' : ''}${isMain ? ' is-main' : ''}${isPinned && !isMain ? ' pinned' : ''}" data-id="${conv.id}">
      <span class="conv-icon">${icon}</span>
      <span class="conv-title">${escapeHtml(conv.title || '新对话')}</span>
      <div class="conv-actions">
        ${renameBtn}
        ${pinBtn}
        ${deleteBtn}
      </div>
    </div>
  `;
}

// 加载会话列表
async function loadConversations() {
  try {
    conversations = await window.api.conv.list();
    renderSidebar();
  } catch (err) {
    console.error('加载会话列表失败:', err);
  }
}

// 切换会话
async function switchConversation(conversationId) {
  if (conversationId === currentConversationId) return;

  // 保存当前会话
  saveCurrentConversation();

  // 如果正在通话中，切换会话时挂断
  if (phoneMode.active) {
    endPhoneCall();
  }

  currentConversationId = conversationId;
  try {
    messages = await window.api.conv.loadMessages(conversationId);
  } catch (err) {
    console.error('加载会话消息失败:', err);
    messages = [];
  }

  // 加载会话绑定的角色
  const conv = conversations.find(c => c.id === conversationId);
  currentAgentId = conv?.agentId || (config.defaultAgentId || 'default');
  updateAgentDisplay();

  renderSidebar();
  renderChat();

  // 电话功能仅主对话可用，子对话隐藏电话按钮和提示
  if (btnPhone) {
    if (conversationId === MAIN_CONVERSATION_ID) {
      btnPhone.style.display = 'flex';
    } else {
      btnPhone.style.display = 'none';
    }
  }
  // 语音电话提示文字：仅主对话显示
  const hintPhone = document.querySelector('.hint-phone');
  if (hintPhone) {
    hintPhone.style.display = conversationId === MAIN_CONVERSATION_ID ? 'inline' : 'none';
  }

  input.focus();
}

// 清空会话内容（主对话用）
async function clearConversation(conversationId) {
  try {
    // 保存空消息数组
    await window.api.conv.saveMessages(conversationId, []);
    // 如果清空的是当前对话，重新渲染
    if (currentConversationId === conversationId) {
      messages = [];
      renderChat();
    }
    return true;
  } catch (err) {
    console.error('清空对话失败:', err);
    alert('清空对话失败: ' + (err.message || err));
    return false;
  }
}

// 新建会话
async function createConversation() {
  try {
    const conv = await window.api.conv.create();
    await loadConversations();
    await switchConversation(conv.id);
  } catch (err) {
    console.error('新建会话失败:', err);
  }
}

// 保存当前会话消息（防抖）
function saveCurrentConversation() {
  if (!currentConversationId) return;
  if (saveTimer) clearTimeout(saveTimer);
  const convId = currentConversationId;
  const msgs = [...messages];
  saveTimer = setTimeout(() => {
    window.api.conv.saveMessages(convId, msgs).catch(err => {
      console.error('保存会话失败:', err);
    });
  }, 300);
}

// 立即保存（用于切换前）
function saveCurrentConversationImmediate() {
  if (!currentConversationId) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  window.api.conv.saveMessages(currentConversationId, messages).catch(err => {
    console.error('保存会话失败:', err);
  });
}

// ========================================
// 聊天渲染
// ========================================

function renderChat() {
  chatArea.innerHTML = '';
  if (messages.length === 0) {
    const w = document.createElement('div');
    w.className = 'welcome';
    w.id = 'welcome';
    w.innerHTML = `
      <div class="welcome-icon">✦</div>
      <div class="welcome-text">你好，我是 BOT</div>
      <div class="welcome-sub">随时为你服务</div>
    `;
    chatArea.appendChild(w);
    return;
  }
  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      addMessage(msg.role, msg.content, false);
    }
  }
  scrollToBottom(true);
}

function hideWelcome() {
  const w = document.getElementById('welcome');
  if (w) w.classList.add('hidden');
}

function addMessage(role, content, saveToMessages = true) {
  hideWelcome();

  // 检测是否是系统自动执行结果
  const isSystemResult = content && content.includes('[系统自动执行结果]');

  // 如果是系统执行结果且配置为隐藏，只保存到 messages 数组，不显示到 DOM
  if (isSystemResult && !config.showSystemResults) {
    if (saveToMessages) {
      messages.push({ role, content });
      saveCurrentConversation();
    }
    return null;
  }

  const div = document.createElement('div');

  if (isSystemResult) {
    div.className = 'message system-result';
    div.innerHTML = `
      <div class="label">系统</div>
      <div class="bubble">${formatContent(content)}</div>
    `;
  } else {
    div.className = `message ${role}`;
    const label = role === 'user' ? '你' : 'BOT';
    div.innerHTML = `
      <div class="label">${label}</div>
      <div class="bubble">
        ${formatContent(content)}
        <div class="message-actions">
          <button class="msg-action-btn copy-btn" title="复制内容">📋</button>
          ${role === 'assistant' ? '<button class="msg-action-btn regenerate-btn" title="重新生成">🔄</button>' : ''}
          ${role === 'user' ? '<button class="msg-action-btn edit-btn" title="编辑消息">✏️</button>' : ''}
        </div>
      </div>
    `;

    // 绑定复制按钮
    const copyBtn = div.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(content);
        copyBtn.innerHTML = '✓';
        copyBtn.title = '已复制';
        setTimeout(() => {
          copyBtn.innerHTML = '📋';
          copyBtn.title = '复制内容';
        }, 2000);
      });
    }

    // 绑定重新生成按钮
    const regenBtn = div.querySelector('.regenerate-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        regenerateLastReply();
      });
    }

    // 绑定编辑按钮
    const editBtn = div.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editUserMessage(div, content);
      });
    }
  }

  chatArea.appendChild(div);
  scrollToBottom(true);
  if (saveToMessages) {
    messages.push({ role, content });
    saveCurrentConversation();
  }
  return div;
}

function addStreamingMessage() {
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="label">BOT</div>
    <div class="bubble"><div class="loading"><span></span><span></span><span></span></div></div>
  `;
  chatArea.appendChild(div);
  scrollToBottom(true);
  return div;
}

function updateStreamingMessage(el, text) {
  const bubble = el.querySelector('.bubble');
  bubble.innerHTML = formatContent(text);
  scrollToBottom();
}

function addErrorMessage(text) {
  const div = document.createElement('div');
  div.className = 'message error';
  div.innerHTML = `
    <div class="label">错误</div>
    <div class="bubble">${escapeHtml(text)}</div>
  `;
  chatArea.appendChild(div);
  scrollToBottom(true);
}

function scrollToBottom(force = false) {
  // 非强制模式下，如果用户正在查看历史消息（距离底部超过80px），不强制滚动
  if (!force) {
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    if (distanceFromBottom > 80) return;
  }
  chatArea.scrollTop = chatArea.scrollHeight;
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * 预处理文件操作指令：将独立 content 通道转换为传统 JSON 格式。
 *
 * 独立 content 通道协议（长文本/代码推荐使用，无需 JSON 转义）：
 *   !!!file:{"action":"write","path":"D:\\x.html"}!!!
 *   !!!content-start!!!
 *   <!DOCTYPE html>...纯文本内容，引号/换行/反斜杠都不用转义...
 *   !!!content-end!!!
 *
 * 转换为：
 *   !!!file:{"action":"write","path":"D:\\x.html","content":"...转义后的内容..."}!!!
 *
 * 转换后走现有的 !!!file: 解析和执行流程，无需改动执行逻辑。
 */
function preprocessFileOps(text) {
  const regex = /!!!file:(\{[\s\S]*?\})!!!\s*!!!content-start!!!([\s\S]*?)!!!content-end!!!/g;
  return text.replace(regex, (match, jsonStr, content) => {
    try {
      const op = JSON.parse(jsonStr);
      op.content = content;
      return `!!!file:${JSON.stringify(op)}!!!`;
    } catch (e) {
      return match; // JSON 解析失败，保留原样让后续流程处理
    }
  });
}

function formatContent(text) {
  // 先将独立 content 通道转换为传统 JSON 格式
  text = preprocessFileOps(text);
  let html = escapeHtml(text);
  const placeholders = [];
  const stash = (replacer) => (...args) => {
    const idx = placeholders.length;
    placeholders.push(replacer(...args));
    return `\u0000P${idx}\u0000`;
  };

  // 1. 处理命令标记
  html = html.replace(/!!!command:(.*?)!!!/g, stash((_m, cmd) => {
    const escaped = cmd.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `<div class="cmd-block"><div class="cmd-header"><span class="cmd-icon">⚡</span><span class="cmd-title">Windows 命令</span></div><code class="cmd-code">${cmd}</code><button class="cmd-run" onclick="executeCmd(this, '${escaped}')" title="执行此命令">▶ 执行</button><div class="cmd-result"></div></div>`;
  }));

  // 2. 处理文件操作标记
  html = html.replace(/!!!file:(\{[\s\S]*?\})!!!/g, stash((_m, jsonStr) => {
    try {
      const decodedJson = jsonStr
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const op = JSON.parse(decodedJson);
      const actionNames = {
        read: '读取文件', write: '写入文件', append: '追加内容',
        list: '列出目录', copy: '复制文件', rename: '重命名',
        delete: '删除文件', open: '打开文件', mkdir: '创建目录',
      };
      const actionIcons = {
        read: '📖', write: '✏️', append: '📝', list: '📂',
        copy: '📋', rename: '🔄', delete: '🗑️', open: '📂', mkdir: '📁',
      };
      const name = actionNames[op.action] || op.action;
      const icon = actionIcons[op.action] || '📄';
      const pathDisplay = op.path || op.source || '';
      const opB64 = btoa(unescape(encodeURIComponent(JSON.stringify(op))));
      return `<div class="file-op-block file-op-hidden" data-op="${opB64}" data-action="${op.action}">
        <div class="file-op-header">
          <span class="file-op-icon">${icon}</span>
          <span class="file-op-title">${name}</span>
          <span class="file-op-path">${escapeHtml(pathDisplay)}</span>
        </div>
        <div class="file-op-status">
          <span class="file-op-status-text">⏳ 等待执行</span>
        </div>
        <div class="file-op-result"></div>
      </div>`;
    } catch (e) {
      return `<div class="file-op-block file-op-error"><div class="file-op-header"><span class="file-op-icon">⚠️</span><span class="file-op-title">文件操作指令解析失败</span></div><code class="file-op-raw">${escapeHtml(jsonStr)}</code></div>`;
    }
  }));

  // 隐藏被截断的不完整指令
  html = html.replace(/!!!file:\{[\s\S]*$/g, '');
  html = html.replace(/!!!content-start!!![\s\S]*$/g, '');

  // 3. 处理代码块（stash 起来，避免内部 Markdown 被处理）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, stash((_m, _lang, code) => {
    return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
  }));

  // 4. 处理行内代码（stash 起来）
  html = html.replace(/`([^`]+)`/g, stash((_m, code) => `<code class="inline-code">${code}</code>`));

  // 5. 处理标题 ### ## #
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 6. 处理分隔线 --- *** ___
  html = html.replace(/^[-*_]{3,}\s*$/gm, '<hr>');

  // 7. 处理引用 >
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // 8. 处理表格
  // 先处理表格分隔线 |---|---|
  html = html.replace(/^\|?[\s:-]+\|[\s:|-]+\|?\s*$/gm, (match) => {
    return '\u0000TABLE_SEP\u0000';
  });
  // 处理表格行 | 内容 | 内容 |
  html = html.replace(/^\|(.+)\|\s*$/gm, (match, content) => {
    const cells = content.split('|').map(c => c.trim()).filter(c => c !== '');
    if (cells.length < 2) return match;
    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  });
  // 把表格分隔线标记替换为空（表头和数据行都用 td）
  html = html.replace(/\u0000TABLE_SEP\u0000/g, '');
  // 包裹连续的表格行
  html = html.replace(/((?:<tr>.*<\/tr>\s*)+)/g, '<table>$1</table>');

  // 9. 处理无序列表 - * +
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  // 包裹连续的列表项
  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');

  // 10. 处理有序列表 1. 2.
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  // 包裹连续的有序列表项（覆盖上面的 ul）
  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, (match) => {
    // 检查是否是有序列表（前面有数字）
    return `<ol>${match.replace(/<li>/g, '<li>')}</ol>`;
  });

  // 11. 处理加粗 **
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 12. 处理斜体 *（注意：不能和加粗冲突，加粗已经处理完了）
  html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');

  // 13. 处理链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 14. 处理换行
  // 先移除块级元素前后的换行，避免额外间距
  html = html.replace(/\n*(<(h[1-6]|ul|ol|table|blockquote|hr|pre|div|p)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(h[1-6]|ul|ol|table|blockquote|pre|div|p)>)\n*/g, '$1');
  // 合并连续多个换行为一个
  html = html.replace(/\n{2,}/g, '\n');
  // 剩余的换行替换为 <br>
  html = html.replace(/\n/g, '<br>');

  // 15. 恢复 stash 的内容
  html = html.replace(/\u0000P(\d+)\u0000/g, (_m, i) => placeholders[i]);

  return html;
}

// ========================================
// 发送消息
// ========================================
async function sendMessage(regenerateText = null) {
  const text = regenerateText || input.value.trim();
  const hasAttachments = attachments.length > 0;
  if ((!text && !hasAttachments) || isStreaming || agentLoopRunning) return;

  if (!config.apiKey) {
    addErrorMessage('请先在设置中配置 API Key');
    settingsPanel.classList.remove('hidden');
    return;
  }

  if (voiceManager && (voiceManager.getState() === 'listening' || voiceManager.getState() === 'initializing')) {
    voiceManager.stop();
  }

  // 重新生成模式下不重复添加用户消息
  if (!regenerateText) {
    if (hasAttachments) {
      // 有附件时构建多模态消息并自定义显示
      const userMsg = buildUserMessageWithAttachments(text);
      addUserMessageWithAttachments(userMsg, text);
      messages.push(userMsg);
      saveCurrentConversation();
    } else {
      addMessage('user', text);
    }
    input.value = '';
    input.removeAttribute('data-voice-base');
    autoResize();
    clearAttachments();
  }

  isStreaming = true;
  setSendButtonState(true);

  await runAgentLoop();
}

// 显示带附件的用户消息（文本 + 图片缩略图）
function addUserMessageWithAttachments(userMsg, plainText) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'message user';

  // 提取图片附件用于显示
  const images = Array.isArray(userMsg.content)
    ? userMsg.content.filter(c => c.type === 'image_url').map(c => c.image_url.url)
    : [];

  let imagesHtml = '';
  if (images.length > 0) {
    imagesHtml = '<div class="user-message-images">' +
      images.map(url => `<img src="${url}" class="user-message-img">`).join('') +
      '</div>';
  }

  div.innerHTML = `
    <div class="label">你</div>
    <div class="bubble">
      ${imagesHtml}
      ${plainText ? formatContent(plainText) : ''}
      <div class="message-actions">
        <button class="msg-action-btn copy-btn" title="复制内容">📋</button>
        <button class="msg-action-btn edit-btn" title="编辑消息">✏️</button>
      </div>
    </div>
  `;

  // 绑定复制按钮
  const copyBtn = div.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(plainText || '').catch(() => {});
      copyBtn.textContent = '✅';
      setTimeout(() => copyBtn.textContent = '📋', 1500);
    });
  }

  chatArea.appendChild(div);
  scrollToBottom();
}

btnSend.addEventListener('click', () => {
  if (isStreaming || agentLoopRunning) {
    stopGeneration();
  } else {
    sendMessage();
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoResize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  updateTokenCount();
}

// 估算文本的 Token 数（中文约1.5字符/token，英文约4字符/token）
function estimateTokens(text) {
  if (!text) return 0;
  let chineseChars = 0;
  let otherChars = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      chineseChars++;
    } else {
      otherChars++;
    }
  }
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// 更新输入框 Token 计数显示
function updateTokenCount() {
  const tokenEl = document.getElementById('input-token-count');
  if (!tokenEl) return;
  const inputTokens = estimateTokens(input.value);
  // 估算历史消息总 token
  let historyTokens = 0;
  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      historyTokens += estimateTokens(msg.content);
    }
  }
  const total = inputTokens + historyTokens;
  tokenEl.textContent = `${inputTokens} / 共约 ${total} tokens`;
  tokenEl.classList.remove('warning', 'danger');
  if (total > 6000) tokenEl.classList.add('danger');
  else if (total > 4000) tokenEl.classList.add('warning');
}

input.addEventListener('input', autoResize);

// ========================================
// 编辑用户消息 & 重新生成
// ========================================

// 编辑用户消息
function editUserMessage(msgEl, originalContent) {
  const bubble = msgEl.querySelector('.bubble');
  const originalHtml = bubble.innerHTML;

  // 创建编辑界面
  bubble.innerHTML = `
    <textarea class="edit-textarea" spellcheck="false">${escapeHtml(originalContent)}</textarea>
    <div class="edit-actions">
      <button class="edit-save-btn">保存并重新生成</button>
      <button class="edit-cancel-btn">取消</button>
    </div>
  `;

  const textarea = bubble.querySelector('.edit-textarea');
  textarea.focus();
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  // 保存并重新生成
  bubble.querySelector('.edit-save-btn').addEventListener('click', () => {
    const newContent = textarea.value.trim();
    if (!newContent) return;

    // 找到这条消息在 messages 数组中的索引
    const msgIndex = messages.findIndex(m => m.content === originalContent && m.role === 'user');
    if (msgIndex === -1) return;

    // 删除这条用户消息及其之后的所有消息
    const removedMessages = messages.splice(msgIndex);

    // 从 DOM 中删除这条消息及其之后的所有消息
    const allMsgs = chatArea.querySelectorAll('.message:not(.system-result)');
    // 找到当前消息的索引
    let currentMsgIndex = -1;
    allMsgs.forEach((m, i) => {
      if (m === msgEl) currentMsgIndex = i;
    });
    if (currentMsgIndex !== -1) {
      for (let i = allMsgs.length - 1; i >= currentMsgIndex; i--) {
        allMsgs[i].remove();
      }
    }

    // 保存对话
    saveCurrentConversation();

    // 用新内容重新发送
    sendMessage(newContent);
  });

  // 取消编辑
  bubble.querySelector('.edit-cancel-btn').addEventListener('click', () => {
    bubble.innerHTML = originalHtml;
    // 重新绑定按钮事件
    const copyBtn = bubble.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(originalContent);
        copyBtn.innerHTML = '✓';
        setTimeout(() => copyBtn.innerHTML = '📋', 2000);
      });
    }
    const editBtn = bubble.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editUserMessage(msgEl, originalContent);
      });
    }
  });
}

// 重新生成最后一条回复
async function regenerateLastReply() {
  if (isStreaming || agentLoopRunning) return;

  // 找到最后一条助手消息
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) return;

  // 找到对应的用户消息（最后一条用户消息）
  let lastUserMsg = null;
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMsg = messages[i];
      break;
    }
  }

  if (!lastUserMsg) return;

  // 删除最后一条助手消息
  messages.splice(lastAssistantIdx, 1);

  // 从 DOM 中删除最后一条助手消息
  const allMsgs = chatArea.querySelectorAll('.message.assistant');
  if (allMsgs.length > 0) {
    allMsgs[allMsgs.length - 1].remove();
  }

  // 保存对话
  saveCurrentConversation();

  // 重新发送
  await sendMessage(lastUserMsg.content);
}

// ========================================
// 主题切换
// ========================================
function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '🌙' : '☀️';
  btnTheme.title = theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式';
  config.theme = theme;
  window.api.saveConfig(config);
}

btnTheme.addEventListener('click', () => {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

// ========================================
// 语音输入（STT 模块）
// ========================================
let voiceManager = null;
let voiceErrorTimer = null;

function initVoiceModule() {
  if (typeof VoiceInputManager === 'undefined') {
    console.warn('VoiceInputManager 未加载，语音输入不可用');
    btnMic.title = '语音模块未加载';
    btnMic.style.opacity = '0.3';
    btnMic.style.cursor = 'not-allowed';
    return;
  }

  const botSTTConfig = config.apiKey ? {
    apiUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
    apiKey: config.apiKey,
    model: 'mimo-v2.5-asr',
    language: 'auto',
  } : null;

  const httpSTTConfig = config.sttConfig ? {
    apiUrl: config.sttConfig.apiUrl || '',
    apiKey: config.sttConfig.apiKey || '',
    model: config.sttConfig.model || 'whisper-1',
    language: config.sttConfig.language || 'zh',
  } : null;

  voiceManager = new VoiceInputManager({
    preferredProvider: botSTTConfig ? 'bot' : (httpSTTConfig ? 'http' : 'webspeech'),
    botSTTConfig,
    httpSTTConfig,

    onStateChange: (state, prevState) => {
      handleVoiceStateChange(state, prevState);
    },

    onResult: (result) => {
      const statusText = document.getElementById('voice-status-text');
      if (statusText) {
        const display = result.full || '正在聆听...';
        statusText.textContent = display.length > 40 ? display.substring(0, 40) + '...' : display;
      }
    },

    onFinalResult: (text) => {
      const existing = input.value.trim();
      if (existing) {
        input.value = existing + ' ' + text;
      } else {
        input.value = text;
      }
      autoResize();
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    },

    onError: (error) => {
      showVoiceError(error);
    },

    onLog: (entry) => {
      console.log(`[Voice ${entry.level}] ${entry.message}`);
    },
  });
}

async function runVoiceDiagnosis() {
  if (typeof diagnoseVoiceEnvironment === 'undefined') {
    addErrorMessage('诊断功能不可用');
    return;
  }

  addMessage('assistant', '正在诊断语音识别环境，请稍候...');
  const report = await diagnoseVoiceEnvironment();

  let reportText = `## 语音环境诊断报告\n\n`;
  reportText += `**诊断时间**：${report.timestamp}\n\n`;
  reportText += `**整体状态**：${report.overall === 'error' ? '❌ 异常' : report.overall === 'warning' ? '⚠️ 存在问题' : '✅ 正常'}\n\n`;
  reportText += `### 检查项\n\n`;

  for (const check of report.checks) {
    const icon = check.available ? '✅' : '❌';
    reportText += `${icon} **${check.name}**：${check.detail}\n`;
    if (check.note) reportText += `   > ${check.note}\n`;
    if (check.devices && check.devices.length) {
      reportText += `   设备列表：\n`;
      check.devices.forEach((d, i) => reportText += `   ${i + 1}. ${d}\n`);
    }
    reportText += '\n';
  }

  reportText += `### 建议\n\n`;
  report.recommendations.forEach((r, i) => {
    reportText += `${i + 1}. ${r}\n`;
  });

  addMessage('assistant', reportText);
}

function handleVoiceStateChange(state, prevState) {
  const voiceStatus = document.getElementById('voice-status');
  const statusText = document.getElementById('voice-status-text');

  switch (state) {
    case 'listening':
    case 'initializing':
      voiceStatus.classList.remove('hidden');
      btnMic.classList.add('recording');
      if (statusText) statusText.textContent = state === 'initializing' ? '正在初始化...' : '正在聆听... 点击麦克风结束';
      break;
    case 'processing':
      if (statusText) statusText.textContent = '正在识别...';
      break;
    case 'error':
    case 'idle':
      voiceStatus.classList.add('hidden');
      btnMic.classList.remove('recording');
      if (statusText) statusText.textContent = '正在聆听...';
      break;
  }
}

function showVoiceError(error) {
  const toast = document.getElementById('voice-error-toast');
  const errorText = document.getElementById('voice-error-text');
  const suggestion = document.getElementById('voice-error-suggestion');

  let message = error.message || '语音输入失败';
  if (error.code === 'NO_SPEECH' && voiceManager && voiceManager.provider instanceof WebSpeechProvider) {
    message = '未检测到识别结果。Web Speech API 依赖 Google 服务，国内网络可能无法连接。建议在设置中配置 HTTP STT 服务。';
  }
  if (error.code === 'STT_SERVICE') {
    message = error.message + '。可在设置中配置 HTTP STT 服务（如自建 Whisper、百度/讯飞语音识别）。';
  }

  errorText.textContent = message;

  if (error.shouldSuggestKeyboard) {
    suggestion.classList.remove('hidden');
    suggestion.textContent = '连续识别失败，建议切换键盘文字输入，或在设置中配置 HTTP STT 服务';
  } else {
    suggestion.classList.add('hidden');
  }

  toast.classList.remove('hidden');

  if (error.code !== 'USER_ABORT') {
    if (voiceErrorTimer) clearTimeout(voiceErrorTimer);
    voiceErrorTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 8000);
  }
}

function hideVoiceError() {
  document.getElementById('voice-error-toast').classList.add('hidden');
  if (voiceErrorTimer) {
    clearTimeout(voiceErrorTimer);
    voiceErrorTimer = null;
  }
}

btnMic.addEventListener('click', () => {
  if (!voiceManager) {
    addErrorMessage('语音模块未初始化');
    return;
  }
  const state = voiceManager.getState();
  if (state === 'listening' || state === 'initializing') {
    voiceManager.stop();
  } else {
    hideVoiceError();
    voiceManager.start();
  }
});

// ========================================
// 语音电话模式
// ========================================
const btnPhone = $('#btn-phone');
const phoneOverlay = $('#phone-overlay');
const phoneMicBtn = $('#phone-mic-btn');
const phoneHangupBtn = $('#phone-hangup-btn');
const phoneStatus = $('#phone-status');
const phoneMessagesEl = $('#phone-messages');

let phoneMode = {
  active: false,
  voiceManager: null,
  tts: null,
  messages: [],
  isListening: false,
  isThinking: false,
  isSpeaking: false,
  abortController: null,
};

// 初始化电话模式（事件绑定）
function initPhoneMode() {
  if (!btnPhone) {
    console.warn('电话按钮未找到，电话功能不可用');
    return;
  }

  btnPhone.addEventListener('click', () => {
    try {
      if (phoneMode.active) {
        endPhoneCall();
        btnPhone.classList.remove('active');
      } else {
        startPhoneCall();
        btnPhone.classList.add('active');
      }
    } catch (err) {
      console.error('电话按钮点击失败:', err);
      addErrorMessage('电话功能启动失败: ' + (err.message || err));
    }
  });

  if (phoneMicBtn) {
    phoneMicBtn.addEventListener('click', () => {
      if (!phoneMode.voiceManager) return;
      const state = phoneMode.voiceManager.getState();
      if (state === 'listening' || state === 'initializing') {
        phoneStopListening();
      } else if (!phoneMode.isThinking && !phoneMode.isSpeaking) {
        phoneStartListening();
      }
    });
  }

  if (phoneHangupBtn) {
    phoneHangupBtn.addEventListener('click', () => {
      endPhoneCall();
      btnPhone.classList.remove('active');
    });
  }
}

// 开始电话
function startPhoneCall() {
  try {
    if (!config.apiKey) {
      addErrorMessage('请先在设置中配置 API Key');
      settingsPanel.classList.remove('hidden');
      return;
    }

    phoneMode.active = true;
    phoneMode.messages = [];
    phoneMode.isListening = false;
    phoneMode.isThinking = false;
    phoneMode.isSpeaking = false;

    // 显示通话界面
    if (phoneOverlay) {
      phoneOverlay.classList.remove('hidden');
    }
    if (phoneMessagesEl) {
      phoneMessagesEl.innerHTML = '<div class="phone-system-msg">通话已连接，开始说话即可，停止说话2秒后自动识别</div>';
    }
    phoneUpdateStatus('connected');

    // 初始化 TTS
    if (typeof BotTTS !== 'undefined') {
      phoneMode.tts = new BotTTS({
        apiUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
        apiKey: config.apiKey,
        model: 'mimo-v2.5-tts',
        voice: '茉莉',
      });
    } else {
      console.warn('BotTTS 未加载，语音播放不可用');
    }

    // 初始化电话模式的语音识别
    if (typeof VoiceInputManager !== 'undefined') {
      const botSTTConfig = {
        apiUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
        apiKey: config.apiKey,
        model: 'mimo-v2.5-asr',
        language: 'auto',
      };

      phoneMode.voiceManager = new VoiceInputManager({
        preferredProvider: 'bot',
        botSTTConfig,
        silenceTimeout: 2000,      // 电话模式：停止说话2秒后自动结束
        speechThreshold: 5,         // 音量阈值（ScriptProcessorNode RMS，5即可检测到小声说话）

        onStateChange: (state) => {
          if (state === 'listening' || state === 'initializing') {
            phoneMode.isListening = true;
            if (phoneMicBtn) phoneMicBtn.classList.add('recording');
            phoneUpdateStatus('listening');
          } else {
            phoneMode.isListening = false;
            if (phoneMicBtn) phoneMicBtn.classList.remove('recording');
          }
        },

        // 实时音量回调（用于调试和静音检测）
        onAudioLevel: (level) => {
          if (phoneMode.isListening && phoneStatus) {
            const bar = '█'.repeat(Math.min(10, Math.round(level / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(level / 10)));
            phoneStatus.textContent = `正在聆听... 音量: ${bar} ${level}`;
          }
        },

        onFinalResult: (text) => {
          if (text && text.trim()) {
            phoneOnASRResult(text.trim());
          }
        },

        onError: (error) => {
          phoneAddSystemMsg('识别失败：' + (error.message || '未知错误'));
          phoneUpdateStatus('connected');
          // 识别失败后自动开始下一轮
          setTimeout(() => {
            if (phoneMode.active && !phoneMode.isThinking && !phoneMode.isSpeaking) {
              phoneStartListening();
            }
          }, 1000);
        },

        onLog: (entry) => {
          console.log(`[Phone Voice ${entry.level}] ${entry.message}`);
        },
      });
    } else {
      phoneAddSystemMsg('语音识别模块未加载');
    }

    // 自动开始第一轮监听
    setTimeout(() => phoneStartListening(), 500);
  } catch (err) {
    console.error('启动电话模式失败:', err);
    phoneAddSystemMsg('启动失败: ' + (err.message || err));
    phoneMode.active = false;
    if (phoneOverlay) phoneOverlay.classList.add('hidden');
    if (btnPhone) btnPhone.classList.remove('active');
  }
}

// 挂断电话
function endPhoneCall() {
  phoneMode.active = false;

  // 停止语音识别
  if (phoneMode.voiceManager) {
    try { phoneMode.voiceManager.stop(); } catch {}
    try { phoneMode.voiceManager.destroy(); } catch {}
    phoneMode.voiceManager = null;
  }

  // 停止 TTS
  if (phoneMode.tts) {
    try { phoneMode.tts.stop(); } catch {}
    try { phoneMode.tts.destroy(); } catch {}
    phoneMode.tts = null;
  }

  // 中止 LLM 请求
  if (phoneMode.abortController) {
    try { phoneMode.abortController.abort(); } catch {}
    phoneMode.abortController = null;
  }

  phoneMode.isListening = false;
  phoneMode.isThinking = false;
  phoneMode.isSpeaking = false;
  phoneMode.messages = [];

  // 隐藏通话界面
  phoneOverlay.classList.add('hidden');
  phoneMicBtn.classList.remove('recording');

  // 通话结束后，如果唤醒词已启用，恢复后台唤醒词监听
  if (wakeWordActive && config.wakeWordEnabled) {
    setTimeout(() => startWakeWordListening(), 500);
  }
}

// 电话模式开始监听
function phoneStartListening() {
  if (!phoneMode.voiceManager || !phoneMode.active) return;
  if (phoneMode.isThinking || phoneMode.isSpeaking) return;
  phoneMode.voiceManager.start();
}

// 电话模式停止监听
function phoneStopListening() {
  if (!phoneMode.voiceManager) return;
  phoneMode.voiceManager.stop();
}

// ASR 识别完成回调
function phoneOnASRResult(text) {
  // 显示用户消息
  phoneAddMessage('user', text);
  // 发送给大模型
  phoneSendToLLM(text);
}

// ========================================
// 唤醒词模块（Wake Word Detection）
// ========================================
const btnWake = $('#btn-wake');

// 初始化唤醒词模块（事件绑定 + 状态恢复）
function initWakeWordModule() {
  if (!btnWake) {
    console.warn('唤醒词按钮未找到');
    return;
  }

  // 唤醒词开关按钮
  btnWake.addEventListener('click', () => {
    if (wakeWordActive) {
      stopWakeWordListening();
    } else {
      if (!config.apiKey) {
        addErrorMessage('请先在设置中配置 API Key 后再使用唤醒词');
        settingsPanel.classList.remove('hidden');
        return;
      }
      startWakeWordListening();
    }
  });

  // 如果配置中已启用唤醒词，自动启动
  if (config.wakeWordEnabled && config.apiKey) {
    setTimeout(() => startWakeWordListening(), 1000);
  }
}

// 启动唤醒词监听
function startWakeWordListening() {
  if (wakeWordActive) return;
  if (!config.apiKey) {
    console.warn('未配置 API Key，无法启动唤醒词监听');
    return;
  }

  if (typeof WakeWordManager === 'undefined') {
    console.error('WakeWordManager 未加载');
    return;
  }

  const botSTTConfig = {
    apiUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
    apiKey: config.apiKey,
    model: 'mimo-v2.5-asr',
    language: 'auto',
  };

  wakeWordManager = new WakeWordManager({
    wakeWord: config.wakeWord || 'bot',
    alternatives: config.wakeAlternatives || '',
    provider: config.wakeProvider || 'bot',
    botSTTConfig,
    silenceTimeout: 800,
    speechThreshold: 3,
    maxSegmentDuration: 8000,
    restartDelay: 200,

    onWake: (matchedText) => {
      handleWakeWordDetected(matchedText);
    },

    onStateChange: (state) => {
      if (state === 'listening') {
        if (btnWake) btnWake.classList.add('active');
      }
    },

    onError: (error) => {
      console.warn('[唤醒词] 错误:', error.code, error.message);
      updateWakeDebug('error', `错误: [${error.code}] ${error.message}`);
      // 麦克风权限错误，停止监听并提示
      if (error.code === 'MIC_PERMISSION') {
        stopWakeWordListening();
        addErrorMessage('唤醒词需要麦克风权限，请在系统设置中允许麦克风访问');
      }
    },

    onLog: (entry) => {
      console.log(`[唤醒词 ${entry.level}] ${entry.message}`);
      // 在调试区域显示识别结果
      if (entry.message.includes('识别到: (空)')) {
        updateWakeDebug('empty', '识别到: (空) — 未捕获到语音');
      } else if (entry.message.includes('识别到:')) {
        const match = entry.message.match(/识别到: "(.+)"/);
        if (match) {
          const keyword = (config.wakeWord || 'bot').toLowerCase();
          const heard = match[1].toLowerCase();
          const isMatch = heard.includes(keyword);
          updateWakeDebug(isMatch ? 'match' : 'heard',
            isMatch ? `✅ 匹配! "${match[1]}"` : `听到: "${match[1]}"`);
        }
      } else if (entry.message.includes('检测到唤醒词')) {
        updateWakeDebug('match', entry.message);
      } else if (entry.level === 'error') {
        updateWakeDebug('error', entry.message);
      } else if (entry.level === 'success') {
        updateWakeDebug('match', entry.message);
      }
    },
  });

  wakeWordManager.start();
  wakeWordActive = true;

  // 更新设置面板状态
  if ($('#cfg-wake-enabled')) {
    $('#cfg-wake-enabled').checked = true;
  }
  updateWakeWordStatus('success', `唤醒词监听已启动，喊"${config.wakeWord || 'bot'}"唤醒`);
  updateWakeDebug('empty', '监听中... 请喊"' + (config.wakeWord || 'bot') + '"');
}

// 停止唤醒词监听
function stopWakeWordListening() {
  wakeWordActive = false;
  if (wakeWordManager) {
    try { wakeWordManager.stop(); } catch {}
    try { wakeWordManager.destroy(); } catch {}
    wakeWordManager = null;
  }
  if (btnWake) btnWake.classList.remove('active');
  updateWakeWordStatus('info', '唤醒词监听已停止');
  updateWakeDebug('empty', '监听已停止');
}

// 处理唤醒词检测到
async function handleWakeWordDetected(matchedText) {
  console.log(`[唤醒词] 检测到唤醒词，原文: "${matchedText}"`);

  // 停止唤醒词监听（电话模式会占用麦克风）
  wakeWordActive = false;
  if (wakeWordManager) {
    try { wakeWordManager.stop(); } catch {}
    try { wakeWordManager.destroy(); } catch {}
    wakeWordManager = null;
  }
  if (btnWake) btnWake.classList.remove('active');

  // ── 声纹验证（如果启用且已注册）──
  if (config.voiceprintEnabled && voiceprintManager && voiceprintManager.isRegistered()) {
    console.log('[声纹] 开始唤醒声纹验证...');
    const verified = await verifyVoiceprintOnWake();

    if (!verified) {
      console.log('[声纹] 验证未通过，拒绝唤醒');
      // 播放拒绝提示（用系统提示音或简短 TTS）
      try {
        if (phoneMode.tts) {
          // 不启动电话模式，直接用一个临时 TTS 播放拒绝语
        }
      } catch {}
      // 恢复唤醒词监听
      setTimeout(() => {
        if (config.wakeWordEnabled && config.apiKey) {
          startWakeWordListening();
        }
      }, 500);
      return;
    }
    console.log('[声纹] 验证通过，允许唤醒');
  }

  // 播放唤醒回复 TTS
  const responseText = (config.wakeWordResponse || '我在').trim();

  // 等待麦克风完全释放，避免 getUserMedia 冲突
  await new Promise(r => setTimeout(r, 500));

  // 启动电话模式（语音对话，自带 VAD 自动停止 + 连续对话）
  if (!phoneMode.active) {
    // 先启动电话模式
    startPhoneCall();

    // 延迟播放唤醒回复（等 TTS 初始化完成）
    if (responseText) {
      setTimeout(() => {
        if (phoneMode.tts && phoneMode.active) {
          phoneSpeak(responseText).then(() => {
            // 回复播放完毕后自动开始监听（电话模式的连续对话）
            setTimeout(() => phoneStartListening(), 200);
          }).catch(() => {
            setTimeout(() => phoneStartListening(), 200);
          });
        } else {
          setTimeout(() => phoneStartListening(), 200);
        }
      }, 600);
    } else {
      setTimeout(() => phoneStartListening(), 500);
    }
  }
}

// 更新设置面板中的唤醒词状态提示
function updateWakeWordStatus(type, message) {
  const el = $('#wake-word-settings-status');
  if (!el) return;
  el.textContent = message;
  el.className = 'wake-word-status ' + type;
  // 3秒后清除 info 类型提示
  if (type === 'info') {
    setTimeout(() => {
      if (el.textContent === message) {
        el.className = 'wake-word-status';
        el.textContent = '';
      }
    }, 3000);
  }
}

// 更新唤醒词调试显示
function updateWakeDebug(type, text) {
  const el = $('#wake-word-debug-text');
  if (!el) return;
  el.textContent = text;
  el.className = 'wake-word-debug-text ' + type;
}

// 测试录音按钮：录3秒并显示ASR结果
function initWakeTestButton() {
  const btn = $('#btn-wake-test');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!config.apiKey) {
      addErrorMessage('请先在设置中配置 API Key');
      return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔴 正在录音 3 秒...';
    updateWakeDebug('info', '正在录音...');

    try {
      const useWeb = (config.wakeProvider || 'bot') === 'web';
      let resultText = '';

      if (useWeb && typeof WebSpeechProvider !== 'undefined') {
        const provider = new WebSpeechProvider({ language: 'zh-CN' });
        provider.onResult = (r) => { if (r.full || r.interim) resultText = r.full || r.interim; };
        provider.onError = (err) => { resultText = '错误: ' + (err.message || ''); };
        await provider.start();
        updateWakeDebug('info', 'Web Speech 录音中，请说话...');
        await new Promise(r => setTimeout(r, 3000));
        provider.stop();
        await new Promise(r => setTimeout(r, 800));
      } else {
        const provider = new BotSTTProvider({
          apiUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
          apiKey: config.apiKey,
          model: 'mimo-v2.5-asr',
          language: 'auto',
        });
        provider.onResult = (result) => { resultText = result.full || ''; };
        provider.onError = (err) => { resultText = '错误: ' + (err.message || ''); };
        await provider.start();
        updateWakeDebug('info', '正在录音，请说话...');
        await new Promise(r => setTimeout(r, 3000));
        await provider.stop();
        await new Promise(r => setTimeout(r, 500));
      }

      if (resultText) {
        const keyword = (config.wakeWord || 'bot').toLowerCase();
        const heard = resultText.toLowerCase();
        const matched = heard.includes(keyword);
        updateWakeDebug(matched ? 'match' : 'nomatch',
          `识别结果: "${resultText}" ${matched ? '✅ 匹配唤醒词' : '❌ 不匹配"' + keyword + '"'}`);
      } else {
        updateWakeDebug('empty', '未识别到语音（可能麦克风静音或环境太安静）');
      }
    } catch (err) {
      updateWakeDebug('error', '测试失败: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// ========================================
// 声纹识别模块（Voiceprint / Speaker Verification）
// ========================================

// 初始化声纹模块
function initVoiceprintModule() {
  if (typeof VoiceprintManager === 'undefined') {
    console.warn('VoiceprintManager 未加载，声纹识别不可用');
    return;
  }

  const threshold = (config.voiceprintThreshold || 82) / 100;
  voiceprintManager = new VoiceprintManager({
    sampleRate: 16000,
    threshold: threshold,
    minDuration: 2,
    numRegistrations: 3,
    onStateChange: (state) => {
      console.log('[声纹] 状态:', state);
    },
    onLog: (entry) => {
      if (entry.level === 'success' || entry.level === 'error') {
        console.log(`[声纹 ${entry.level}] ${entry.message}`);
      }
    },
  });

  // 从配置导入已注册的声纹数据
  if (config.voiceprintData) {
    const imported = voiceprintManager.importData(config.voiceprintData);
    if (imported) {
      console.log('[声纹] 已从配置恢复声纹数据');
    }
  }

  // 绑定按钮事件
  const btnRecord = $('#btn-voiceprint-record');
  const btnRegister = $('#btn-voiceprint-register');
  const btnVerify = $('#btn-voiceprint-verify');
  const btnClear = $('#btn-voiceprint-clear');

  if (btnRecord) {
    btnRecord.addEventListener('click', () => {
      if (voiceprintIsRecording) {
        stopVoiceprintRecording();
      } else {
        startVoiceprintRecording();
      }
    });
  }

  if (btnRegister) {
    btnRegister.addEventListener('click', () => {
      completeVoiceprintRegistration();
    });
  }

  if (btnVerify) {
    btnVerify.addEventListener('click', () => {
      testVoiceprintVerification();
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      clearVoiceprint();
    });
  }

  // 更新 UI
  updateVoiceprintUI();
}

// 更新声纹 UI 状态
function updateVoiceprintUI() {
  const statusEl = $('#voiceprint-register-status');
  const progressBar = $('#voiceprint-progress-bar');
  const progressText = $('#voiceprint-progress-text');
  const btnRecord = $('#btn-voiceprint-record');
  const btnRegister = $('#btn-voiceprint-register');

  if (!statusEl) return;

  const count = voiceprintRecordings.length;
  const registered = voiceprintManager && voiceprintManager.isRegistered();

  if (registered) {
    const meta = voiceprintManager.getTemplateInfo();
    statusEl.textContent = `✅ 已注册声纹（${meta?.numSamples || 0} 段，平均 ${meta?.avgDuration?.toFixed(1) || 0}s）`;
    statusEl.className = 'voiceprint-register-status registered';
  } else if (voiceprintIsRecording) {
    statusEl.textContent = `🔴 正在录音第 ${count + 1} 段...（至少说 2 秒）`;
    statusEl.className = 'voiceprint-register-status recording';
  } else if (count > 0) {
    statusEl.textContent = `已录入 ${count} 段，继续录入或完成注册`;
    statusEl.className = 'voiceprint-register-status';
  } else {
    statusEl.textContent = '未注册声纹，点击"录入第 1 段"开始';
    statusEl.className = 'voiceprint-register-status';
  }

  if (progressBar) {
    progressBar.setAttribute('data-progress', Math.min(count, 3));
  }
  if (progressText) {
    progressText.textContent = `${Math.min(count, 3)} / 3 段`;
  }
  if (btnRecord) {
    if (voiceprintIsRecording) {
      btnRecord.textContent = '⏹ 停止录音';
      btnRecord.classList.add('recording');
    } else {
      btnRecord.textContent = count < 3 ? `🎙️ 录入第 ${count + 1} 段` : '🎙️ 追加录入';
      btnRecord.classList.remove('recording');
    }
  }
  if (btnRegister) {
    btnRegister.disabled = count < 2; // 至少2段即可注册（3段推荐）
  }
}

// 开始声纹录音
async function startVoiceprintRecording() {
  if (!voiceprintManager) return;
  if (voiceprintIsRecording) return;

  try {
    await voiceprintManager.startRecording();
    voiceprintIsRecording = true;
    updateVoiceprintUI();
    showVoiceprintResult('info', '正在录音，请朗读一段文字（至少2秒）...');
  } catch (err) {
    showVoiceprintResult('error', '录音失败: ' + err.message);
  }
}

// 停止声纹录音
async function stopVoiceprintRecording() {
  if (!voiceprintManager || !voiceprintIsRecording) return;

  voiceprintIsRecording = false;
  const result = await voiceprintManager.stopRecording();

  if (result && result.valid) {
    voiceprintRecordings.push(result.blob);
    showVoiceprintResult('success', `第 ${voiceprintRecordings.length} 段录入成功（${result.duration.toFixed(1)}秒）`);
  } else if (result) {
    showVoiceprintResult('error', result.reason || '录音无效');
  }

  updateVoiceprintUI();
}

// 完成声纹注册
async function completeVoiceprintRegistration() {
  if (!voiceprintManager) return;
  if (voiceprintRecordings.length < 2) {
    showVoiceprintResult('error', '至少需要录入 2 段语音才能注册');
    return;
  }

  showVoiceprintResult('info', '正在处理声纹特征，请稍候...');

  const result = await voiceprintManager.register(voiceprintRecordings);

  if (result.success) {
    showVoiceprintResult('success', `声纹注册成功！${result.meta.numSamples} 段有效，平均时长 ${result.meta.avgDuration.toFixed(1)}秒`);
    // 保存到配置
    config.voiceprintData = voiceprintManager.exportData();
    window.api.saveConfig(config);
    // 清空临时录音
    voiceprintRecordings = [];
  } else {
    showVoiceprintResult('error', '声纹注册失败: ' + (result.error || '未知错误'));
  }

  updateVoiceprintUI();
}

// 测试声纹验证
async function testVoiceprintVerification() {
  if (!voiceprintManager) return;
  if (!voiceprintManager.isRegistered()) {
    showVoiceprintResult('error', '请先注册声纹再测试');
    return;
  }

  // 录一段音然后验证
  try {
    showVoiceprintResult('info', '请说一句话进行验证（至少2秒）...');
    await voiceprintManager.startRecording();
    voiceprintIsRecording = true;
    updateVoiceprintUI();

    // 3秒后自动停止
    setTimeout(async () => {
      if (voiceprintIsRecording) {
        voiceprintIsRecording = false;
        const result = await voiceprintManager.stopRecording();
        updateVoiceprintUI();

        if (result && result.valid) {
          showVoiceprintResult('info', '正在验证声纹...');
          const verifyResult = await voiceprintManager.verify(result.blob);
          if (verifyResult.success) {
            const pct = (verifyResult.score * 100).toFixed(1);
            if (verifyResult.verified) {
              showVoiceprintResult('success', `✅ 验证通过！相似度 ${pct}%（阈值 ${(verifyResult.threshold * 100).toFixed(0)}%）`);
            } else {
              showVoiceprintResult('error', `❌ 验证未通过！相似度 ${pct}%（阈值 ${(verifyResult.threshold * 100).toFixed(0)}%）`);
            }
          } else {
            showVoiceprintResult('error', '验证失败: ' + (verifyResult.error || '未知错误'));
          }
        } else {
          showVoiceprintResult('error', result?.reason || '录音无效');
        }
      }
    }, 3500);
  } catch (err) {
    voiceprintIsRecording = false;
    showVoiceprintResult('error', '验证失败: ' + err.message);
    updateVoiceprintUI();
  }
}

// 清除声纹
function clearVoiceprint() {
  if (!voiceprintManager) return;
  voiceprintManager.clear();
  voiceprintRecordings = [];
  config.voiceprintData = null;
  window.api.saveConfig(config);
  showVoiceprintResult('info', '声纹已清除');
  updateVoiceprintUI();
}

// 显示声纹结果提示
function showVoiceprintResult(type, message) {
  const el = $('#voiceprint-result');
  if (!el) return;
  el.textContent = message;
  el.className = 'voiceprint-result ' + type;
  if (type === 'info') {
    setTimeout(() => {
      if (el.textContent === message) {
        el.className = 'voiceprint-result';
        el.textContent = '';
      }
    }, 4000);
  }
}

// 唤醒时声纹验证（在唤醒词检测到后调用）
// 返回 Promise<boolean> - 是否验证通过
async function verifyVoiceprintOnWake() {
  // 如果未启用声纹验证或未注册，直接通过
  if (!config.voiceprintEnabled || !voiceprintManager || !voiceprintManager.isRegistered()) {
    return true;
  }

  // 录一段音进行验证
  try {
    await voiceprintManager.startRecording();
    // 录制 2.5 秒
    await new Promise(resolve => setTimeout(resolve, 2500));
    const result = await voiceprintManager.stopRecording();

    if (result && result.valid) {
      const verifyResult = await voiceprintManager.verify(result.blob);
      return verifyResult.success && verifyResult.verified;
    }
    return false;
  } catch (err) {
    console.warn('[声纹] 唤醒验证失败:', err.message);
    return false;
  }
}

// 清理电话模式文本：移除 Markdown 格式、emoji、多余符号，适合纯文本显示和语音播放
function cleanPhoneText(text) {
  if (!text) return '';
  let result = text;

  // 移除 emoji 和特殊符号（保留中文、英文、数字、基本标点）
  result = result.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // 移除 Markdown 加粗/斜体标记 **text** *text* __text__ _text_
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');

  // 移除行内代码标记 `code`
  result = result.replace(/`(.+?)`/g, '$1');

  // 移除标题标记 ### ## #
  result = result.replace(/^#{1,6}\s*/gm, '');

  // 移除引用标记 >
  result = result.replace(/^>\s*/gm, '');

  // 移除分隔线 --- *** ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // 移除无序列表标记 - * + （行首）
  result = result.replace(/^[-*+]\s+/gm, '');

  // 移除有序列表标记 1. 2. 等（行首）
  result = result.replace(/^\d+\.\s+/gm, '');

  // 移除链接标记 [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 移除图片标记 ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 移除表格分隔线 |---|
  result = result.replace(/^\|?[-:|\s]+\|?\s*$/gm, '');

  // 移除表格竖线 |
  result = result.replace(/\|/g, ' ');

  // 合并多余空格
  result = result.replace(/[ \t]+/g, ' ');

  // 合并多余空行（最多保留一个空行）
  result = result.replace(/\n{3,}/g, '\n\n');

  // 移除行首行尾空格
  result = result.split('\n').map(line => line.trim()).join('\n');

  // 移除开头和结尾的空行
  result = result.trim();

  return result;
}

// 发送给大模型（流式，直接 fetch）
async function phoneSendToLLM(text) {
  phoneMode.isThinking = true;
  phoneUpdateStatus('thinking');

  // 添加用户消息到历史
  phoneMode.messages.push({ role: 'user', content: text });

  // 电话模式专用系统提示词：要求纯文本口语化回复，不使用任何 Markdown 格式
  // 名称/身份跟随当前 API 供应商
  const _pname = getActiveProviderName() || 'AI';
  let phoneSystemPrompt = `你是「${_pname}」，正在进行语音电话对话。请严格遵守以下规则：\n1. 用简洁自然的口语化中文回答，像真人打电话一样交流\n2. 绝对不要使用任何 Markdown 格式：不要用 **加粗**、不要用 # 标题、不要用 - 列表、不要用 --- 分隔线、不要用 | 表格、不要用 emoji 表情\n3. 回答要简短精炼，适合语音播报，不要太长\n4. 如果需要列举内容，用"第一、第二、第三"或"首先、其次、最后"等口语化表达，不要用符号列表\n5. 不要输出代码块、不要输出特殊符号`;

  // 如果开启了联网搜索，添加联网搜索能力说明
  if (config.webSearchEnabled) {
    phoneSystemPrompt += '\n\n6. 你现在具备联网搜索能力！当用户询问实时信息（如新闻、天气、价格、地点等）时，系统会自动联网搜索，你可以基于搜索结果回答。';
  }

  const apiMessages = [
    { role: 'system', content: phoneSystemPrompt },
    ...phoneMode.messages,
  ];

  // 构建请求体
  const requestBody = {
    model: config.model || 'mimo-v2.5-pro',
    messages: apiMessages,
    stream: true,
  };

  // 如果开启了联网搜索，添加 tools 参数
  if (config.webSearchEnabled) {
    requestBody.tools = [{
      type: 'web_search',
      max_keyword: config.webSearchMaxKeyword || 3,
      force_search: true,
      limit: 5,
    }];
    requestBody.tool_choice = 'auto';
  }

  // 创建助手消息元素（流式显示）
  const assistantMsgEl = phoneAddMessage('assistant', '');
  assistantMsgEl.classList.add('streaming');

  let fullContent = '';
  phoneMode.abortController = new AbortController();

  try {
    const url = `${(config.baseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: phoneMode.abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!phoneMode.active) {
        await reader.cancel();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            // 实时清理 Markdown 格式后显示
            assistantMsgEl.textContent = cleanPhoneText(fullContent);
            phoneScrollToBottom();
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // 用户挂断，正常退出
      return;
    }
    assistantMsgEl.textContent = '（回复失败：' + (err.message || '未知错误') + '）';
    phoneAddSystemMsg('回复失败，请重试');
  }

  assistantMsgEl.classList.remove('streaming');
  phoneMode.isThinking = false;
  phoneMode.abortController = null;

  // 使用清理后的纯文本（移除 Markdown 格式）
  const cleanContent = cleanPhoneText(fullContent);
  assistantMsgEl.textContent = cleanContent;

  // 保存助手回复到历史（保存清理后的文本）
  if (cleanContent) {
    phoneMode.messages.push({ role: 'assistant', content: cleanContent });
  }

  // TTS 播放回复（使用清理后的文本）
  if (cleanContent && phoneMode.tts && phoneMode.active) {
    await phoneSpeak(cleanContent);
  } else if (phoneMode.active) {
    phoneUpdateStatus('connected');
    // 没有内容可播放，直接开始下一轮
    setTimeout(() => phoneStartListening(), 300);
  }
}

// TTS 播放
async function phoneSpeak(text) {
  if (!phoneMode.tts || !phoneMode.active) return;

  phoneMode.isSpeaking = true;
  phoneUpdateStatus('speaking');

  try {
    await phoneMode.tts.speak(text, {
      onStart: () => {
        phoneUpdateStatus('speaking');
      },
      onEnd: () => {
        phoneMode.isSpeaking = false;
        if (phoneMode.active) {
          phoneUpdateStatus('connected');
          // 播放完毕，自动开始下一轮监听
          setTimeout(() => phoneStartListening(), 300);
        }
      },
      onError: (err) => {
        phoneMode.isSpeaking = false;
        phoneAddSystemMsg('语音播放失败：' + (err.message || '未知错误'));
        if (phoneMode.active) {
          phoneUpdateStatus('connected');
          setTimeout(() => phoneStartListening(), 300);
        }
      },
    });
  } catch (err) {
    phoneMode.isSpeaking = false;
    if (phoneMode.active) {
      phoneUpdateStatus('connected');
      setTimeout(() => phoneStartListening(), 300);
    }
  }
}

// 添加消息到通话界面
function phoneAddMessage(role, text) {
  const msgEl = document.createElement('div');
  msgEl.className = `phone-msg ${role}`;
  msgEl.textContent = text;
  phoneMessagesEl.appendChild(msgEl);
  phoneScrollToBottom();
  return msgEl;
}

// 添加系统消息
function phoneAddSystemMsg(text) {
  const msgEl = document.createElement('div');
  msgEl.className = 'phone-system-msg';
  msgEl.textContent = text;
  phoneMessagesEl.appendChild(msgEl);
  phoneScrollToBottom();
}

// 更新通话状态
function phoneUpdateStatus(status) {
  const statusTexts = {
    connected: '通话中 · 等待说话',
    listening: '正在聆听...',
    thinking: '正在思考...',
    speaking: '正在说话...',
  };
  phoneStatus.textContent = statusTexts[status] || '通话中';
  phoneStatus.className = 'phone-status ' + (status !== 'connected' ? status : '');
}

// 滚动到底部
function phoneScrollToBottom() {
  phoneMessagesEl.scrollTop = phoneMessagesEl.scrollHeight;
}

// ========================================
// 窗口控制
// ========================================
btnMinimize.addEventListener('click', () => window.api.minimize());
btnMaximize.addEventListener('click', () => window.api.maximize());
btnClose.addEventListener('click', () => window.api.close());

// 窗口置顶
const btnPin = $('#btn-pin');
if (btnPin) {
  btnPin.addEventListener('click', async () => {
    const isTop = await window.api.toggleAlwaysOnTop();
    btnPin.classList.toggle('active', isTop);
    btnPin.title = isTop ? '取消置顶' : '窗口置顶';
  });
  // 初始化置顶状态
  window.api.isAlwaysOnTop().then(isTop => {
    btnPin.classList.toggle('active', isTop);
  });
}

function updateMaximizeButton(isMaximized) {
  if (isMaximized) {
    btnMaximize.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v3a2 2 0 0 1-2 2H3"></path>
        <path d="M21 8h-3a2 2 0 0 1-2-2V3"></path>
        <path d="M3 16h3a2 2 0 0 1 2 2v3"></path>
        <path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
      </svg>
    `;
    btnMaximize.title = '还原';
  } else {
    btnMaximize.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      </svg>
    `;
    btnMaximize.title = '最大化';
  }
}

// ========================================
// 侧边栏事件
// ========================================
btnNewConv.addEventListener('click', () => createConversation());

// ========================================
// 设置面板
// ========================================
// 长期记忆（本地向量记忆库）
// ========================================
async function refreshMemoryStats() {
  const el = $('#memory-stats');
  if (!el || !window.api.memory) return;
  try {
    const s = await window.api.memory.stats();
    el.textContent = s.ready
      ? `📚 已存 ${s.count} 条记忆 · 向量维度 ${s.dim} · 嵌入方式 ${s.embedder}`
      : '📚 记忆库尚未就绪';
  } catch (e) {
    el.textContent = '📚 记忆库状态读取失败：' + e.message;
  }
}

async function testMemorySearch() {
  const el = $('#memory-stats');
  if (!window.api.memory) return;
  const q = prompt('输入一句话，测试能从记忆库里召回什么：', '我的服务器和域名');
  if (!q) return;
  try {
    const hits = await window.api.memory.search(q, { topK: 5, minScore: 0 });
    if (!hits.length) {
      el.textContent = '🔍 记忆库为空或未匹配到内容';
      return;
    }
    const lines = hits.map((h, i) => `${i + 1}. [${(h.score * 100).toFixed(1)}%] ${h.text}`);
    el.innerHTML = '🔍 召回结果：<br>' + lines.map(l => l.replace(/</g, '&lt;')).join('<br>');
  } catch (e) {
    el.textContent = '🔍 测试失败：' + e.message;
  }
}

async function clearMemoryStore() {
  if (!window.api.memory) return;
  if (!confirm('确定清空本地记忆库？此操作不可撤销。')) return;
  try {
    await window.api.memory.clear();
    alert('记忆库已清空');
    refreshMemoryStats();
  } catch (e) {
    alert('清空失败：' + e.message);
  }
}

// ========================================
btnSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

btnSaveCfg.addEventListener('click', async () => {
  config = {
    ...config,
    apiKey: $('#cfg-apikey').value.trim(),
    baseUrl: $('#cfg-baseurl').value.trim() || 'https://api.xiaomimimo.com/v1',
    model: $('#cfg-model').value.trim() || 'mimo-v2.5-pro',
    systemPrompt: $('#cfg-system').value.trim(),
    showSystemResults: $('#cfg-show-system-results')?.checked || false,
    webSearchEnabled: $('#cfg-web-search')?.checked || false,
    webSearchMaxKeyword: parseInt($('#cfg-web-search-maxkeyword')?.value) || 3,
    memoryEnabled: $('#cfg-memory-enabled')?.checked ?? true,
    memoryTopK: parseInt($('#cfg-memory-topk')?.value) || 5,
    embeddingModel: $('#cfg-memory-embedding-model')?.value.trim() || '',
    globalShortcut: $('#cfg-shortcut')?.value.trim() || 'Ctrl+Alt+M',
    quickActionShortcut: $('#cfg-quick-shortcut')?.value.trim() || 'Ctrl+Alt+Q',
    closeBehavior: document.querySelector('input[name="close-behavior"]:checked')?.value || 'tray',
    sttConfig: {
      apiUrl: $('#cfg-stt-url').value.trim(),
      apiKey: $('#cfg-stt-key').value.trim(),
      model: $('#cfg-stt-model').value.trim() || 'whisper-1',
      language: $('#cfg-stt-lang').value.trim() || 'zh',
    },
    wakeWordEnabled: $('#cfg-wake-enabled')?.checked || false,
    wakeWord: $('#cfg-wake-word')?.value.trim() || 'bot',
    wakeWordResponse: $('#cfg-wake-response')?.value.trim() || '我在',
    wakeProvider: $('#cfg-wake-provider')?.value || 'bot',
    wakeAlternatives: $('#cfg-wake-alternatives')?.value.trim() || '',
    voiceprintEnabled: $('#cfg-voiceprint-enabled')?.checked || false,
    voiceprintThreshold: parseInt($('#cfg-voiceprint-threshold')?.value) || 82,
    voiceprintData: voiceprintManager ? voiceprintManager.exportData() : (config.voiceprintData || null),
  };
  await window.api.saveConfig(config);

  // 长期记忆配置变更后重建记忆库（如切换了嵌入模型）
  try {
    if (window.api.memory) await window.api.memory.reconfigure();
  } catch (e) {
    console.warn('重建记忆库失败:', e.message);
  }

  // 注册全局快捷键
  if (config.globalShortcut) {
    const result = await window.api.registerShortcut(config.globalShortcut);
    const statusEl = $('#shortcut-status');
    if (statusEl) {
      if (result.success) {
        statusEl.textContent = `✅ 快捷键 ${config.globalShortcut} 已生效`;
        statusEl.className = 'shortcut-status success';
      } else {
        statusEl.textContent = `❌ ${result.error || '快捷键注册失败'}`;
        statusEl.className = 'shortcut-status error';
      }
    }
  }

  if (voiceManager) {
    voiceManager.destroy();
    voiceManager = null;
  }
  initVoiceModule();

  // 唤醒词配置变更后重启监听
  if (config.wakeWordEnabled && config.apiKey) {
    if (wakeWordActive) {
      // 已在运行，先停止再重启（应用新唤醒词）
      stopWakeWordListening();
      setTimeout(() => startWakeWordListening(), 300);
    } else {
      startWakeWordListening();
    }
  } else if (!config.wakeWordEnabled && wakeWordActive) {
    stopWakeWordListening();
  }

  // 更新声纹阈值
  if (voiceprintManager && config.voiceprintThreshold) {
    voiceprintManager.setThreshold(config.voiceprintThreshold / 100);
  }

  settingsPanel.classList.add('hidden');
});

btnCancelCfg.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  $('#cfg-apikey').value = config.apiKey || '';
  $('#cfg-baseurl').value = config.baseUrl || '';
  $('#cfg-model').value = config.model || '';
  $('#cfg-system').value = config.systemPrompt || '';
  if ($('#cfg-show-system-results')) {
    $('#cfg-show-system-results').checked = config.showSystemResults || false;
  }
  if ($('#cfg-web-search')) {
    $('#cfg-web-search').checked = config.webSearchEnabled || false;
  }
  if ($('#cfg-web-search-maxkeyword')) {
    $('#cfg-web-search-maxkeyword').value = config.webSearchMaxKeyword || 3;
  }
  if ($('#cfg-memory-enabled')) {
    $('#cfg-memory-enabled').checked = config.memoryEnabled !== false;
  }
  if ($('#cfg-memory-topk')) {
    $('#cfg-memory-topk').value = config.memoryTopK || 5;
  }
  if ($('#cfg-memory-embedding-model')) {
    $('#cfg-memory-embedding-model').value = config.embeddingModel || '';
  }
  if ($('#cfg-shortcut')) {
    $('#cfg-shortcut').value = config.globalShortcut || 'Ctrl+Alt+M';
  }
  if ($('#cfg-quick-shortcut')) {
    $('#cfg-quick-shortcut').value = config.quickActionShortcut || 'Ctrl+Alt+Q';
  }
  // 设置关闭窗口行为
  const closeBehavior2 = config.closeBehavior || 'tray';
  const closeRadio2 = document.querySelector(`input[name="close-behavior"][value="${closeBehavior2}"]`);
  if (closeRadio2) closeRadio2.checked = true;
  const statusEl = $('#shortcut-status');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.className = 'shortcut-status';
  }
  // 恢复唤醒词配置
  if ($('#cfg-wake-enabled')) {
    $('#cfg-wake-enabled').checked = config.wakeWordEnabled || false;
  }
  if ($('#cfg-wake-word')) {
    $('#cfg-wake-word').value = config.wakeWord || 'bot';
  }
  if ($('#cfg-wake-response')) {
    $('#cfg-wake-response').value = config.wakeWordResponse || '我在';
  }
  if ($('#cfg-wake-provider')) {
    $('#cfg-wake-provider').value = config.wakeProvider || 'bot';
  }
  if ($('#cfg-wake-alternatives')) {
    $('#cfg-wake-alternatives').value = config.wakeAlternatives || '';
  }
  // 恢复声纹配置
  if ($('#cfg-voiceprint-enabled')) {
    $('#cfg-voiceprint-enabled').checked = config.voiceprintEnabled || false;
  }
  if ($('#cfg-voiceprint-threshold')) {
    $('#cfg-voiceprint-threshold').value = config.voiceprintThreshold || 82;
  }
  updateVoiceprintUI();
});

// ========================================
// Windows 命令执行
// ========================================
async function executeCmd(btn, command) {
  const resultDiv = btn.parentElement.querySelector('.cmd-result');
  const decoded = command.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  // 角色工具权限检查
  if (!isToolAllowed('command')) {
    resultDiv.innerHTML = '<div class="cmd-status cmd-cancel">⊘ 当前角色不允许执行系统命令</div>';
    return;
  }

  const confirmed = await window.api.winConfirm(decoded);
  if (!confirmed) {
    resultDiv.innerHTML = '<div class="cmd-status cmd-cancel">已取消</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ 执行中...';
  resultDiv.innerHTML = '<div class="cmd-status cmd-running">正在执行...</div>';

  const res = await window.api.winExec(decoded);

  if (res.success) {
    const output = res.output || '（无输出）';
    resultDiv.innerHTML = `<div class="cmd-status cmd-success">✓ 执行成功</div><pre class="cmd-output">${escapeHtml(output)}</pre>`;
    btn.textContent = '✓ 已执行';
    // 添加到输出面板
    outputPanel.addCommand(decoded, output, true);
  } else {
    resultDiv.innerHTML = `<div class="cmd-status cmd-error">✗ 执行失败</div><pre class="cmd-output">${escapeHtml(res.output)}</pre>`;
    btn.textContent = '✗ 失败';
    btn.disabled = false;
    btn.onclick = () => executeCmd(btn, command);
    btn.textContent = '▶ 重试';
    // 添加到输出面板
    outputPanel.addCommand(decoded, res.output, false);
  }
}

// ========================================
// 文件操作自动执行
// ========================================
function getFileOpData(blockEl) {
  const b64 = blockEl.getAttribute('data-op');
  if (!b64) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) {
    return null;
  }
}

function updateFileOpStatus(blockEl, statusClass, text) {
  const statusEl = blockEl.querySelector('.file-op-status-text');
  if (statusEl) {
    statusEl.className = `file-op-status-text ${statusClass}`;
    statusEl.textContent = text;
  }
}

function renderFileResult(blockEl, op, result) {
  const resultEl = blockEl.querySelector('.file-op-result');
  if (!resultEl) return;

  if (!result.success) {
    resultEl.innerHTML = `<div class="file-result file-result-error">
      <div class="file-result-title">✗ 操作失败</div>
      <div class="file-result-detail">${escapeHtml(result.error || '未知错误')}</div>
    </div>`;
    updateFileOpStatus(blockEl, 'status-error', '✗ 执行失败');
    const retryBtn = document.createElement('button');
    retryBtn.className = 'file-op-retry';
    retryBtn.textContent = '▶ 重试';
    retryBtn.onclick = () => executeFileOp(blockEl);
    resultEl.appendChild(retryBtn);
    // 添加到输出面板
    outputPanel.addFileOperation(op.action, op.path || op.source || '', result.error || '未知错误', false);
    return;
  }

  updateFileOpStatus(blockEl, 'status-success', '✓ 执行成功');

  let html = '';

  switch (op.action) {
    case 'read': {
      const content = result.content || '';
      const size = content.length;
      const preview = content.length > 3000 ? content.slice(0, 3000) + '\n\n... (内容已截断，完整内容已在本地文件中)' : content;
      html = `<div class="file-result file-result-read">
        <div class="file-result-title">📖 文件内容（${size} 字符）</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
        <pre class="file-content-preview">${escapeHtml(preview)}</pre>
        <div class="file-result-actions">
          <button class="file-action-btn" onclick="copyText(this, \`${escapeHtml(content).replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">📋 复制内容</button>
          ${result.path ? `<button class="file-action-btn" onclick="openFile(this, '${escapeHtml(result.path).replace(/'/g, "\\'")}')">📂 打开文件</button>` : ''}
        </div>
      </div>`;
      break;
    }
    case 'write':
    case 'append': {
      const bytes = result.bytes || result.appended || '?';
      html = `<div class="file-result file-result-write">
        <div class="file-result-title">✓ ${op.action === 'write' ? '文件已保存' : '内容已追加'}</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
        <div class="file-result-meta">大小：${bytes} 字节</div>
        <div class="file-result-actions">
          ${result.path ? `<button class="file-action-btn" onclick="openFile(this, '${escapeHtml(result.path).replace(/'/g, "\\'")}')">📂 打开文件</button>` : ''}
          <button class="file-action-btn" onclick="openFolder(this, '${escapeHtml(result.path || op.path).replace(/'/g, "\\'")}')">📁 打开所在文件夹</button>
        </div>
      </div>`;
      break;
    }
    case 'list': {
      const items = result.items || [];
      let rows = items.map(item => {
        const size = item.is_dir ? '—' : formatFileSize(item.size);
        const icon = item.is_dir ? '📁' : '📄';
        const modified = item.modified ? new Date(item.modified * 1000).toLocaleString('zh-CN') : '';
        return `<tr>
          <td>${icon}</td>
          <td class="file-list-name">${escapeHtml(item.name)}</td>
          <td class="file-list-size">${size}</td>
          <td class="file-list-time">${escapeHtml(modified)}</td>
        </tr>`;
      }).join('');
      if (!rows) rows = '<tr><td colspan="4" class="file-list-empty">（空目录）</td></tr>';
      html = `<div class="file-result file-result-list">
        <div class="file-result-title">📂 目录内容（共 ${items.length} 项）</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
        <table class="file-list-table">
          <thead><tr><th></th><th>名称</th><th>大小</th><th>修改时间</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
      break;
    }
    case 'copy': {
      html = `<div class="file-result file-result-copy">
        <div class="file-result-title">✓ 文件已复制</div>
        <div class="file-result-meta">源：${escapeHtml(result.source || op.source)}</div>
        <div class="file-result-meta">目标：${escapeHtml(result.dest || op.dest)}</div>
      </div>`;
      break;
    }
    case 'rename': {
      html = `<div class="file-result file-result-rename">
        <div class="file-result-title">✓ 文件已重命名</div>
        <div class="file-result-meta">原路径：${escapeHtml(result.old_path || op.source)}</div>
        <div class="file-result-meta">新路径：${escapeHtml(result.new_path || op.dest)}</div>
      </div>`;
      break;
    }
    case 'delete': {
      html = `<div class="file-result file-result-delete">
        <div class="file-result-title">✓ 文件已删除</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
      </div>`;
      break;
    }
    case 'open': {
      html = `<div class="file-result file-result-open">
        <div class="file-result-title">✓ 已用默认程序打开</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
      </div>`;
      break;
    }
    case 'mkdir': {
      html = `<div class="file-result file-result-mkdir">
        <div class="file-result-title">✓ 目录已创建</div>
        <div class="file-result-meta">路径：${escapeHtml(result.path || op.path)}</div>
      </div>`;
      break;
    }
    default:
      html = `<div class="file-result"><div class="file-result-title">✓ 操作完成</div><pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre></div>`;
  }

  resultEl.innerHTML = html;

  // 添加到输出面板
  const actionNames = {
    read: '读取文件', write: '写入文件', append: '追加内容',
    list: '列出目录', copy: '复制文件', rename: '重命名',
    delete: '删除文件', open: '打开文件', mkdir: '创建目录',
  };
  const path = result.path || op.path || op.source || '';
  let summary = '';
  switch (op.action) {
    case 'read':
      summary = `读取 ${(result.content || '').length} 字符`;
      break;
    case 'write':
    case 'append':
      summary = `写入 ${result.bytes || result.appended || '?'} 字节`;
      break;
    case 'list':
      summary = `共 ${(result.items || []).length} 项`;
      break;
    case 'copy':
      summary = `从 ${result.source || op.source} 到 ${result.dest || op.dest}`;
      break;
    case 'rename':
      summary = `${result.old_path || op.source} → ${result.new_path || op.dest}`;
      break;
    default:
      summary = actionNames[op.action] || op.action;
  }
  outputPanel.addFileOperation(op.action, path, summary, true);
}

function formatFileSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function executeFileOp(blockEl) {
  const op = getFileOpData(blockEl);
  if (!op) {
    blockEl.classList.remove('file-op-hidden');
    updateFileOpStatus(blockEl, 'status-error', '✗ 操作数据解析失败');
    return;
  }

  // 角色工具权限检查
  if (!isToolAllowed('file')) {
    blockEl.classList.remove('file-op-hidden');
    updateFileOpStatus(blockEl, 'status-cancel', '⊘ 当前角色不允许文件操作');
    return { op, result: { success: false, error: '当前角色不允许文件操作' } };
  }

  const resultEl = blockEl.querySelector('.file-op-result');
  if (resultEl) resultEl.innerHTML = '';

  updateFileOpStatus(blockEl, 'status-running', '⏳ 正在执行...');

  try {
    const risk = await window.api.file.checkRisk(op.action, op);

    if (risk.highRisk) {
      // 高危操作需要用户确认，先显示卡片让用户感知
      blockEl.classList.remove('file-op-hidden');
      updateFileOpStatus(blockEl, 'status-pending', '⚠️ 等待用户确认...');
      const confirmed = await window.api.file.confirm(op.action, op, risk.reasons);
      if (!confirmed) {
        updateFileOpStatus(blockEl, 'status-cancel', '⊘ 用户已取消');
        return { op, result: { success: false, error: '用户已取消' } };
      }
      updateFileOpStatus(blockEl, 'status-running', '⏳ 正在执行...');
    }

    const result = await window.api.file.execute(op.action, op);
    renderFileResult(blockEl, op, result);
    // 失败时显示卡片，成功时保持隐藏（由 AI 自然语言回复告知用户）
    if (!result.success) {
      blockEl.classList.remove('file-op-hidden');
    }
    return { op, result };

  } catch (err) {
    blockEl.classList.remove('file-op-hidden');
    updateFileOpStatus(blockEl, 'status-error', '✗ 执行异常');
    if (resultEl) {
      resultEl.innerHTML = `<div class="file-result file-result-error">
        <div class="file-result-title">✗ 执行异常</div>
        <div class="file-result-detail">${escapeHtml(err.message || String(err))}</div>
      </div>`;
    }
    return { op, result: { success: false, error: err.message || String(err) } };
  }
}

async function processFileOps(containerEl) {
  const blocks = containerEl.querySelectorAll('.file-op-block');
  if (blocks.length === 0) return [];

  const results = [];
  for (const block of blocks) {
    if (block.querySelector('.file-result')) continue;
    if (block.classList.contains('file-op-error')) continue;
    const r = await executeFileOp(block);
    if (r) results.push(r);
  }
  return results;
}

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {
    btn.textContent = '✗ 复制失败';
  });
}

async function openFile(btn, filePath) {
  btn.textContent = '⏳ 打开中...';
  const result = await window.api.file.open(filePath);
  if (result.success) {
    btn.textContent = '✓ 已打开';
  } else {
    btn.textContent = '✗ 打开失败';
  }
}

async function openFolder(btn, filePath) {
  const folder = filePath.replace(/[\\\/][^\\\/]+$/, '');
  btn.textContent = '⏳ 打开中...';
  const result = await window.api.winExec(`explorer.exe /select,"${filePath}"`);
  if (result.success) {
    btn.textContent = '✓ 已打开';
  } else {
    btn.textContent = '✗ 打开失败';
  }
}

// ========================================
// 输出面板管理器
// ========================================
const outputPanel = {
  el: null,
  stripEl: null,
  closeBtn: null,
  clearBtn: null,
  tabs: {},
  contents: {},
  activeTab: 'terminal',
  hasAutoShown: false,  // 是否已自动弹出过（首次）
  isExpanded: false,    // 是否完全展开
  isPeeking: false,     // 是否半展开（冒个头）
  hoverTimer: null,

  init() {
    this.el = document.getElementById('output-panel');
    this.stripEl = document.getElementById('output-strip');
    this.closeBtn = document.getElementById('output-close');
    this.clearBtn = document.getElementById('output-clear');

    // 标签页
    document.querySelectorAll('.output-tab').forEach(tab => {
      const name = tab.dataset.tab;
      this.tabs[name] = tab;
      this.contents[name] = document.getElementById('output-' + name);
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchTab(name);
      });
    });

    // 关闭按钮 → 完全收起为提示条
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.collapse();
      });
    }

    // 清空按钮
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearActive();
      });
    }

    // 提示条：悬停 → 半展开（冒个头），单击 → 完全展开
    if (this.stripEl) {
      this.stripEl.addEventListener('mouseenter', () => this.peek());
      this.stripEl.addEventListener('mouseleave', () => {
        // 从提示条移开，如果只是半展开状态，则完全收起
        if (this.isPeeking && !this.isExpanded) {
          this.hoverTimer = setTimeout(() => this.collapse(), 200);
        }
      });
      this.stripEl.addEventListener('click', () => this.expand());
    }

    // 面板：半展开状态下单击 → 完全展开
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        // 只有半展开状态下，点击面板区域才完全展开
        // 完全展开状态下不处理（避免影响内部按钮）
        if (this.isPeeking && !this.isExpanded) {
          this.expand();
        }
      });

      this.el.addEventListener('mouseenter', () => {
        if (this.hoverTimer) {
          clearTimeout(this.hoverTimer);
          this.hoverTimer = null;
        }
      });

      this.el.addEventListener('mouseleave', () => {
        // 完全展开后移开鼠标 → 回退到半展开（冒个头）
        if (this.isExpanded) {
          this.hoverTimer = setTimeout(() => this.peek(), 300);
        }
      });
    }
  },

  // 半展开（冒个头，只显示标题栏）
  peek() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.el) {
      this.el.classList.remove('hidden');
      this.el.classList.add('peek');
    }
    if (this.stripEl) this.stripEl.classList.add('hidden');
    this.isPeeking = true;
    this.isExpanded = false;
  },

  // 完全展开面板
  expand() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.el) {
      this.el.classList.remove('hidden');
      this.el.classList.remove('peek');
    }
    if (this.stripEl) this.stripEl.classList.add('hidden');
    this.isExpanded = true;
    this.isPeeking = false;
    // 滚动到底部
    this.scrollToBottom();
  },

  // 完全收起为提示条
  collapse() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.el) {
      this.el.classList.add('hidden');
      this.el.classList.remove('peek');
    }
    if (this.stripEl) this.stripEl.classList.remove('hidden');
    this.isExpanded = false;
    this.isPeeking = false;
    // 移除闪烁
    if (this.stripEl) this.stripEl.classList.remove('has-new');
  },

  // 首次有输出时自动弹出
  autoShowIfFirst() {
    if (!this.hasAutoShown) {
      this.hasAutoShown = true;
      this.expand();
    } else if (!this.isExpanded) {
      // 已经弹出过但当前收起，提示条闪烁
      if (this.stripEl) {
        this.stripEl.classList.add('has-new');
        setTimeout(() => {
          if (this.stripEl) this.stripEl.classList.remove('has-new');
        }, 1500);
      }
    }
  },

  // 切换标签页
  switchTab(name) {
    this.activeTab = name;
    Object.keys(this.tabs).forEach(k => {
      this.tabs[k].classList.toggle('active', k === name);
      this.contents[k].classList.toggle('active', k === name);
    });
    this.scrollToBottom();
  },

  // 添加输出项
  addItem(tab, title, body, type = 'default') {
    const container = this.contents[tab];
    if (!container) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const item = document.createElement('div');
    item.className = `output-item output-item-${type}`;
    item.innerHTML = `
      <div class="output-item-header">
        <span class="output-item-title">${escapeHtml(title)}</span>
        <span class="output-item-time">${timeStr}</span>
      </div>
      <div class="output-item-body">${body}</div>
    `;
    container.appendChild(item);

    // 如果当前标签页是激活的，滚动到底部
    if (this.activeTab === tab) {
      this.scrollToBottom();
    }

    // 自动弹出（首次）
    this.autoShowIfFirst();
  },

  // 添加命令输出
  addCommand(command, output, success = true) {
    const body = `
      <div class="cmd-command">$ ${escapeHtml(command)}</div>
      <div class="cmd-output">${escapeHtml(output || '（无输出）')}</div>
    `;
    this.addItem('terminal', success ? '命令执行成功' : '命令执行失败', body, success ? 'success' : 'error');
  },

  // 添加文件操作输出
  addFileOperation(action, path, result, success = true) {
    const actionNames = {
      read: '读取文件', write: '写入文件', append: '追加内容',
      list: '列出目录', copy: '复制文件', rename: '重命名',
      delete: '删除文件', open: '打开文件', mkdir: '创建目录',
    };
    const title = actionNames[action] || action;
    const body = `
      <div>路径：${escapeHtml(path)}</div>
      <div class="cmd-output">${escapeHtml(result || '（无输出）')}</div>
    `;
    this.addItem('file', success ? `${title}成功` : `${title}失败`, body, 'file');
  },

  // 添加日志
  addLog(message, type = 'default') {
    this.addItem('log', '系统日志', escapeHtml(message), type);
  },

  // 清空当前标签页
  clearActive() {
    const container = this.contents[this.activeTab];
    if (container) container.innerHTML = '';
  },

  // 滚动到底部
  scrollToBottom() {
    const container = this.contents[this.activeTab];
    if (container) container.scrollTop = container.scrollHeight;
  },
};

// ========================================
// 多轮 Agent 循环
// ========================================
const MAX_AGENT_TURNS = 8;

function buildApiMessages() {
  const apiMessages = [];
  const systemPrompt = getAgentSystemPrompt();
  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }
  apiMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
  return apiMessages;
}

function callAIStream(apiMessages, streamEl) {
  return new Promise((resolve, reject) => {
    let fullContent = '';
    let settled = false;
    let webSources = [];

    if (removeChunkListener) removeChunkListener();
    removeChunkListener = window.api.onChunk((data) => {
      if (data.done) {
        if (!settled) {
          settled = true;
          // 如果有搜索来源，在回复末尾添加来源引用
          if (webSources.length > 0) {
            appendWebSources(streamEl, webSources);
          }
          resolve(fullContent);
        }
        return;
      }
      if (data.content) {
        fullContent += data.content;
        updateStreamingMessage(streamEl, fullContent);
      }
      // 接收搜索来源
      if (data.sources && Array.isArray(data.sources)) {
        webSources = [...webSources, ...data.sources];
      }
    });

    window.api.chat(apiMessages, config).then((result) => {
      if (!result.success && !settled) {
        settled = true;
        reject(new Error(result.error || '请求失败'));
      }
    }).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

// 在回复末尾添加搜索来源引用
function appendWebSources(streamEl, sources) {
  if (!streamEl || sources.length === 0) return;
  const bubble = streamEl.querySelector('.bubble');
  if (!bubble) return;

  // 去重
  const uniqueSources = [];
  const seenUrls = new Set();
  for (const s of sources) {
    if (s.url && !seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      uniqueSources.push(s);
    }
  }
  if (uniqueSources.length === 0) return;

  const sourcesHtml = `
    <div class="web-sources">
      <div class="web-sources-title">🔍 搜索来源（${uniqueSources.length}）</div>
      <div class="web-sources-list">
        ${uniqueSources.map((s, i) => `
          <a class="web-source-item" href="${s.url}" target="_blank" rel="noopener">
            <span class="web-source-index">${i + 1}</span>
            <span class="web-source-title">${escapeHtml(s.title || s.url)}</span>
            ${s.site_name ? `<span class="web-source-site">${escapeHtml(s.site_name)}</span>` : ''}
          </a>
        `).join('')}
      </div>
    </div>
  `;
  bubble.insertAdjacentHTML('beforeend', sourcesHtml);
}

function formatToolResultsMessage(results) {
  const parts = results.map(({ op, result }) => {
    if (!result.success) {
      return `【操作失败】${op.action} — ${result.error || '未知错误'}`;
    }
    switch (op.action) {
      case 'read':
        return `【读取成功】路径：${result.path || op.path}\n文件内容：\n${result.content || '(空文件)'}`;
      case 'write':
        return `【写入成功】路径：${result.path || op.path}，大小：${result.bytes || '?'} 字节`;
      case 'append':
        return `【追加成功】路径：${result.path || op.path}`;
      case 'list': {
        const items = (result.items || []).map((i) =>
          `${i.is_dir ? '[目录]' : '[文件]'} ${i.name} (${i.size || 0} 字节)`
        ).join('\n');
        return `【目录列表】路径：${result.path || op.path}\n${items || '(空目录)'}`;
      }
      case 'copy':
        return `【复制成功】${result.source || op.source} → ${result.dest || op.dest}`;
      case 'rename':
        return `【重命名成功】${result.old_path || op.source} → ${result.new_path || op.dest}`;
      case 'delete':
        return `【删除成功】路径：${result.path || op.path}`;
      case 'open':
        return `【打开成功】路径：${result.path || op.path}`;
      case 'mkdir':
        return `【创建目录成功】路径：${result.path || op.path}`;
      default:
        return `【操作成功】${op.action}`;
    }
  });

  return `[系统自动执行结果]\n${parts.join('\n\n')}\n\n以上是文件操作的执行结果。请基于结果继续完成用户请求：如需进一步操作，请继续输出 !!!file: 指令；如已完成，请直接用自然语言回答用户。`;
}

async function runAgentLoop() {
  if (agentLoopRunning) return;
  agentLoopRunning = true;
  userAborted = false;

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const streamEl = addStreamingMessage();
      const apiMessages = buildApiMessages();

      let fullContent;
      try {
        fullContent = await callAIStream(apiMessages, streamEl);
      } catch (err) {
        streamEl.remove();
        addErrorMessage(err.message);
        break;
      }

      if (!fullContent) {
        streamEl.remove();
        break;
      }

      // 保存 AI 回复到当前会话
      messages.push({ role: 'assistant', content: fullContent });
      if (currentConversationId !== MAIN_CONVERSATION_ID && messages.length > 40) {
        messages = messages.slice(-40);
      }
      saveCurrentConversation();

      // 检查是否包含文件操作指令
      if (fullContent.includes('!!!file:')) {
        await new Promise((r) => setTimeout(r, 300));
        const results = await processFileOps(streamEl);

        if (results && results.length > 0) {
          const resultMsg = formatToolResultsMessage(results);
          messages.push({ role: 'user', content: resultMsg });
          saveCurrentConversation();
          // 用户手动停止后，不再继续下一轮 AI 调用
          if (!userAborted) continue;
        }
      }

      break;
    }
  } finally {
    agentLoopRunning = false;
    isStreaming = false;
    setSendButtonState(false);
  }
}

// ========================================
// 初始化
// ========================================
(async () => {
  config = await window.api.loadConfig();
  initUpdateBanner();
  initProviderManager();
  initUpload();
  initAgentManager();
  await loadAgents();
  // 设置初始角色
  currentAgentId = config.defaultAgentId || 'default';
  updateAgentDisplay();
  renderAgentList();
  $('#cfg-apikey').value = config.apiKey || '';
  $('#cfg-baseurl').value = config.baseUrl || 'https://api.xiaomimimo.com/v1';
  $('#cfg-model').value = config.model || 'mimo-v2.5-pro';
  $('#cfg-system').value = config.systemPrompt || '';

  if (config.theme) {
    setTheme(config.theme);
  }

  // 设置关闭窗口行为
  const closeBehavior = config.closeBehavior || 'tray';
  const closeRadio = document.querySelector(`input[name="close-behavior"][value="${closeBehavior}"]`);
  if (closeRadio) closeRadio.checked = true;

  if (config.sttConfig) {
    $('#cfg-stt-url').value = config.sttConfig.apiUrl || '';
    $('#cfg-stt-key').value = config.sttConfig.apiKey || '';
    $('#cfg-stt-model').value = config.sttConfig.model || 'whisper-1';
    $('#cfg-stt-lang').value = config.sttConfig.language || 'zh';
  }

  // 加载唤醒词配置
  if ($('#cfg-wake-enabled')) {
    $('#cfg-wake-enabled').checked = config.wakeWordEnabled || false;
  }
  if ($('#cfg-wake-word')) {
    $('#cfg-wake-word').value = config.wakeWord || 'bot';
  }
  if ($('#cfg-wake-response')) {
    $('#cfg-wake-response').value = config.wakeWordResponse || '我在';
  }
  if ($('#cfg-wake-provider')) {
    $('#cfg-wake-provider').value = config.wakeProvider || 'bot';
  }
  if ($('#cfg-wake-alternatives')) {
    $('#cfg-wake-alternatives').value = config.wakeAlternatives || '';
  }

  // 加载声纹配置
  if ($('#cfg-voiceprint-enabled')) {
    $('#cfg-voiceprint-enabled').checked = config.voiceprintEnabled || false;
  }
  if ($('#cfg-voiceprint-threshold')) {
    $('#cfg-voiceprint-threshold').value = config.voiceprintThreshold || 82;
  }

  // 设置系统执行结果显示开关（默认关闭）
  if ($('#cfg-show-system-results')) {
    $('#cfg-show-system-results').checked = config.showSystemResults || false;
  }

  // 设置联网搜索配置
  if ($('#cfg-web-search')) {
    $('#cfg-web-search').checked = config.webSearchEnabled || false;
  }
  if ($('#cfg-web-search-maxkeyword')) {
    $('#cfg-web-search-maxkeyword').value = config.webSearchMaxKeyword || 3;
  }

  // 设置长期记忆配置
  if ($('#cfg-memory-enabled')) {
    $('#cfg-memory-enabled').checked = config.memoryEnabled !== false;
  }
  if ($('#cfg-memory-topk')) {
    $('#cfg-memory-topk').value = config.memoryTopK || 5;
  }
  if ($('#cfg-memory-embedding-model')) {
    $('#cfg-memory-embedding-model').value = config.embeddingModel || '';
  }
  refreshMemoryStats();
  const btnMemoryTest = $('#btn-memory-test');
  if (btnMemoryTest) btnMemoryTest.addEventListener('click', testMemorySearch);
  const btnMemoryClear = $('#btn-memory-clear');
  if (btnMemoryClear) btnMemoryClear.addEventListener('click', clearMemoryStore);

  // 设置全局快捷键配置
  if ($('#cfg-shortcut')) {
    $('#cfg-shortcut').value = config.globalShortcut || 'Ctrl+Alt+M';
  }
  // 设置选词助手快捷键
  if ($('#cfg-quick-shortcut')) {
    $('#cfg-quick-shortcut').value = config.quickActionShortcut || 'Ctrl+Alt+Q';
  }

  // 注册全局快捷键
  if (config.globalShortcut) {
    window.api.registerShortcut(config.globalShortcut);
  }

  // 快捷键录制功能
  const btnRecordShortcut = $('#btn-record-shortcut');
  const shortcutInput = $('#cfg-shortcut');
  if (btnRecordShortcut && shortcutInput) {
    let isRecording = false;
    btnRecordShortcut.addEventListener('click', () => {
      if (isRecording) {
        isRecording = false;
        btnRecordShortcut.textContent = '录制';
        shortcutInput.removeAttribute('data-recording');
        return;
      }
      isRecording = true;
      btnRecordShortcut.textContent = '停止';
      shortcutInput.value = '请按下快捷键...';
      shortcutInput.setAttribute('data-recording', 'true');
      shortcutInput.focus();
    });

    shortcutInput.addEventListener('keydown', (e) => {
      if (!shortcutInput.getAttribute('data-recording')) return;
      e.preventDefault();

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Meta');

      // 忽略纯修饰键
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();

      keys.push(key);
      const accelerator = keys.join('+');
      shortcutInput.value = accelerator;

      // 停止录制
      isRecording = false;
      btnRecordShortcut.textContent = '录制';
      shortcutInput.removeAttribute('data-recording');
    });
  }

  initVoiceModule();
  initPhoneMode();
  initWakeWordModule();
  initWakeTestButton();
  initVoiceprintModule();
  outputPanel.init();

  document.getElementById('voice-error-close').addEventListener('click', hideVoiceError);
  document.getElementById('btn-diagnose-voice').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
    runVoiceDiagnosis();
  });

  // 加载会话列表
  await loadConversations();

  // 默认打开主会话
  await switchConversation(MAIN_CONVERSATION_ID);

  // 无 API Key 时打开设置
  if (!config.apiKey) {
    settingsPanel.classList.remove('hidden');
  }

  // 监听最大化状态变化
  window.api.onMaximized((isMax) => {
    updateMaximizeButton(isMax);
  });
  const isMax = await window.api.isMaximized();
  updateMaximizeButton(isMax);

  // 监听托盘新建对话事件
  window.api.onTabNew(() => {
    createConversation();
  });
  // 监听托盘打开会话事件
  window.api.onTabOpen((conversationId) => {
    switchConversation(conversationId);
  });
})();

// 窗口关闭前保存当前会话
window.addEventListener('beforeunload', () => {
  saveCurrentConversationImmediate();
});

// ========================================
// 拖拽文件到窗口自动读取
// ========================================
const dragOverlay = $('#drag-overlay');

if (chatArea && dragOverlay) {
  chatArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.remove('hidden');
  });

  chatArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 只在离开 chatArea 时隐藏
    if (!chatArea.contains(e.relatedTarget)) {
      dragOverlay.classList.add('hidden');
    }
  });

  chatArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.add('hidden');

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const filePath = file.path;
      if (!filePath) continue;

      // 显示读取提示
      addMessage('system', `[系统自动执行结果] 正在读取文件：${filePath}`, false);

      try {
        // 调用文件读取
        const result = await window.api.file.read(filePath);
        if (result.success) {
          const fileContent = result.content || '';
          const fileName = filePath.split(/[\\/]/).pop();

          // 将文件内容作为用户消息发送给大模型
          const userMsg = `请帮我分析以下文件内容（${fileName}）：\n\n${fileContent}`;
          addMessage('user', userMsg);

          // 自动发送
          isStreaming = true;
          setSendButtonState(true);
          await runAgentLoop();
        } else {
          addErrorMessage(`读取文件失败：${result.error || '未知错误'}`);
        }
      } catch (err) {
        addErrorMessage(`读取文件出错：${err.message}`);
      }
    }
  });
}

// ========================================
// 历史消息搜索
// ========================================
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-count');
const searchPrev = document.getElementById('search-prev');
const searchNext = document.getElementById('search-next');
const searchClose = document.getElementById('search-close');
const btnSearch = document.getElementById('btn-search');

let searchMatches = [];  // 匹配的消息元素列表
let searchCurrentIdx = -1;

function openSearch() {
  if (!searchBar) return;
  searchBar.classList.remove('hidden');
  setTimeout(() => searchInput?.focus(), 50);
}

function closeSearch() {
  if (!searchBar) return;
  searchBar.classList.add('hidden');
  clearSearchHighlights();
  searchMatches = [];
  searchCurrentIdx = -1;
  if (searchInput) searchInput.value = '';
  if (searchCount) searchCount.textContent = '0 / 0';
}

function clearSearchHighlights() {
  // 移除消息高亮
  chatArea.querySelectorAll('.message.search-highlight').forEach(el => {
    el.classList.remove('search-highlight');
  });
  // 移除关键词高亮（恢复原始文本）
  chatArea.querySelectorAll('.search-keyword-highlight').forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
}

function highlightKeywordInElement(el, keyword) {
  if (!keyword) return;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent && regex.test(node.textContent)) {
      textNodes.push(node);
    }
  }
  textNodes.forEach(textNode => {
    const fragment = document.createDocumentFragment();
    const text = textNode.textContent;
    let lastIndex = 0;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }
      const span = document.createElement('span');
      span.className = 'search-keyword-highlight';
      span.textContent = match[0];
      fragment.appendChild(span);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

function executeSearch() {
  const keyword = searchInput?.value.trim();
  clearSearchHighlights();
  searchMatches = [];
  searchCurrentIdx = -1;

  if (!keyword) {
    if (searchCount) searchCount.textContent = '0 / 0';
    return;
  }

  // 遍历所有消息元素，查找包含关键词的
  const msgElements = chatArea.querySelectorAll('.message:not(.system-result)');
  msgElements.forEach(msgEl => {
    const bubble = msgEl.querySelector('.bubble');
    if (bubble && bubble.textContent.toLowerCase().includes(keyword.toLowerCase())) {
      searchMatches.push(msgEl);
      highlightKeywordInElement(bubble, keyword);
    }
  });

  if (searchCount) {
    searchCount.textContent = searchMatches.length > 0 ? `1 / ${searchMatches.length}` : `0 / ${searchMatches.length}`;
  }

  if (searchMatches.length > 0) {
    searchCurrentIdx = 0;
    highlightCurrentMatch();
  }
}

function highlightCurrentMatch() {
  // 移除所有消息高亮
  chatArea.querySelectorAll('.message.search-highlight').forEach(el => {
    el.classList.remove('search-highlight');
  });
  // 移除当前关键词标记
  chatArea.querySelectorAll('.search-keyword-highlight.current').forEach(el => {
    el.classList.remove('current');
  });

  if (searchCurrentIdx >= 0 && searchCurrentIdx < searchMatches.length) {
    const msgEl = searchMatches[searchCurrentIdx];
    msgEl.classList.add('search-highlight');
    // 标记当前匹配的第一个关键词
    const firstHighlight = msgEl.querySelector('.search-keyword-highlight');
    if (firstHighlight) firstHighlight.classList.add('current');
    // 滚动到可视区域
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (searchCount) {
      searchCount.textContent = `${searchCurrentIdx + 1} / ${searchMatches.length}`;
    }
  }
}

function searchGoNext() {
  if (searchMatches.length === 0) return;
  searchCurrentIdx = (searchCurrentIdx + 1) % searchMatches.length;
  highlightCurrentMatch();
}

function searchGoPrev() {
  if (searchMatches.length === 0) return;
  searchCurrentIdx = (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length;
  highlightCurrentMatch();
}

// 绑定搜索事件
if (btnSearch) {
  btnSearch.addEventListener('click', () => {
    if (searchBar.classList.contains('hidden')) {
      openSearch();
    } else {
      closeSearch();
    }
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchInput._searchTimer);
    searchInput._searchTimer = setTimeout(executeSearch, 200);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        searchGoPrev();
      } else {
        searchGoNext();
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });
}

if (searchPrev) searchPrev.addEventListener('click', searchGoPrev);
if (searchNext) searchNext.addEventListener('click', searchGoNext);
if (searchClose) searchClose.addEventListener('click', closeSearch);

// 全局快捷键 Ctrl+F
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    openSearch();
  }
});

// ========================================
// 导出对话为 Markdown
// ========================================
const btnExport = $('#btn-export');
const exportModal = $('#export-modal');
const btnExportCancel = $('#btn-export-cancel');
const btnExportConfirm = $('#btn-export-confirm');

if (btnExport && exportModal) {
  btnExport.addEventListener('click', () => {
    exportModal.classList.remove('hidden');
  });

  btnExportCancel.addEventListener('click', () => {
    exportModal.classList.add('hidden');
  });

  // 点击遮罩关闭
  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) {
      exportModal.classList.add('hidden');
    }
  });

  // 导出范围切换
  document.querySelectorAll('input[name="export-range"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const countOption = $('#export-count-option');
      if (countOption) {
        countOption.classList.toggle('hidden', radio.value !== 'recent');
      }
    });
  });

  btnExportConfirm.addEventListener('click', async () => {
    const range = document.querySelector('input[name="export-range"]:checked')?.value || 'all';
    const count = parseInt($('#export-count')?.value) || 20;
    const includeSystem = $('#export-include-system')?.checked || false;

    // 筛选消息
    let exportMessages = messages;
    if (!includeSystem) {
      exportMessages = messages.filter(m => !m.content?.includes('[系统自动执行结果]'));
    }
    if (range === 'recent') {
      exportMessages = exportMessages.slice(-count);
    }

    // 转换为 Markdown
    const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
    const convTitle = currentConversationId === MAIN_CONVERSATION_ID ? '主对话' : (currentConversation?.title || '对话');
    let md = `# ${convTitle} - 对话记录\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;

    exportMessages.forEach(msg => {
      const role = msg.role === 'user' ? '用户' : (msg.role === 'assistant' ? '助手' : '系统');
      md += `## ${role}\n\n${msg.content}\n\n---\n\n`;
    });

    // 导出文件
    const defaultName = `${convTitle}-${dateStr}.md`;
    try {
      const result = await window.api.exportMarkdown(md, defaultName);
      if (result.success) {
        exportModal.classList.add('hidden');
        // 显示成功提示
        const toast = document.createElement('div');
        toast.className = 'toast success';
        toast.textContent = `✅ 已导出至：${result.path}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
      } else if (!result.cancelled) {
        addErrorMessage(`导出失败：${result.error || '未知错误'}`);
      }
    } catch (err) {
      addErrorMessage(`导出出错：${err.message}`);
    }
  });
}

// ========================================
// 代码块复制按钮（在 formatContent 中添加）
// ========================================
// 为所有代码块添加复制按钮
function addCodeCopyButtons() {
  document.querySelectorAll('.message .bubble pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = '复制代码';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      await navigator.clipboard.writeText(text);
      copyBtn.innerHTML = '✓';
      copyBtn.title = '已复制';
      setTimeout(() => {
        copyBtn.innerHTML = '📋';
        copyBtn.title = '复制代码';
      }, 2000);
    });
    pre.appendChild(copyBtn);
  });
}

// 在消息更新后调用
const originalUpdateStreamingMessage = updateStreamingMessage;
updateStreamingMessage = function(el, text) {
  originalUpdateStreamingMessage(el, text);
  addCodeCopyButtons();
};

// 监听 DOM 变化，为新消息添加代码块复制按钮
const observer = new MutationObserver(() => {
  addCodeCopyButtons();
});
if (chatArea) {
  observer.observe(chatArea, { childList: true, subtree: true });
}
