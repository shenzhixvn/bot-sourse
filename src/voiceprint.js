// ============================================================
//  BOT — 声纹识别模块（Voiceprint / Speaker Verification）
//  功能：MFCC 特征提取、声纹注册（多段录入）、实时声纹验证（余弦相似度比对）
//  架构：纯前端实现，基于 Web Audio API，无需外部依赖
// ============================================================

const VoiceprintState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  ERROR: 'error',
};

// ============================================================
//  MFCC 特征提取器
// ============================================================
class MFCCExtractor {
  /**
   * @param {Object} options
   * @param {number} options.sampleRate - 采样率（默认 16000）
   * @param {number} options.fftSize - FFT 大小（默认 512）
   * @param {number} options.numFilters - 梅尔滤波器数（默认 26）
   * @param {number} options.numCoeffs - MFCC 系数数量（默认 13）
   * @param {number} options.frameLength - 帧长（毫秒，默认 25）
   * @param {number} options.frameShift - 帧移（毫秒，默认 10）
   * @param {number} options.preEmphasis - 预加重系数（默认 0.97）
   */
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.fftSize = options.fftSize || 512;
    this.numFilters = options.numFilters || 26;
    this.numCoeffs = options.numCoeffs || 13;
    this.frameLength = options.frameLength || 25;
    this.frameShift = options.frameShift || 10;
    this.preEmphasis = options.preEmphasis || 0.97;

    this.frameSize = Math.floor(this.sampleRate * this.frameLength / 1000);
    this.frameStep = Math.floor(this.sampleRate * this.frameShift / 1000);

