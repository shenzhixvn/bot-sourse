// ============================================================
//  BOT — TTS 语音合成模块
//  调用内置 V2.5-TTS API，支持流式合成与实时播放
// ============================================================

class BotTTS {
  /**
   * @param {Object} options
   * @param {string} options.apiUrl - API 基础地址
   * @param {string} options.apiKey - API Key
   * @param {string} options.model - TTS 模型（默认 mimo-v2.5-tts）
   * @param {string} options.voice - 音色（默认 茉莉）
   * @param {number} options.sampleRate - PCM 采样率（默认 24000）
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'https://api.xiaomimimo.com/v1';
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'mimo-v2.5-tts';
    this.voice = options.voice || '茉莉';
    this.sampleRate = options.sampleRate || 24000;

    // 播放相关
    this.audioContext = null;
    this.pcmQueue = [];
    this.isPlaying = false;
    this.currentSource = null;
    this._playbackStopped = false;
    this._onPlaybackStart = null;
    this._onPlaybackEnd = null;
  }

  // ── 初始化 AudioContext ──
  _ensureAudioContext() {
    if (!this.audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AC({ sampleRate: this.sampleRate });
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  // ── PCM16 转 Float32 ──
  _pcm16ToFloat32(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const float32 = new Float32Array(arrayBuffer.byteLength / 2);
    for (let i = 0; i < float32.length; i++) {
      const int16 = view.getInt16(i * 2, true);
      float32[i] = int16 / 32768;
    }
    return float32;
  }

  // ── Base64 转 ArrayBuffer ──
  _base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ── 播放队列中的下一个 buffer ──
  _playNextBuffer() {
    if (this._playbackStopped) return;
    if (this.pcmQueue.length === 0) {
      this.isPlaying = false;
      if (this._onPlaybackEnd && !this._streaming) {
        const cb = this._onPlaybackEnd;
        this._onPlaybackEnd = null;
        cb();
      }
      return;
    }
    this.isPlaying = true;
    const float32 = this.pcmQueue.shift();
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = audioBuffer;
    this.currentSource.connect(this.audioContext.destination);
    this.currentSource.onended = () => {
      this._playNextBuffer();
    };
    this.currentSource.start();
  }

  // ── PCM 数据入队并触发播放 ──
  _enqueuePCM(base64Data) {
    this._ensureAudioContext();
    const arrayBuffer = this._base64ToArrayBuffer(base64Data);
    const float32 = this._pcm16ToFloat32(arrayBuffer);
    if (float32.length > 0) {
      this.pcmQueue.push(float32);
    }
    if (!this.isPlaying && !this._playbackStopped) {
      if (this._onPlaybackStart) {
        const cb = this._onPlaybackStart;
        this._onPlaybackStart = null;
        cb();
      }
      this._playNextBuffer();
    }
  }

  // ── 流式合成并播放 ──
  /**
   * @param {string} text - 要合成的文本
   * @param {Object} callbacks - { onStart, onFirstAudio, onEnd, onError }
   * @returns {Promise<void>}
   */
  async speak(text, callbacks = {}) {
    if (!text || !text.trim()) {
      if (callbacks.onEnd) callbacks.onEnd();
      return;
    }

    this._playbackStopped = false;
    this.pcmQueue = [];
    this.isPlaying = false;
    this._streaming = true;
    this._onPlaybackStart = callbacks.onFirstAudio || null;
    this._onPlaybackEnd = null;

    this._ensureAudioContext();

    const url = `${this.apiUrl.replace(/\/$/, '')}/chat/completions`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'user', content: '用温柔自然的语气朗读，语速适中，吐字清晰。' },
            { role: 'assistant', content: text },
          ],
          audio: {
            format: 'pcm16',
            voice: this.voice,
          },
          stream: true,
        }),
      });
    } catch (err) {
      this._streaming = false;
      if (callbacks.onError) callbacks.onError(err);
      throw err;
    }

    if (!response.ok) {
      this._streaming = false;
      const errText = await response.text();
      const err = new Error(`TTS API 错误 (${response.status}): ${errText}`);
      if (callbacks.onError) callbacks.onError(err);
      throw err;
    }

    if (callbacks.onStart) callbacks.onStart();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedAudio = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this._playbackStopped) {
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
            const audioData = data.choices?.[0]?.delta?.audio?.data;
            if (audioData) {
              receivedAudio = true;
              this._enqueuePCM(audioData);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    } catch (err) {
      this._streaming = false;
      if (callbacks.onError) callbacks.onError(err);
      throw err;
    }

    this._streaming = false;

    if (!receivedAudio) {
      if (callbacks.onError) callbacks.onError(new Error('未收到音频数据'));
      if (callbacks.onEnd) callbacks.onEnd();
      return;
    }

    // 等待播放完毕
    await this._waitForPlaybackComplete();
    if (callbacks.onEnd) callbacks.onEnd();
  }

  // ── 等待播放完毕 ──
  _waitForPlaybackComplete() {
    return new Promise((resolve) => {
      const check = () => {
        if (this._playbackStopped || (this.pcmQueue.length === 0 && !this.isPlaying)) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ── 停止播放 ──
  stop() {
    this._playbackStopped = true;
    this._streaming = false;
    this.pcmQueue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    this.isPlaying = false;
    this._onPlaybackStart = null;
    this._onPlaybackEnd = null;
  }

  // ── 是否正在播放 ──
  isSpeaking() {
    return this.isPlaying || this.pcmQueue.length > 0 || this._streaming;
  }

  // ── 销毁 ──
  destroy() {
    this.stop();
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BotTTS };
}
