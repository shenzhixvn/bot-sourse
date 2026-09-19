// ============================================================
//  BOT — 语音输入(STT)模块测试
//  测试：错误分类、状态机、连续失败、识别结果直接入输入框
// ============================================================

// Mock 浏览器环境
global.window = {
  SpeechRecognition: null,
  webkitSpeechRecognition: null,
};
global.navigator = {
  mediaDevices: {
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => {} }],
    }),
  },
};
global.document = { createElement: () => ({}) };

// 加载模块
const { VoiceInputManager, VoiceError, VoiceState, ErrorMessages, WebSpeechProvider } = require('./src/voiceModule');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Mock SpeechRecognition 类
class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onresult = null;
  }
  start() { if (this.onstart) this.onstart(); }
  stop() { if (this.onend) this.onend(); }
  abort() { if (this.onend) this.onend(); }
}

async function main() {
  // ── 1. 错误分类与错误信息 ──
  section('1. 错误分类与错误信息');

  assert(VoiceError.MIC_PERMISSION === 'MIC_PERMISSION', 'MIC_PERMISSION 错误码定义正确');
  assert(VoiceError.AUDIO_HARDWARE === 'AUDIO_HARDWARE', 'AUDIO_HARDWARE 错误码定义正确');
  assert(VoiceError.AUDIO_ENCODING === 'AUDIO_ENCODING', 'AUDIO_ENCODING 错误码定义正确');
  assert(VoiceError.STT_SERVICE === 'STT_SERVICE', 'STT_SERVICE 错误码定义正确');
  assert(VoiceError.NO_SPEECH === 'NO_SPEECH', 'NO_SPEECH 错误码定义正确');
  assert(VoiceError.USER_ABORT === 'USER_ABORT', 'USER_ABORT 错误码定义正确');

  assert(ErrorMessages[VoiceError.MIC_PERMISSION].includes('麦克风权限'), '权限错误信息包含"麦克风权限"');
  assert(ErrorMessages[VoiceError.AUDIO_HARDWARE].includes('无法采集音频'), '硬件错误信息包含"无法采集音频"');
  assert(ErrorMessages[VoiceError.AUDIO_ENCODING].includes('音频编码异常'), '编码错误信息包含"音频编码异常"');
  assert(ErrorMessages[VoiceError.STT_SERVICE].includes('语音识别服务异常'), '服务错误信息包含"语音识别服务异常"');
  assert(ErrorMessages[VoiceError.NO_SPEECH].includes('未检测到清晰人声'), '无语音错误信息包含"未检测到清晰人声"');

  // ── 2. Web Speech API 错误映射 ──
  section('2. Web Speech API 错误码映射');

  const provider = new WebSpeechProvider();
  const errorMapping = {
    'not-allowed': VoiceError.MIC_PERMISSION,
    'service-not-allowed': VoiceError.MIC_PERMISSION,
    'audio-capture': VoiceError.AUDIO_HARDWARE,
    'no-speech': VoiceError.NO_SPEECH,
    'network': VoiceError.STT_SERVICE,
    'aborted': VoiceError.USER_ABORT,
    'language-not-supported': VoiceError.STT_SERVICE,
    'bad-grammar': VoiceError.AUDIO_ENCODING,
    'unknown-error': VoiceError.UNKNOWN,
  };

  for (const [rawError, expectedCode] of Object.entries(errorMapping)) {
    const mapped = provider._mapError(rawError);
    assert(mapped.code === expectedCode, `错误码 "${rawError}" 映射为 ${expectedCode}（实际 ${mapped.code}）`);
    assert(mapped.message === ErrorMessages[expectedCode], `错误码 "${rawError}" 对应正确的错误信息`);
  }

  // ── 3. 状态机初始状态 ──
  section('3. 状态机初始状态');

  const vm = new VoiceInputManager();

  assert(vm.getState() === VoiceState.IDLE, '初始状态为 IDLE');
  assert(vm.getConsecutiveFailures() === 0, '初始连续失败次数为 0');
  assert(typeof vm.preferredProvider === 'string', '首选提供者已配置');

  // ── 4. 状态变化回调 ──
  section('4. 状态变化回调');

  let stateChanges = [];
  const vm2 = new VoiceInputManager({
    onStateChange: (state, prev) => stateChanges.push({ from: prev, to: state }),
  });

  vm2.setState(VoiceState.LISTENING);
  assert(stateChanges.length === 1, '状态变化触发回调');
  assert(stateChanges[0].from === VoiceState.IDLE, '状态变化记录正确的起始状态');
  assert(stateChanges[0].to === VoiceState.LISTENING, '状态变化记录正确的目标状态');

  vm2.setState(VoiceState.PROCESSING);
  assert(stateChanges.length === 2, '第二次状态变化也触发回调');
  assert(stateChanges[1].to === VoiceState.PROCESSING, '第二次状态变化目标正确');

  // ── 5. 连续失败计数 ──
  section('5. 连续失败计数与键盘建议');

  let lastError = null;
  const vm3 = new VoiceInputManager({
    onError: (err) => { lastError = err; },
  });

  // 第一次失败
  vm3._handleError({ code: VoiceError.NO_SPEECH, message: 'test' });
  assert(vm3.getConsecutiveFailures() === 1, '第一次失败后计数为 1');
  assert(lastError.shouldSuggestKeyboard === false, '第一次失败不建议切换键盘');

  // 第二次失败
  vm3._handleError({ code: VoiceError.STT_SERVICE, message: 'test' });
  assert(vm3.getConsecutiveFailures() === 2, '第二次失败后计数为 2');
  assert(lastError.shouldSuggestKeyboard === true, '连续2次失败建议切换键盘');

  // 用户取消不算失败
  vm3._handleError({ code: VoiceError.USER_ABORT, message: 'test' });
  assert(vm3.getConsecutiveFailures() === 2, '用户取消不增加失败计数');

  // ── 6. 识别完成直接触发结果回调（无确认面板） ──
  section('6. 识别完成直接触发 onFinalResult（无确认面板）');

  let finalResult = null;
  let finalState = null;
  const vm4 = new VoiceInputManager({
    onFinalResult: (text) => { finalResult = text; },
    onStateChange: (state) => { finalState = state; },
  });

  // 模拟录音结束且有识别文本
  vm4.setState(VoiceState.LISTENING);
  vm4._handleEnd({ final: '测试语音识别内容', full: '测试语音识别内容', manualStop: true });

  assert(finalResult === '测试语音识别内容', '识别完成后直接触发 onFinalResult 回调');
  assert(finalState === VoiceState.IDLE, '识别完成后状态回到 IDLE');
  assert(vm4.getConsecutiveFailures() === 0, '成功识别后重置失败计数');

  // ── 7. 空识别结果处理 ──
  section('7. 空识别结果处理');

  let errorTriggered = false;
  const vm5 = new VoiceInputManager({
    onError: () => { errorTriggered = true; },
  });

  vm5.setState(VoiceState.LISTENING);
  vm5._handleEnd({ final: '', full: '', manualStop: true, error: { code: VoiceError.NO_SPEECH, message: 'test' } });
  assert(errorTriggered === true, '识别错误时触发错误回调');

  // 无错误但空文本
  let stateAfterEmpty = null;
  const vm5b = new VoiceInputManager({
    onStateChange: (state) => { stateAfterEmpty = state; },
  });
  vm5b.setState(VoiceState.LISTENING);
  vm5b._handleEnd({ final: '', full: '', manualStop: true });
  assert(stateAfterEmpty === VoiceState.IDLE, '空文本识别后状态回到 IDLE');

  // ── 8. 日志系统 ──
  section('8. 操作日志');

  let logs = [];
  const vm6 = new VoiceInputManager({
    onLog: (entry) => logs.push(entry),
  });

  vm6.log('info', '测试日志信息');
  vm6.log('error', '测试错误日志');
  vm6.log('success', '测试成功日志');

  assert(logs.length === 3, '日志记录正确数量');
  assert(logs[0].level === 'info', '日志级别正确');
  assert(logs[0].message === '测试日志信息', '日志内容正确');
  assert(logs[0].time, '日志包含时间戳');
  assert(typeof logs[0].time === 'string', '时间戳为字符串');

  // ── 9. STT 提供者选择 ──
  section('9. STT 提供者选择逻辑');

  // Web Speech API 不可用时
  window.SpeechRecognition = null;
  window.webkitSpeechRecognition = null;
  const wsProvider = new WebSpeechProvider();
  assert(wsProvider.isSupported() === false, 'Web Speech API 不可用时 isSupported 返回 false');

  // Web Speech API 可用时
  window.SpeechRecognition = MockSpeechRecognition;
  const wsProvider2 = new WebSpeechProvider();
  assert(wsProvider2.isSupported() === true, 'Web Speech API 可用时 isSupported 返回 true');

  // ── 10. 模块销毁与资源清理 ──
  section('10. 模块销毁与资源清理');

  const vm8 = new VoiceInputManager();
  vm8.provider = new WebSpeechProvider();

  vm8.destroy();
  assert(vm8.provider === null, '销毁后提供者已释放');
  assert(vm8.getState() === VoiceState.IDLE, '销毁后状态回到 IDLE');

  // ── 11. 默认手动结束（可选自动结束） ──
  section('11. 默认手动结束（可选自动结束）');

  const vm9 = new VoiceInputManager();
  // 默认不启用自动结束
  assert(vm9.silenceTimeout === 0, '默认不启用静默自动结束（silenceTimeout=0）');
  assert(vm9.maxDuration === undefined, '已移除最长时长配置');
  assert(typeof vm9._resetSilenceTimer === 'function', '静音计时器方法存在（可选启用）');
  assert(typeof vm9._startMaxTimer !== 'function', '已移除最长时长计时器方法');
  assert(typeof vm9.confirmResult !== 'function', '已移除确认结果方法（无确认面板）');
  assert(typeof vm9.cancelResult !== 'function', '已移除取消结果方法');
  assert(typeof vm9.retry !== 'function', '已移除重新录入方法');

  // 配置 silenceTimeout 后启用自动结束
  const vm10 = new VoiceInputManager({ silenceTimeout: 2000 });
  assert(vm10.silenceTimeout === 2000, '配置 silenceTimeout 后启用自动结束');

  // ── 总结 ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  测试完成：通过 ${passed} 项，失败 ${failed} 项`);
  console.log(`${'='.repeat(60)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
