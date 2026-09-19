// ============================================================
//  BOT — 语音输入(STT)交互模块
//  功能：麦克风采集、语音转文字、错误分类、静音检测、确认交互
//  架构：可插拔 STT 提供者（默认 Web Speech API，预留本地 STT 扩展）
// ============================================================

// ── 错误码定义 ──
const VoiceError = {
  MIC_PERMISSION: 'MIC_PERMISSION',       // 麦克风权限错误
  AUDIO_HARDWARE: 'AUDIO_HARDWARE',       // 音频采集硬件错误
  AUDIO_ENCODING: 'AUDIO_ENCODING',       // 音频格式/编码错误
  STT_SERVICE: 'STT_SERVICE',             // 语音识别服务错误
  NO_SPEECH: 'NO_SPEECH',                 // 环境噪音/无语音输入
  USER_ABORT: 'USER_ABORT',               // 用户主动取消
  UNKNOWN: 'UNKNOWN',                      // 未知错误
};

// ── 错误信息映射 ──
const ErrorMessages = {
  [VoiceError.MIC_PERMISSION]: '语音输入失败：未获取麦克风权限，请前往Windows设置开启麦克风访问权限',
  [VoiceError.AUDIO_HARDWARE]: '语音输入失败：无法采集音频，请检查麦克风是否正常连接、选中正确输入设备',
  [VoiceError.AUDIO_ENCODING]: '语音输入失败：音频编码异常',
  [VoiceError.STT_SERVICE]: '语音识别服务异常，可切换文字输入，或者重试语音',
  [VoiceError.NO_SPEECH]: '未检测到清晰人声，请靠近麦克风、在安静环境重试',
  [VoiceError.USER_ABORT]: '语音输入已取消',
  [VoiceError.UNKNOWN]: '语音输入发生未知错误，请重试或切换文字输入',
};

// ── 状态定义 ──
const VoiceState = {
  IDLE: 'idle',           // 空闲
  INITIALIZING: 'initializing', // 初始化中
  LISTENING: 'listening', // 录音中
  PROCESSING: 'processing', // 识别处理中
  CONFIRMING: 'confirming', // 等待用户确认
  ERROR: 'error',         // 错误状态
};

// ============================================================
//  STT 提供者基类（可插拔架构）
// ============================================================
class STTProvider {
  constructor(options = {}) {
    this.options = options;
    this.onResult = null;
    this.onError = null;
    this.onEnd = null;
    this.onAudioLevel = null; // 实时音量回调 (level: 0-100)
    this._audioLevelMonitor = null; // 音频能量监测 {audioContext, analyser, source, rafId}
  }

  async start() { throw new Error('子类必须实现 start()'); }
  stop() { throw new Error('子类必须实现 stop()'); }
  isSupported() { return false; }
  destroy() { this._stopAudioLevelMonitor(); }

  /**
   * 启动实时音频能量监测（使用 ScriptProcessorNode，最可靠）
   * 子类在获取到 MediaStream 后调用此方法
   * @param {MediaStream} stream - 麦克风音频流
   */
  _startAudioLevelMonitor(stream) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('AudioContext 不可用，声音检测未启用');
        return;
      }

      const audioContext = new AudioContextClass();

      // 确保 AudioContext 运行（Electron 自动播放策略）
      const resumeCtx = () => {
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
      };
      resumeCtx();
      // 多次尝试 resume，确保成功
      setTimeout(resumeCtx, 100);
      setTimeout(resumeCtx, 500);

      const source = audioContext.createMediaStreamSource(stream);

      // 使用 ScriptProcessorNode（虽已废弃但所有浏览器支持，最可靠）
      const bufferSize = 2048;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      let lastLevel = 0;

      processor.onaudioprocess = (e) => {
        if (!this._audioLevelMonitor) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // 计算 RMS 音量（均方根）
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // 映射到 0-100，提高灵敏度
        // 正常说话 RMS 约 0.01-0.1，静音约 0.001
        let level = Math.min(100, Math.round(rms * 800));

        // 平滑处理
        level = Math.round(lastLevel * 0.7 + level * 0.3);
        lastLevel = level;

        if (this.onAudioLevel) {
          this.onAudioLevel(level);
        }
      };

      // 连接：source -> processor -> gainNode(静音) -> destination
      // 必须连接到 destination 才会触发 onaudioprocess
      // 用 gainNode 设为 0 避免听到自己的声音
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      source.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      this._audioLevelMonitor = { audioContext, source, processor, gainNode };

      console.log('音频能量监测已启动（ScriptProcessorNode）');
    } catch (e) {
      console.warn('音频能量监测启动失败:', e);
    }
  }

  /**
   * 停止音频能量监测
   */
  _stopAudioLevelMonitor() {
    if (this._audioLevelMonitor) {
      try {
        this._audioLevelMonitor.processor.disconnect();
      } catch {}
      try {
        this._audioLevelMonitor.gainNode.disconnect();
      } catch {}
      try {
        this._audioLevelMonitor.source.disconnect();
      } catch {}
      try {
        this._audioLevelMonitor.audioContext.close();
      } catch {}
      this._audioLevelMonitor = null;
    }
  }
}