    // 预计算汉明窗
    this.hammingWindow = new Float64Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      this.hammingWindow[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (this.frameSize - 1));
    }

    // 预计算梅尔滤波器组
    this.filterBank = this._buildMelFilterBank();
  }

  // 构建梅尔滤波器组
  _buildMelFilterBank() {
    const lowFreq = 0;
    const highFreq = this.sampleRate / 2;
    const lowMel = this._freqToMel(lowFreq);
    const highMel = this._freqToMel(highFreq);

    const melPoints = [];
    for (let i = 0; i <= this.numFilters + 1; i++) {
      melPoints.push(this._melToFreq(lowMel + (highMel - lowMel) * i / (this.numFilters + 1)));
    }

    const bins = melPoints.map(f => Math.floor((this.fftSize + 1) * f / this.sampleRate));

    const filters = [];
    for (let i = 1; i <= this.numFilters; i++) {
      const filter = new Float64Array(this.fftSize / 2 + 1);
      const left = bins[i - 1];
      const center = bins[i];
      const right = bins[i + 1];

      for (let j = left; j < center; j++) {
        filter[j] = (j - left) / (center - left);
      }
      for (let j = center; j < right; j++) {
        filter[j] = (right - j) / (right - center);
      }
      filters.push(filter);
    }
    return filters;
  }

  _freqToMel(freq) {
    return 2595 * Math.log10(1 + freq / 700);
  }

  _melToFreq(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  // 预加重
  _preEmphasize(signal) {
    const result = new Float64Array(signal.length);
    result[0] = signal[0];
    for (let i = 1; i < signal.length; i++) {
      result[i] = signal[i] - this.preEmphasis * signal[i - 1];
    }
    return result;
  }

  // FFT（迭代基2 Cooley-Tukey）
  _fft(input) {
    const n = input.length;
    if (n <= 1) return input;

    // 位反转排序
    const bits = Math.log2(n);
    const output = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | (i >> j & 1);
      }
      output[rev] = input[i];
    }

    // 使用复数 FFT
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      real[i] = output[i];
      imag[i] = 0;
    }

    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angleStep = -2 * Math.PI / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const angle = angleStep * j;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const tReal = cos * real[i + j + halfSize] - sin * imag[i + j + halfSize];
          const tImag = sin * real[i + j + halfSize] + cos * imag[i + j + halfSize];
          real[i + j + halfSize] = real[i + j] - tReal;
          imag[i + j + halfSize] = imag[i + j] - tImag;
          real[i + j] += tReal;
          imag[i + j] += tImag;
        }
      }
    }

    // 计算幅度谱
    const magnitude = new Float64Array(n / 2 + 1);
    for (let i = 0; i <= n / 2; i++) {
      magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return magnitude;
  }

  // DCT-II 离散余弦变换
  _dct(input) {
    const n = input.length;
    const result = new Float64Array(this.numCoeffs);
    for (let k = 0; k < this.numCoeffs; k++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += input[i] * Math.cos(Math.PI * k * (2 * i + 1) / (2 * n));
      }
      result[k] = sum;
    }
    // 归一化
    result[0] *= Math.sqrt(1 / n);
    for (let k = 1; k < this.numCoeffs; k++) {
      result[k] *= Math.sqrt(2 / n);
    }
    return result;
  }

  /**
   * 从音频信号提取 MFCC 特征序列
   * @param {Float32Array|Float64Array|number[]} signal - 音频信号（单声道）
   * @returns {Float64Array[]} 每帧的 MFCC 向量数组
   */
  extract(signal) {
    const samples = new Float64Array(signal.length);
    for (let i = 0; i < signal.length; i++) samples[i] = signal[i];

    // 1. 预加重
    const emphasized = this._preEmphasize(samples);

    // 2. 分帧 + 加窗 + FFT + 梅尔滤波 + 对数 + DCT
    const mfccFrames = [];
    const numFrames = Math.floor((emphasized.length - this.frameSize) / this.frameStep) + 1;

    for (let f = 0; f < numFrames; f++) {
      const start = f * this.frameStep;
      const frame = new Float64Array(this.fftSize);

      // 加窗
      for (let i = 0; i < this.frameSize && start + i < emphasized.length; i++) {
        frame[i] = emphasized[start + i] * this.hammingWindow[i];
      }

      // FFT
      const magnitude = this._fft(frame);

      // 梅尔滤波器组
      const filterEnergies = new Float64Array(this.numFilters);
      for (let m = 0; m < this.numFilters; m++) {
        let energy = 0;
        for (let k = 0; k < magnitude.length; k++) {
          energy += magnitude[k] * this.filterBank[m][k];
        }
        // 对数（避免 log(0)）
        filterEnergies[m] = Math.log(Math.max(energy, 1e-10));
      }

      // DCT
      const mfcc = this._dct(filterEnergies);
      mfccFrames.push(mfcc);
    }

    return mfccFrames;
  }

  /**
   * 计算 MFCC 特征序列的统计向量（均值 + 标准差）
   * 用于声纹模板比对
   * @param {Float64Array[]} mfccFrames
   * @returns {Float64Array} 2*numCoeffs 维向量（均值 + 标准差）
   */
  computeStats(mfccFrames) {
    if (!mfccFrames || mfccFrames.length === 0) {
      return new Float64Array(this.numCoeffs * 2);
    }

    const dim = this.numCoeffs;
    const mean = new Float64Array(dim);
    const std = new Float64Array(dim);

    // 均值
    for (const frame of mfccFrames) {
      for (let i = 0; i < dim; i++) {
        mean[i] += frame[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      mean[i] /= mfccFrames.length;
    }

    // 标准差
    for (const frame of mfccFrames) {
      for (let i = 0; i < dim; i++) {
        const diff = frame[i] - mean[i];
        std[i] += diff * diff;
      }
    }
    for (let i = 0; i < dim; i++) {
      std[i] = Math.sqrt(std[i] / mfccFrames.length);
    }

    // 合并为 2*dim 维向量
    const result = new Float64Array(dim * 2);
    result.set(mean, 0);
    result.set(std, dim);
    return result;
  }
}

// ============================================================
//  声纹管理器（注册 / 验证 / 存储）
// ============================================================
class VoiceprintManager {
  /**
   * @param {Object} options
   * @param {number} options.sampleRate - 采样率（默认 16000）
   * @param {number} options.threshold - 验证阈值（余弦相似度，默认 0.82）
   * @param {number} options.minDuration - 最短录音时长（秒，默认 2）
   * @param {number} options.numRegistrations - 注册所需段数（默认 3）
   * @param {Function} options.onStateChange - 状态变化回调
   * @param {Function} options.onLog - 日志回调
   */
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.threshold = options.threshold || 0.82;
    this.minDuration = options.minDuration || 2;
    this.numRegistrations = options.numRegistrations || 3;
    this.onStateChange = options.onStateChange || (() => {});
    this.onLog = options.onLog || (() => {});

    this.extractor = new MFCCExtractor({ sampleRate: this.sampleRate });
    this.state = VoiceprintState.IDLE;

    // 声纹模板（统计向量）
    this.template = null;
    this.templateMeta = null; // { registeredAt, numSamples, avgDuration }

    // 录音相关
    this._mediaRecorder = null;
    this._audioChunks = [];
    this._stream = null;
    this._isRecording = false;
    this._recordStartTime = 0;
  }

  log(level, message) {
    const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, message };
    this.onLog(entry);
  }

  setState(newState) {
    const prev = this.state;
    this.state = newState;
    this.onStateChange(newState, prev);
  }

  // ── 声纹是否已注册 ──
  isRegistered() {
    return this.template !== null && this.template.length > 0;
  }

  // ── 获取模板信息 ──
  getTemplateInfo() {
    if (!this.templateMeta) return null;
    return { ...this.templateMeta };
  }

  // ── 设置阈值 ──
  setThreshold(threshold) {
    this.threshold = Math.max(0.5, Math.min(0.99, threshold));
    this.log('info', `声纹验证阈值设置为 ${this.threshold}`);
  }

  // ── 开始录音（用于注册或验证）──
  async startRecording() {
    if (this._isRecording) {
      this.log('warn', '已经在录音中');
      return;
    }

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('麦克风权限被拒绝，请在系统设置中允许麦克风访问');
      }
      throw new Error('无法访问麦克风: ' + err.message);
    }

    this._audioChunks = [];
    this._isRecording = true;
    this._recordStartTime = Date.now();

    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    }

    this._mediaRecorder = new MediaRecorder(this._stream, { mimeType });
    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._audioChunks.push(e.data);
    };
    this._mediaRecorder.start(250);

    this.setState(VoiceprintState.RECORDING);
    this.log('info', '声纹录音已开始');
  }

  // ── 停止录音并返回音频数据 ──
  async stopRecording() {
    if (!this._isRecording) return null;

    this._isRecording = false;
    const duration = (Date.now() - this._recordStartTime) / 1000;

    return new Promise((resolve) => {
      if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
        this._mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(this._audioChunks, { type: this._mediaRecorder.mimeType || 'audio/webm' });
          this._cleanupStream();

          if (duration < this.minDuration) {
            this.log('warn', `录音时长 ${duration.toFixed(1)}s 不足 ${this.minDuration}s`);
            resolve({ blob: audioBlob, duration, valid: false, reason: `录音时长不足（需 ${this.minDuration} 秒）` });
            return;
          }

          resolve({ blob: audioBlob, duration, valid: true });
        };
        this._mediaRecorder.stop();
      } else {
        this._cleanupStream();
        resolve(null);
      }
    });
  }

  // ── 将 Blob 解码为 AudioBuffer ──
  async _decodeAudio(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: this.sampleRate });
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // 重采样到目标采样率（如果需要）
      if (audioBuffer.sampleRate !== this.sampleRate) {
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * this.sampleRate), this.sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        const resampled = await offlineCtx.startRendering();
        return resampled.getChannelData(0);
      }
      return audioBuffer.getChannelData(0);
    } finally {
      audioContext.close();
    }
  }

  // ── 注册声纹（多段录音取平均）──
  /**
   * @param {Blob[]} audioBlobs - 多段录音 Blob 数组
   * @returns {Promise<{success: boolean, template: number[], meta: Object}>}
   */
  async register(audioBlobs) {
    if (!audioBlobs || audioBlobs.length === 0) {
      return { success: false, error: '没有提供录音数据' };
    }

    this.setState(VoiceprintState.PROCESSING);
    this.log('info', `开始注册声纹，共 ${audioBlobs.length} 段录音`);

    try {
      const allStats = [];
      let totalDuration = 0;

      for (let i = 0; i < audioBlobs.length; i++) {
        const blob = audioBlobs[i];
        const signal = await this._decodeAudio(blob);
        const mfccFrames = this.extractor.extract(signal);

        if (mfccFrames.length < 10) {
          this.log('warn', `第 ${i + 1} 段录音有效帧过少（${mfccFrames.length} 帧），跳过`);
          continue;
        }

        const stats = this.extractor.computeStats(mfccFrames);
        allStats.push(stats);
        totalDuration += signal.length / this.sampleRate;
        this.log('info', `第 ${i + 1} 段处理完成，${mfccFrames.length} 帧，${(signal.length / this.sampleRate).toFixed(1)}s`);
      }

      if (allStats.length === 0) {
        this.setState(VoiceprintState.ERROR);
        return { success: false, error: '所有录音均无效，请重新录制' };
      }

      // 多段取平均作为最终模板
      const dim = allStats[0].length;
      const template = new Float64Array(dim);
      for (const stats of allStats) {
        for (let i = 0; i < dim; i++) {
          template[i] += stats[i];
        }
      }
      for (let i = 0; i < dim; i++) {
        template[i] /= allStats.length;
      }

      // L2 归一化模板
      this.template = this._normalize(template);
      this.templateMeta = {
        registeredAt: new Date().toISOString(),
        numSamples: allStats.length,
        avgDuration: totalDuration / allStats.length,
        dim: dim,
      };

      this.setState(VoiceprintState.IDLE);
      this.log('success', `声纹注册成功！${allStats.length} 段有效录音，平均时长 ${(totalDuration / allStats.length).toFixed(1)}s`);

      return {
        success: true,
        template: Array.from(this.template),
        meta: this.templateMeta,
      };
    } catch (err) {
      this.setState(VoiceprintState.ERROR);
      this.log('error', '声纹注册失败: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  // ── 验证声纹 ──
  /**
   * @param {Blob} audioBlob - 待验证的录音
   * @returns {Promise<{success: boolean, verified: boolean, score: number, threshold: number}>}
   */
  async verify(audioBlob) {
    if (!this.isRegistered()) {
      return { success: false, verified: false, error: '尚未注册声纹' };
    }

    this.setState(VoiceprintState.PROCESSING);

    try {
      const signal = await this._decodeAudio(audioBlob);
      const mfccFrames = this.extractor.extract(signal);

      if (mfccFrames.length < 10) {
        this.setState(VoiceprintState.REJECTED);
        return { success: false, verified: false, error: '录音有效帧过少', score: 0, threshold: this.threshold };
      }

      const stats = this.extractor.computeStats(mfccFrames);
      const normalized = this._normalize(stats);

      // 余弦相似度
      const score = this._cosineSimilarity(this.template, normalized);

      const verified = score >= this.threshold;

      if (verified) {
        this.setState(VoiceprintState.VERIFIED);
        this.log('success', `声纹验证通过！相似度 ${(score * 100).toFixed(1)}%（阈值 ${(this.threshold * 100).toFixed(1)}%）`);
      } else {
        this.setState(VoiceprintState.REJECTED);
        this.log('warn', `声纹验证未通过！相似度 ${(score * 100).toFixed(1)}%（阈值 ${(this.threshold * 100).toFixed(1)}%）`);
      }

      setTimeout(() => this.setState(VoiceprintState.IDLE), 1500);

      return { success: true, verified, score, threshold: this.threshold };
    } catch (err) {
      this.setState(VoiceprintState.ERROR);
      this.log('error', '声纹验证失败: ' + err.message);
      return { success: false, verified: false, error: err.message };
    }
  }

  // ── 从 Float32Array 直接验证（用于唤醒词场景，复用已采集的音频）──
  async verifyFromSignal(signal) {
    if (!this.isRegistered()) {
      return { success: false, verified: false, error: '尚未注册声纹' };
    }

    try {
      const mfccFrames = this.extractor.extract(signal);
      if (mfccFrames.length < 10) {
        return { success: false, verified: false, error: '音频帧过少', score: 0, threshold: this.threshold };
      }
      const stats = this.extractor.computeStats(mfccFrames);
      const normalized = this._normalize(stats);
      const score = this._cosineSimilarity(this.template, normalized);
      const verified = score >= this.threshold;
      return { success: true, verified, score, threshold: this.threshold };
    } catch (err) {
      return { success: false, verified: false, error: err.message };
    }
  }

  // ── 清除声纹 ──
  clear() {
    this.template = null;
    this.templateMeta = null;
    this.setState(VoiceprintState.IDLE);
    this.log('info', '声纹已清除');
  }

  // ── 导出声纹数据（用于保存到配置）──
  exportData() {
    if (!this.isRegistered()) return null;
    return {
      template: Array.from(this.template),
      meta: this.templateMeta,
      threshold: this.threshold,
    };
  }

  // ── 导入声纹数据（从配置恢复）──
  importData(data) {
    if (!data || !data.template || !Array.isArray(data.template)) {
      return false;
    }
    this.template = Float64Array.from(data.template);
    this.templateMeta = data.meta || null;
    if (data.threshold) this.threshold = data.threshold;
    this.log('info', '声纹数据已导入');
    return true;
  }

  // ── 工具方法 ──
  _normalize(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    const result = new Float64Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      result[i] = vec[i] / norm;
    }
    return result;
  }

  _cosineSimilarity(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
    }
    return dot; // 已归一化，点积即余弦
  }

  _cleanupStream() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._mediaRecorder) {
      try { this._mediaRecorder.stop(); } catch {}
      this._mediaRecorder = null;
    }
  }

  // ── 销毁 ──
  destroy() {
    this._cleanupStream();
    this._audioChunks = [];
    this._isRecording = false;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VoiceprintManager, MFCCExtractor, VoiceprintState };
}
