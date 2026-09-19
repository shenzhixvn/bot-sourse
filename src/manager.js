// ========================================
// BOT — 会话管理器
// ========================================

const $ = (sel) => document.querySelector(sel);

const listEl = $('#conversation-list');
const emptyEl = $('#manager-empty');
const btnNewChat = $('#btn-new-chat');
const btnTheme = $('#btn-theme');
const btnMinimize = $('#btn-minimize');
const btnClose = $('#btn-close');

let config = {};

// ── 主题切换 ──
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

// ── 窗口控制 ──
btnMinimize.addEventListener('click', () => window.api.minimize());
btnClose.addEventListener('click', () => window.api.close());

// ── 新建对话 ──
btnNewChat.addEventListener('click', async () => {
  await window.api.conv.create();
  // 创建后刷新列表
  await loadConversations();
});

// ── 格式化时间 ──
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }
  // 今年
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }
  // 更早
  return date.toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

// ── 渲染会话列表 ──
function renderConversations(conversations) {
  if (!conversations || conversations.length === 0) {
    listEl.innerHTML = '';
    listEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  listEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  listEl.innerHTML = conversations.map(conv => `
    <div class="conversation-item" data-id="${conv.id}">
      <div class="conv-icon">💬</div>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(conv.title || '新对话')}</div>
        <div class="conv-meta">
          <span class="conv-count">${conv.messageCount || 0} 条消息</span>
          <span class="conv-time">${formatTime(conv.updatedAt)}</span>
        </div>
      </div>
      <button class="conv-delete" data-id="${conv.id}" title="删除对话">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  `).join('');

  // 绑定点击事件
  listEl.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // 点击删除按钮时不触发打开
      if (e.target.closest('.conv-delete')) return;
      const id = item.getAttribute('data-id');
      window.api.conv.open(id);
    });
  });

  // 绑定删除事件
  listEl.querySelectorAll('.conv-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const confirmed = confirm('确定要删除这个对话吗？此操作不可撤销。');
      if (confirmed) {
        await window.api.conv.delete(id);
        await loadConversations();
      }
    });
  });
}

// ── 加载会话列表 ──
async function loadConversations() {
  try {
    const conversations = await window.api.conv.list();
    renderConversations(conversations);
  } catch (err) {
    console.error('加载会话列表失败:', err);
  }
}

// ── 工具函数 ──
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

// ── 初始化 ──
(async () => {
  config = await window.api.loadConfig();
  if (config.theme) {
    setTheme(config.theme);
  }
  await loadConversations();

  // 监听会话列表更新
  window.api.conv.onListUpdated(() => {
    loadConversations();
  });
})();