// ============================================================
//  Web Speech API 提供者（默认）
// ============================================================
class WebSpeechProvider extends STTProvider {
  constructor(options = {}) {
    super(options);
    this.recognition = null;
    this._finalTranscript = '';
    this._interimTranscript = '';
    this._isManualStop = false;
  }

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw { code: VoiceError.STT_SERVICE, message: '当前环境不支持语音识别' };
    }

    this._finalTranscript = '';
    this._interimTranscript = '';
    this._isManualStop = false;

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.options.lang || 'zh-CN';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    // 检测麦克风权限（通过 getUserMedia）
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw { code: VoiceError.MIC_PERMISSION, message: ErrorMessages[VoiceError.MIC_PERMISSION] };
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
      }
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
      }
      // 其他错误继续尝试 SpeechRecognition
    }

    return new Promise((resolve, reject) => {
      let started = false;
      const timeout = setTimeout(() => {
        if (!started) {
          reject({ code: VoiceError.STT_SERVICE, message: ErrorMessages[VoiceError.STT_SERVICE] });
        }
      }, 5000);

      this.recognition.onstart = () => {
        started = true;
        clearTimeout(timeout);
        resolve();
      };

      this.recognition.onerror = (event) => {
        clearTimeout(timeout);
        const error = this._mapError(event.error);
        if (this.onError) this.onError(error);
        if (!started) reject(error);
      };

      this.recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            this._finalTranscript += transcript;
          } else {
            interim += transcript;
          }
        }
        this._interimTranscript = interim;
        if (this.onResult) {
          this.onResult({
            final: this._finalTranscript,
            interim: this._interimTranscript,
            full: this._finalTranscript + this._interimTranscript,
          });
        }
      };

      this.recognition.onend = () => {
        if (this.onEnd) {
          this.onEnd({
            final: this._finalTranscript,
            full: this._finalTranscript + this._interimTranscript,
            manualStop: this._isManualStop,
          });
        }
      };

      try {
        this.recognition.start();
      } catch (e) {
        clearTimeout(timeout);
        reject({ code: VoiceError.STT_SERVICE, message: e.message });
      }
    });
  }

  stop() {
    this._isManualStop = true;
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
  }

  _mapError(errorType) {
    const mapping = {
      'not-allowed': VoiceError.MIC_PERMISSION,
      'service-not-allowed': VoiceError.MIC_PERMISSION,
      'audio-capture': VoiceError.AUDIO_HARDWARE,
      'no-speech': VoiceError.NO_SPEECH,
      'network': VoiceError.STT_SERVICE,
      'aborted': VoiceError.USER_ABORT,
      'language-not-supported': VoiceError.STT_SERVICE,
      'bad-grammar': VoiceError.AUDIO_ENCODING,
    };
    const code = mapping[errorType] || VoiceError.UNKNOWN;
    return { code, message: ErrorMessages[code], raw: errorType };
  }

  destroy() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
      this.recognition = null;
    }
  }
}

// ============================================================
//  本地 STT 提供者（预留扩展接口）
//  使用方式：通过 IPC 调用主进程的本地 STT 引擎（Vosk / Whisper.cpp 等）
// ============================================================
class LocalSTTProvider extends STTProvider {
  constructor(options = {}) {
    super(options);
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this._isRecording = false;
  }

