// ============================================================
//  BOT — 唤醒词检测模块（Wake Word Detection）
//  功能：后台持续监听麦克风，检测到自定义唤醒词后触发回调
//  架构：复用 VoiceInputManager（BotSTT 提供者），短静默分段识别，循环监听
// ============================================================

const WakeWordState = {
  IDLE: 'idle',           // 未启动
  LISTENING: 'listening', // 正在监听唤醒词
  DETECTED: 'detected',   // 检测到唤醒词
  ERROR: 'error',          // 错误状态
};

class WakeWordManager {
  /**
   * @param {Object} options
   * @param {string} options.wakeWord - 唤醒词（默认 'bot'）
   * @param {Function} options.onWake - 检测到唤醒词时回调 (matchedText) => void
   * @param {Function} options.onStateChange - 状态变化回调 (state, prevState) => void
   * @param {Function} options.onError - 错误回调 (error) => void
   * @param {Function} options.onLog - 日志回调 (entry) => void
   * @param {Object} options.botSTTConfig - BotSTT 配置 {apiUrl, apiKey, model, language}
   * @param {number} options.silenceTimeout - 分段静默超时（毫秒，默认 1200）
   * @param {number} options.speechThreshold - 语音音量阈值（默认 5）
   * @param {number} options.maxSegmentDuration - 单段最大录音时长（毫秒，默认 8000，超时自动截断）
   * @param {number} options.restartDelay - 未检测到唤醒词后重启监听的延迟（毫秒，默认 300）
   * @param {boolean} options.caseSensitive - 是否大小写敏感（默认 false）
   */
  constructor(options = {}) {
    this.wakeWord = (options.wakeWord || 'bot').trim();
    this.caseSensitive = options.caseSensitive || false;
    this.onWake = options.onWake || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onLog = options.onLog || (() => {});
    this.botSTTConfig = options.botSTTConfig || null;

    // 替代词（ASR 因口音/方言可能识别成的其他写法，逗号分隔）
    this.alternatives = (options.alternatives || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);

    // STT 提供者：'bot'（云端API）或 'web'（Web Speech API 实时流式）
    this.provider = options.provider || 'bot';

    this.silenceTimeout = options.silenceTimeout || 800;
    this.speechThreshold = options.speechThreshold || 3;
    this.maxSegmentDuration = options.maxSegmentDuration || 8000;
    this.restartDelay = options.restartDelay || 200;

    this.state = WakeWordState.IDLE;
    this.voiceManager = null;
    this._restartTimer = null;
    this._maxDurationTimer = null;
    this._enabled = false;
    this._consecutiveErrors = 0;
    this._lastDetectedText = '';
  }

