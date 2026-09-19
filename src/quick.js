// ============================================================
//  选词助手 — 浮窗渲染进程逻辑
// ============================================================

const $ = (sel) => document.querySelector(sel);

// DOM
const sourceTextEl = $('#source-text');
const resultTextEl = $('#result-text');
const resultStatusEl = $('#result-status');
const customInput = $('#custom-input');
const btnCustomSend = $('#btn-custom-send');
const btnClose = $('#btn-close');
const btnCopyResult = $('#btn-copy-result');
const btnStop = $('#btn-stop');
const actionBtns = document.querySelectorAll('.action-btn');

// 状态
let selectedText = '';
let isProcessing = false;
let currentAction = null;

// ============================================================
//  预设操作提示词
// ============================================================
const ACTION_PROMPTS = {
  translate: '请将以下文本翻译成中文（如果原文是中文则翻译成英文）。要求：保持原意准确、语言自然流畅、专业术语翻译准确。只输出翻译结果，不要添加解释。\n\n待翻译文本：\n{text}',
  summarize: '请用简洁的语言总结以下内容的核心要点，不超过3点，每点一句话。只输出总结结果。\n\n待总结内容：\n{text}',
  explain: '请用通俗易懂的语言解释以下内容的含义，就像给一个初学者讲解一样。只输出解释结果。\n\n待解释内容：\n{text}',
  polish: '请润色以下文本，使其更加通顺、专业、有条理，保持原意不变。只输出润色后的文本。\n\n待润色文本：\n{text}',
};

// ============================================================
//  初始化：获取选中文本
// ============================================================
async function init() {
  try {
    const result = await window.api.quickAction.getSelectedText();
    if (result.success && result.text && result.text.trim()) {
      selectedText = result.text;
      sourceTextEl.textContent = selectedText;
      sourceTextEl.classList.remove('source-empty');
    } else {
      selectedText = '';
      sourceTextEl.innerHTML = '<span class="source-empty">未获取到选中文本，请先在其他窗口选中文字后再按快捷键</span>';
    }
  } catch (err) {
    sourceTextEl.innerHTML = `<span class="result-error">获取选中文本失败：${err.message}</span>`;
  }
}

// ============================================================
//  执行 AI 处理
// ============================================================
async function processText(action, customPrompt = null) {
  if (isProcessing || !selectedText) return;

  isProcessing = true;
  currentAction = action;
  updateActionButtonsState();

  // 清空结果区
  resultTextEl.innerHTML = '';
  resultStatusEl.textContent = '思考中...';
  btnCopyResult.disabled = true;
  btnStop.style.display = 'inline-block';

  // 构建提示词
  let prompt;
  if (customPrompt) {
    prompt = `${customPrompt}\n\n待处理文本：\n{text}`;
  } else {
    prompt = ACTION_PROMPTS[action] || ACTION_PROMPTS.explain;
  }
  const userContent = prompt.replace('{text}', selectedText);

  let fullResult = '';

  try {
    // 监听流式结果
    const removeListener = window.api.quickAction.onChunk((data) => {
      if (data.content) {
        fullResult += data.content;
        resultTextEl.textContent = fullResult;
        resultTextEl.classList.remove('result-empty');
        resultStatusEl.textContent = '生成中...';
        scrollResultToBottom();
      }
      if (data.done) {
        resultStatusEl.textContent = '';
        removeListener();
      }
      if (data.error) {
        resultTextEl.innerHTML = `<span class="result-error">${data.error}</span>`;
        resultStatusEl.textContent = '';
        removeListener();
      }
    });

    // 发起请求
    const result = await window.api.quickAction.process({
      messages: [
        { role: 'system', content: '你是一个高效的文本处理助手。严格按照用户指令处理文本，只输出处理结果，不要添加额外的解释、问候或结束语。' },
        { role: 'user', content: userContent },
      ],
    });

    if (!result.success) {
      resultTextEl.innerHTML = `<span class="result-error">处理失败：${result.error || '未知错误'}</span>`;
    } else if (fullResult) {
      btnCopyResult.disabled = false;
    }
  } catch (err) {
    resultTextEl.innerHTML = `<span class="result-error">处理异常：${err.message}</span>`;
  } finally {
    isProcessing = false;
    currentAction = null;
    resultStatusEl.textContent = '';
    btnStop.style.display = 'none';
    updateActionButtonsState();
    if (fullResult) btnCopyResult.disabled = false;
  }
}

// ============================================================
//  停止生成
// ============================================================
function stopProcessing() {
  if (!isProcessing) return;
  window.api.quickAction.abort();
  resultStatusEl.textContent = '已停止';
}

// ============================================================
//  复制结果
// ============================================================
async function copyResult() {
  const text = resultTextEl.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    btnCopyResult.textContent = '✅ 已复制';
    setTimeout(() => { btnCopyResult.textContent = '📋 复制结果'; }, 1500);
  } catch (err) {
    btnCopyResult.textContent = '❌ 复制失败';
    setTimeout(() => { btnCopyResult.textContent = '📋 复制结果'; }, 1500);
  }
}

// ============================================================
//  工具函数
// ============================================================
function updateActionButtonsState() {
  actionBtns.forEach(btn => {
    btn.disabled = isProcessing || !selectedText;
    btn.classList.toggle('active', btn.dataset.action === currentAction);
  });
  btnCustomSend.disabled = isProcessing || !selectedText || !customInput.value.trim();
}

function scrollResultToBottom() {
  const resultSection = document.querySelector('.result-section');
  if (resultSection) {
    resultSection.scrollTop = resultSection.scrollHeight;
  }
}

function closeWindow() {
  if (isProcessing) {
    window.api.quickAction.abort();
  }
  window.api.quickAction.close();
}

// ============================================================
//  事件绑定
// ============================================================
actionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    processText(btn.dataset.action);
  });
});

btnCustomSend.addEventListener('click', () => {
  const prompt = customInput.value.trim();
  if (prompt) processText('custom', prompt);
});

customInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const prompt = customInput.value.trim();
    if (prompt) processText('custom', prompt);
  }
});

customInput.addEventListener('input', updateActionButtonsState);

btnCopyResult.addEventListener('click', copyResult);
btnStop.addEventListener('click', stopProcessing);
btnClose.addEventListener('click', closeWindow);

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeWindow();
  }
  // Ctrl+C 复制结果（当结果区有内容且焦点不在输入框时）
  if (e.ctrlKey && e.key === 'c' && document.activeElement !== customInput) {
    const selection = window.getSelection().toString();
    if (!selection && resultTextEl.textContent && !resultTextEl.querySelector('.result-empty')) {
      e.preventDefault();
      copyResult();
    }
  }
});

// 点击结果区外部不关闭（仅 Esc 或关闭按钮）
document.querySelector('.quick-window').addEventListener('click', (e) => {
  e.stopPropagation();
});

// 初始化
init();
updateActionButtonsState();