  isSupported() {
    // 检查主进程是否提供了本地 STT IPC
    return !!(window.api && window.api.voice && window.api.voice.localSTTAvailable);
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw { code: VoiceError.MIC_PERMISSION, message: ErrorMessages[VoiceError.MIC_PERMISSION] };
      }
      throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
    }

    this.audioChunks = [];
    this._isRecording = true;

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
    } catch (e) {
      this._cleanupStream();
      throw { code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] };
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onerror = () => {
      if (this.onError) this.onError({ code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] });
    };

    this.mediaRecorder.start(250); // 每250ms收集一次
  }

  async stop() {
    this._isRecording = false;
    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          this._cleanupStream();
          try {
            // 调用主进程本地 STT
            const result = await window.api.voice.speechToText(audioBlob);
            if (this.onResult) this.onResult({ final: result.text, interim: '', full: result.text });
            if (this.onEnd) this.onEnd({ final: result.text, full: result.text, manualStop: true });
            resolve();
          } catch (err) {
            const error = { code: VoiceError.STT_SERVICE, message: ErrorMessages[VoiceError.STT_SERVICE], raw: err };
            if (this.onError) this.onError(error);
            if (this.onEnd) this.onEnd({ final: '', full: '', manualStop: true, error });
            resolve();
          }
        };
        this.mediaRecorder.stop();
      } else {
        this._cleanupStream();
        resolve();
      }
    });
  }

  _cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  destroy() {
    this._cleanupStream();
    if (this.mediaRecorder) {
      try { this.mediaRecorder.stop(); } catch {}
      this.mediaRecorder = null;
    }
  }
}

// ============================================================
//  HTTP STT 提供者（调用 OpenAI 兼容的 /audio/transcriptions 接口）
//  适用于国内网络环境，可接入百度/讯飞/阿里云/自建 Whisper 等服务
// ============================================================
class HttpSTTProvider extends STTProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiUrl - STT API 地址（OpenAI 兼容）
   * @param {string} options.apiKey - API 密钥
   * @param {string} options.model - 模型名称（默认 whisper-1）
   * @param {string} options.language - 语言代码（默认 zh）
   */
  constructor(options = {}) {
    super(options);
    this.apiUrl = options.apiUrl || '';
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'whisper-1';
    this.language = options.language || 'zh';
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this._isRecording = false;
  }

  isSupported() {
    return !!(this.apiUrl && this.apiKey && typeof MediaRecorder !== 'undefined');
  }

  async start() {
    if (!this.apiUrl || !this.apiKey) {
      throw { code: VoiceError.STT_SERVICE, message: 'HTTP STT 未配置 API 地址和密钥，请在设置中配置' };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw { code: VoiceError.MIC_PERMISSION, message: ErrorMessages[VoiceError.MIC_PERMISSION] };
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
      }
      throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
    }

    this.audioChunks = [];
    this._isRecording = true;

    // 启动实时音频能量监测（用于静音检测）
    this._startAudioLevelMonitor(this.stream);

    // 尝试使用支持的音频格式
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
      mimeType = 'audio/ogg;codecs=opus';
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    } catch (e) {
      this._cleanupStream();
      throw { code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] };
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onerror = () => {
      if (this.onError) this.onError({ code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] });
    };

    this.mediaRecorder.start(250);
  }

  async stop() {
    this._isRecording = false;
    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
          this._stopAudioLevelMonitor();
          this._cleanupStream();

          if (audioBlob.size < 1000) {
            // 音频数据过小，可能没有声音
            const error = { code: VoiceError.NO_SPEECH, message: ErrorMessages[VoiceError.NO_SPEECH] };
            if (this.onError) this.onError(error);
            if (this.onEnd) this.onEnd({ final: '', full: '', manualStop: true, error });
            resolve();
            return;
          }

          try {
            const text = await this._transcribe(audioBlob);
            if (this.onResult) this.onResult({ final: text, interim: '', full: text });
            if (this.onEnd) this.onEnd({ final: text, full: text, manualStop: true });
          } catch (err) {
            const error = { code: VoiceError.STT_SERVICE, message: err.message || ErrorMessages[VoiceError.STT_SERVICE], raw: err };
            if (this.onError) this.onError(error);
            if (this.onEnd) this.onEnd({ final: '', full: '', manualStop: true, error });
          }
          resolve();
        };
        this.mediaRecorder.stop();
      } else {
        this._cleanupStream();
        resolve();
      }
    });
  }

  async _transcribe(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', this.model);
    formData.append('language', this.language);

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT API 错误 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.text || '';
  }

  _cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  destroy() {
    this._cleanupStream();
    if (this.mediaRecorder) {
      try { this.mediaRecorder.stop(); } catch {}
      this.mediaRecorder = null;
    }
  }
}