  // ── 日志 ──
  log(level, message) {
    const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, message };
    this.onLog(entry);
  }

  // ── 状态管理 ──
  setState(newState) {
    const prev = this.state;
    this.state = newState;
    this.log('info', `唤醒词状态: ${prev} → ${newState}`);
    this.onStateChange(newState, prev);
  }

  // ── 设置唤醒词 ──
  setWakeWord(word) {
    const old = this.wakeWord;
    this.wakeWord = (word || 'bot').trim();
    this.log('info', `唤醒词已更新: "${old}" → "${this.wakeWord}"`);
  }

  getWakeWord() {
    return this.wakeWord;
  }

  isEnabled() {
    return this._enabled;
  }

  getState() {
    return this.state;
  }

  // ── 启动唤醒词监听 ──
  async start() {
    if (this._enabled) {
      this.log('warn', '唤醒词监听已在运行中，忽略重复启动');
      return;
    }

    if (!this.botSTTConfig || !this.botSTTConfig.apiKey) {
      const err = { code: 'CONFIG_MISSING', message: '未配置 API Key，无法启动唤醒词监听' };
      this.onError(err);
      this.setState(WakeWordState.ERROR);
      return;
    }

    this._enabled = true;
    this._consecutiveErrors = 0;
    this.log('info', `启动唤醒词监听，唤醒词: "${this.wakeWord}"`);

    await this._startListening();
  }

  // ── 停止唤醒词监听 ──
  stop() {
    this._enabled = false;
    this._clearTimers();

    if (this.voiceManager) {
      try { this.voiceManager.stop(); } catch {}
      try { this.voiceManager.destroy(); } catch {}
      this.voiceManager = null;
    }

    this.setState(WakeWordState.IDLE);
    this.log('info', '唤醒词监听已停止');
  }

  // ── 开始一段监听 ──
  async _startListening() {
    if (!this._enabled) return;

    this._clearTimers();

    try {
      if (typeof VoiceInputManager === 'undefined') {
        throw new Error('VoiceInputManager 未加载');
      }

      this.voiceManager = new VoiceInputManager({
        preferredProvider: this.provider,
        botSTTConfig: this.botSTTConfig,
        silenceTimeout: this.silenceTimeout,
        speechThreshold: this.speechThreshold,

        onStateChange: (state) => {
          if (state === 'listening' || state === 'initializing') {
            if (this.state !== WakeWordState.LISTENING) {
              this.setState(WakeWordState.LISTENING);
            }
          }
        },

        onFinalResult: (text) => {
          this._handleRecognitionResult(text);
        },

        onResult: (result) => {
          // Web Speech 提供者的实时 interim 结果，快速检测唤醒词
          if (result && result.interim) {
            this._handleRecognitionResult(result.interim);
          }
        },

        onError: (error) => {
          this._handleError(error);
        },

        onLog: (entry) => {
          // 静默，不输出语音管理器的内部日志
        },
      });

      await this.voiceManager.start();

      // 设置最大时长定时器，防止一段录音过长
      this._maxDurationTimer = setTimeout(() => {
        if (this._enabled && this.voiceManager &&
            (this.voiceManager.getState() === 'listening' || this.voiceManager.getState() === 'initializing')) {
          this.log('debug', `达到最大分段时长 ${this.maxSegmentDuration}ms，强制截断`);
          this.voiceManager.stop();
        }
      }, this.maxSegmentDuration);

    } catch (err) {
      this._handleError({ code: err.code || 'START_FAILED', message: err.message || String(err) });
    }
  }

  // ── 处理识别结果 ──
  _handleRecognitionResult(text) {
    if (!this._enabled) return;

    const trimmed = (text || '').trim();
    if (!trimmed) {
      this.log('info', '识别到: (空)');
      this._scheduleRestart();
      return;
    }

    this.log('info', `识别到: "${trimmed}"`);

    // 检测唤醒词
    const matched = this._checkWakeWord(trimmed);
    if (matched) {
      this._lastDetectedText = trimmed;
      this._consecutiveErrors = 0;
      this.setState(WakeWordState.DETECTED);
      this.log('success', `检测到唤醒词 "${this.wakeWord}"，原文: "${trimmed}"`);

      // 停止当前语音管理器
      this._clearTimers();
      if (this.voiceManager) {
        try { this.voiceManager.stop(); } catch {}
        try { this.voiceManager.destroy(); } catch {}
        this.voiceManager = null;
      }

      // 触发唤醒回调
      try {
        this.onWake(trimmed);
      } catch (err) {
        this.log('error', `唤醒回调执行失败: ${err.message}`);
      }
    } else {
      // 未检测到唤醒词，重启监听
      this._scheduleRestart();
    }
  }

  // ── 检测文本中是否包含唤醒词 ──
  _checkWakeWord(text) {
    if (!text || !this.wakeWord) return false;

    let target = text;
    let keyword = this.wakeWord;

    if (!this.caseSensitive) {
      target = target.toLowerCase();
      keyword = keyword.toLowerCase();
    }

    // 移除常见标点后再匹配，提高容错
    const cleanTarget = target.replace(/[，。！？、；：""''（）\[\]{}.,!?;:'"()\s]/g, '');
    const cleanKeyword = keyword.replace(/[，。！？、；：""''（）\[\]{}.,!?;:'"()\s]/g, '');

    // 1. 精确包含匹配
    if (target.includes(keyword)) return true;
    // 2. 去标点后包含匹配
    if (cleanKeyword && cleanTarget.includes(cleanKeyword)) return true;
    // 3. 开头匹配（唤醒词通常在句首）
    if (target.startsWith(keyword)) return true;
    if (cleanKeyword && cleanTarget.startsWith(cleanKeyword)) return true;

    // 4. 替代词匹配（用户手动配置的 ASR 可能识别出的其他写法）
    for (const alt of this.alternatives) {
      let altLower = alt;
      if (!this.caseSensitive) altLower = alt.toLowerCase();
      const cleanAlt = altLower.replace(/[，。！？、；：""''（）\[\]{}.,!?;:'"()\s]/g, '');
      if (altLower && target.includes(altLower)) return true;
      if (cleanAlt && cleanTarget.includes(cleanAlt)) return true;
    }

    // 5. 模糊匹配（Levenshtein 距离，容错口音导致的识别偏差）
    // 只对较短的文本片段做模糊匹配，避免长文本误匹配
    if (cleanKeyword.length >= 2 && cleanTarget.length <= 30) {
      // 提取与唤醒词长度相近的滑动窗口做距离比较
      const windowSize = cleanKeyword.length;
      for (let i = 0; i <= cleanTarget.length - windowSize; i++) {
        const slice = cleanTarget.substring(i, i + windowSize);
        const distance = this._levenshteinDistance(slice, cleanKeyword);
        // 距离为 0-1 即视为匹配（允许一个字符偏差）
        if (distance <= 1) return true;
      }
      // 也检查替代词的模糊匹配
      for (const alt of this.alternatives) {
        let altLower = alt;
        if (!this.caseSensitive) altLower = alt.toLowerCase();
        const cleanAlt = altLower.replace(/[，。！？、；：""''（）\[\]{}.,!?;:'"()\s]/g, '');
        if (cleanAlt.length >= 2) {
          for (let i = 0; i <= cleanTarget.length - cleanAlt.length; i++) {
            const slice = cleanTarget.substring(i, i + cleanAlt.length);
            if (this._levenshteinDistance(slice, cleanAlt) <= 1) return true;
          }
        }
      }
    }

    return false;
  }

  // Levenshtein 编辑距离
  _levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
      for (let j = 1; j <= a.length; j++) {
        if (i === 0) {
          matrix[i][j] = j;
        } else {
          const cost = a[j - 1] === b[i - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // ── 错误处理 ──
  _handleError(error) {
    if (!this._enabled) return;

    this._consecutiveErrors++;
    const code = error.code || 'UNKNOWN';
    const message = error.message || String(error);

    this.log('error', `唤醒词监听错误 [${code}]: ${message} (连续错误: ${this._consecutiveErrors})`);
    this.onError({ ...error, consecutiveErrors: this._consecutiveErrors });

    // 麦克风权限错误：不再重试
    if (code === 'MIC_PERMISSION') {
      this._enabled = false;
      this.setState(WakeWordState.ERROR);
      return;
    }

    // 连续错误过多，延长重启间隔
    let delay = this.restartDelay;
    if (this._consecutiveErrors > 5) {
      delay = Math.min(5000, this.restartDelay * this._consecutiveErrors);
      this.log('warn', `连续错误 ${this._consecutiveErrors} 次，延长重启间隔至 ${delay}ms`);
    }

    this._scheduleRestart(delay);
  }

  // ── 调度重启监听 ──
  _scheduleRestart(delay) {
    if (!this._enabled) return;

    this._clearTimers();
    const wait = delay !== undefined ? delay : this.restartDelay;

    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._enabled) {
        this._startListening();
      }
    }, wait);
  }

  // ── 清理定时器 ──
  _clearTimers() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._maxDurationTimer) {
      clearTimeout(this._maxDurationTimer);
      this._maxDurationTimer = null;
    }
  }

  // ── 销毁 ──
  destroy() {
    this.stop();
    this.onWake = null;
    this.onStateChange = null;
    this.onError = null;
    this.onLog = null;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WakeWordManager, WakeWordState };
}