// ============================================================
//  内置 STT 提供者（适配 V2.5-ASR 多模态接口）
//  API 格式：/v1/chat/completions + input_audio 多模态输入
//  复用用户已有的 API Key，无需额外配置
// ============================================================
class BotSTTProvider extends STTProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiUrl - API 基础地址（默认 https://api.xiaomimimo.com/v1）
   * @param {string} options.apiKey - API Key
   * @param {string} options.model - ASR 模型（默认 mimo-v2.5-asr）
   * @param {string} options.language - 语言（默认 auto）
   */
  constructor(options = {}) {
    super(options);
    this.apiUrl = options.apiUrl || 'https://api.xiaomimimo.com/v1';
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'mimo-v2.5-asr';
    this.language = options.language || 'auto';
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this._isRecording = false;
  }

  isSupported() {
    return !!(this.apiKey && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined');
  }

  async start() {
    if (!this.apiKey) {
      throw { code: VoiceError.STT_SERVICE, message: '未配置 API Key，请在设置中配置' };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw { code: VoiceError.MIC_PERMISSION, message: ErrorMessages[VoiceError.MIC_PERMISSION] };
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
      }
      throw { code: VoiceError.AUDIO_HARDWARE, message: ErrorMessages[VoiceError.AUDIO_HARDWARE] };
    }

    this.audioChunks = [];
    this._isRecording = true;

    // 启动实时音频能量监测（用于静音检测）
    this._startAudioLevelMonitor(this.stream);

    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    } catch (e) {
      this._cleanupStream();
      throw { code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] };
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onerror = () => {
      if (this.onError) this.onError({ code: VoiceError.AUDIO_ENCODING, message: ErrorMessages[VoiceError.AUDIO_ENCODING] });
    };

    this.mediaRecorder.start(250);
  }

  async stop() {
    this._isRecording = false;
    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
          this._stopAudioLevelMonitor();
          this._cleanupStream();

          if (audioBlob.size < 1000) {
            const error = { code: VoiceError.NO_SPEECH, message: ErrorMessages[VoiceError.NO_SPEECH] };
            if (this.onError) this.onError(error);
            if (this.onEnd) this.onEnd({ final: '', full: '', manualStop: true, error });
            resolve();
            return;
          }

          try {
            const wavBlob = await this._convertToWav(audioBlob);
            const dataUrl = await this._blobToDataUrl(wavBlob);
            const text = await this._transcribe(dataUrl);
            if (this.onResult) this.onResult({ final: text, interim: '', full: text });
            if (this.onEnd) this.onEnd({ final: text, full: text, manualStop: true });
          } catch (err) {
            const error = { code: VoiceError.STT_SERVICE, message: err.message || ErrorMessages[VoiceError.STT_SERVICE], raw: err };
            if (this.onError) this.onError(error);
            if (this.onEnd) this.onEnd({ final: '', full: '', manualStop: true, error });
          }
          resolve();
        };
        this.mediaRecorder.stop();
      } else {
        this._cleanupStream();
        resolve();
      }
    });
  }

  async _convertToWav(audioBlob) {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 16000 });
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      return this._audioBufferToWav(audioBuffer);
    } finally {
      audioContext.close();
    }
  }

  _audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async _transcribe(audioDataUrl) {
    const url = `${this.apiUrl.replace(/\/$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audioDataUrl,
                },
              },
            ],
          },
        ],
        asr_options: {
          language: this.language,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`语音识别 API 错误 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return text.trim();
  }

  _cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  destroy() {
    this._cleanupStream();
    if (this.mediaRecorder) {
      try { this.mediaRecorder.stop(); } catch {}
      this.mediaRecorder = null;
    }
  }
}

// ============================================================
//  语音环境诊断
// ============================================================
async function diagnoseVoiceEnvironment() {
  const report = {
    timestamp: new Date().toLocaleString('zh-CN'),
    checks: [],
    overall: 'unknown',
    recommendations: [],
  };

  // 1. 检查 Web Speech API
  const webSpeechAvailable = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  report.checks.push({
    name: 'Web Speech API',
    available: webSpeechAvailable,
    detail: webSpeechAvailable ? '浏览器支持 Web Speech API' : '浏览器不支持 Web Speech API',
    note: webSpeechAvailable ? '注意：Web Speech API 依赖 Google 服务，国内网络可能无法连接' : '',
  });

  // 2. 检查 MediaRecorder
  const mediaRecorderAvailable = typeof MediaRecorder !== 'undefined';
  report.checks.push({
    name: 'MediaRecorder（音频录制）',
    available: mediaRecorderAvailable,
    detail: mediaRecorderAvailable ? '支持音频录制' : '不支持音频录制',
  });

  // 3. 检查麦克风权限和设备
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      report.checks.push({
        name: '麦克风权限',
        available: true,
        detail: `麦克风权限已授予，设备：${tracks[0]?.label || '默认麦克风'}`,
      });
      stream.getTracks().forEach(t => t.stop());

      // 列出音频输入设备
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        report.checks.push({
          name: '音频输入设备',
          available: audioInputs.length > 0,
          detail: `检测到 ${audioInputs.length} 个音频输入设备`,
          devices: audioInputs.map(d => d.label || '未命名设备'),
        });
      }
    } else {
      report.checks.push({
        name: '麦克风权限',
        available: false,
        detail: '浏览器不支持 getUserMedia',
      });
    }
  } catch (err) {
    let detail = '麦克风权限检查失败';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      detail = '麦克风权限被拒绝，请在系统设置和浏览器设置中允许麦克风访问';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      detail = '未检测到麦克风设备，请检查麦克风是否连接';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      detail = '麦克风被其他程序占用或硬件异常';
    }
    report.checks.push({
      name: '麦克风权限',
      available: false,
      detail,
      error: err.name,
    });
  }

  // 4. 检查 HTTP STT 配置
  if (window.api && window.api.voice) {
    try {
      const sttConfig = await window.api.voice.getLocalSTTConfig();
      report.checks.push({
        name: '本地 STT 配置',
        available: !!(sttConfig && sttConfig.enabled && sttConfig.modelPath),
        detail: sttConfig?.enabled ? '本地 STT 已启用' : '本地 STT 未启用',
      });
    } catch {}
  }

  // 生成建议
  const micCheck = report.checks.find(c => c.name === '麦克风权限');
  const webSpeechCheck = report.checks.find(c => c.name === 'Web Speech API');

  if (!micCheck?.available) {
    report.recommendations.push('请检查麦克风连接并授予麦克风权限');
    report.overall = 'error';
  } else if (webSpeechCheck?.available) {
    report.recommendations.push('Web Speech API 国内网络可能不可用，建议配置 HTTP STT 服务（如自建 Whisper、百度/讯飞语音识别）');
    report.recommendations.push('在设置中配置 STT API 地址和密钥后，语音识别将使用配置的服务');
    report.overall = 'warning';
  } else {
    report.recommendations.push('请配置 HTTP STT 服务以使用语音识别');
    report.overall = 'error';
  }

  return report;
}

// ============================================================
//  语音输入管理器（核心）
// ============================================================
class VoiceInputManager {
  /**
   * @param {Object} options
   * @param {Function} options.onStateChange - 状态变化回调 (state, prevState)
   * @param {Function} options.onResult - 实时识别结果回调 ({final, interim, full})
   * @param {Function} options.onFinalResult - 最终识别结果回调 (text) —— 识别完成后调用，文本放入输入框
   * @param {Function} options.onError - 错误回调 ({code, message, raw})
   * @param {Function} options.onLog - 日志回调 ({time, level, message})
   * @param {number} options.silenceTimeout - 静默超时（毫秒），设置后启用自动结束；不设置则仅手动结束
   * @param {number} options.speechThreshold - 判定为"在说话"的音量阈值（0-100），默认 12
   * @param {string} options.preferredProvider - 首选提供者 'bot' | 'http' | 'webspeech' | 'local'
   * @param {Object} options.botSTTConfig - STT 配置 {apiUrl, apiKey, model, language}
   * @param {Object} options.httpSTTConfig - HTTP STT 配置 {apiUrl, apiKey, model, language}
   */
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onFinalResult = options.onFinalResult || (() => {});
    this.onError = options.onError || (() => {});
    this.onLog = options.onLog || (() => {});

    this.silenceTimeout = options.silenceTimeout || 0; // 0 = 不启用自动结束
    this.speechThreshold = options.speechThreshold || 12;
    this.preferredProvider = options.preferredProvider || 'bot';
    this.botSTTConfig = options.botSTTConfig || null;
    this.httpSTTConfig = options.httpSTTConfig || null;

    this.state = VoiceState.IDLE;
    this.provider = null;
    this.consecutiveFailures = 0;
    this.lastResultText = '';
    this.hasSpeech = false;

    this._silenceTimer = null;
    this._lastSpeechTime = 0;
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
    this.log('info', `状态变化: ${prev} → ${newState}`);
    this.onStateChange(newState, prev);
  }

  // ── 初始化 STT 提供者 ──
  async _initProvider() {
    // 1. 最高优先级：内置 STT（国内可用，复用已有 API Key）
    if (this.botSTTConfig && this.botSTTConfig.apiKey) {
      const botSTT = new BotSTTProvider(this.botSTTConfig);
      if (botSTT.isSupported()) {
        this.log('info', `使用内置 STT 提供者: ${this.botSTTConfig.apiUrl}`);
        return botSTT;
      }
      this.log('warn', '内置 STT 初始化失败，尝试其他提供者');
    }

    // 2. 次优先级：HTTP STT（OpenAI 兼容的 /audio/transcriptions 接口）
    if (this.httpSTTConfig && this.httpSTTConfig.apiUrl && this.httpSTTConfig.apiKey) {
      const httpSTT = new HttpSTTProvider(this.httpSTTConfig);
      if (httpSTT.isSupported()) {
        this.log('info', `使用 HTTP STT 提供者: ${this.httpSTTConfig.apiUrl}`);
        return httpSTT;
      }
      this.log('warn', 'HTTP STT 初始化失败，尝试其他提供者');
    }

    // 3. 如果首选本地 STT
    if (this.preferredProvider === 'local') {
      const local = new LocalSTTProvider();
      if (local.isSupported()) {
        this.log('info', '使用本地 STT 提供者');
        return local;
      }
      this.log('warn', '本地 STT 不可用，回退到 Web Speech API');
    }

    // 4. 默认使用 Web Speech API（注意：国内网络可能无法连接 Google 服务）
    const webSpeech = new WebSpeechProvider({ lang: 'zh-CN' });
    if (webSpeech.isSupported()) {
      this.log('info', '使用 Web Speech API 提供者（注意：国内网络可能无法连接 Google 服务）');
      return webSpeech;
    }

    throw { code: VoiceError.STT_SERVICE, message: '当前环境不支持任何语音识别提供者，请配置内置 STT 或 HTTP STT 服务' };
  }

  // ── 开启麦克风采集（VoiceStart）──
  async start() {
    if (this.state === VoiceState.LISTENING || this.state === VoiceState.INITIALIZING) {
      this.log('warn', '语音输入已在进行中，忽略重复启动');
      return;
    }

    this.setState(VoiceState.INITIALIZING);
    this.lastResultText = '';
    this.hasSpeech = false;
    this._lastSpeechTime = Date.now();

    try {
      this.provider = await this._initProvider();

      // 绑定提供者回调
      this.provider.onResult = (result) => {
        this.hasSpeech = true;
        this._lastSpeechTime = Date.now();
        this.lastResultText = result.full;
        this.onResult(result);
      };

      // 如果启用了自动结束（silenceTimeout > 0），监听实时音量
      if (this.silenceTimeout > 0) {
        this.provider.onAudioLevel = (level) => {
          if (level >= this.speechThreshold) {
            this.hasSpeech = true;
            this._lastSpeechTime = Date.now();
            this._resetSilenceTimer();
          }
        };
      }

      this.provider.onError = (error) => {
        this._handleError(error);
      };

      this.provider.onEnd = (info) => {
        this._handleEnd(info);
      };

      await this.provider.start();
      this.setState(VoiceState.LISTENING);
      if (this.silenceTimeout > 0) {
        this.log('info', `麦克风采集已启动，静默 ${this.silenceTimeout}ms 后自动结束`);
        this._resetSilenceTimer();
      } else {
        this.log('info', '麦克风采集已启动，点击麦克风按钮结束录音');
      }

    } catch (error) {
      this._handleError(error);
      this.setState(VoiceState.ERROR);
    }
  }

  // ── 停止录音采集（VoiceStop）──
  stop() {
    if (this.state !== VoiceState.LISTENING && this.state !== VoiceState.INITIALIZING) {
      return;
    }

    this.log('info', '用户主动停止录音');
    this._clearSilenceTimer();

    if (this.provider) {
      if (typeof this.provider.stop === 'function') {
        // 本地提供者 stop 是 async，Web Speech 是 sync
        const result = this.provider.stop();
        if (result && typeof result.then === 'function') {
          result.catch(err => this.log('error', `停止录音失败: ${err.message}`));
        }
      }
    }

    // 如果没有检测到语音，直接结束
    if (!this.hasSpeech) {
      setTimeout(() => {
        if (this.state === VoiceState.LISTENING) {
          this._handleEnd({ final: '', full: '', manualStop: true });
        }
      }, 500);
    }
  }

  // ── 语音转文字（SpeechToText，内部由提供者实现）──
  // 暴露给外部的统一接口
  async speechToText(audioData) {
    if (!this.provider) {
      throw { code: VoiceError.STT_SERVICE, message: 'STT 提供者未初始化' };
    }
    // 对于 Web Speech API，音频数据由内部处理
    // 对于本地提供者，可传入外部音频数据
    return { text: this.lastResultText, confidence: 1.0 };
  }

  // ── 错误处理 ──
  _handleError(error) {
    const code = error.code || VoiceError.UNKNOWN;
    const message = error.message || ErrorMessages[code];

    this.log('error', `语音错误 [${code}]: ${message}`);

    // 用户主动取消不算失败
    if (code !== VoiceError.USER_ABORT) {
      this.consecutiveFailures++;
    }

    this.onError({
      code,
      message,
      raw: error.raw || error,
      consecutiveFailures: this.consecutiveFailures,
      shouldSuggestKeyboard: this.consecutiveFailures >= 2,
    });

    this._clearSilenceTimer();

    if (code !== VoiceError.USER_ABORT) {
      this.setState(VoiceState.ERROR);
    }
  }

  // ── 录音结束处理 ──
  _handleEnd(info) {
    this._clearSilenceTimer();

    const text = (info.final || info.full || '').trim();

    if (text) {
      this.lastResultText = text;
      this.consecutiveFailures = 0;
      this.log('success', `语音识别完成: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
      // 直接将识别文本送入输入框（追加模式），不自动发送
      this.onFinalResult(text);
      this.setState(VoiceState.IDLE);
    } else if (info.error) {
      this._handleError(info.error);
    } else {
      // 没有识别到文本
      this.log('info', '录音结束但未识别到文本');
      this.setState(VoiceState.IDLE);
    }
  }

  // ── 静音检测（仅当 silenceTimeout > 0 时启用）──
  _resetSilenceTimer() {
    if (this.silenceTimeout <= 0) return;
    this._clearSilenceTimer();
    this._silenceTimer = setTimeout(() => {
      if (this.state === VoiceState.LISTENING) {
        const silenceDuration = Date.now() - this._lastSpeechTime;
        if (silenceDuration >= this.silenceTimeout) {
          this.log('info', `检测到静默 ${silenceDuration}ms，自动停止录音`);
          this.stop();
        }
      }
    }, this.silenceTimeout);
  }

  _clearSilenceTimer() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  // ── 销毁 ──
  destroy() {
    this._clearSilenceTimer();
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.setState(VoiceState.IDLE);
  }

  // ── 获取当前状态 ──
  getState() {
    return this.state;
  }

  getConsecutiveFailures() {
    return this.consecutiveFailures;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VoiceInputManager, VoiceError, VoiceState, ErrorMessages, WebSpeechProvider, LocalSTTProvider, HttpSTTProvider, BotSTTProvider, diagnoseVoiceEnvironment };
}
