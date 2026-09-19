/**
 * AI Provider 抽象基类
 * 所有提供商适配器都继承此类，实现统一接口
 */
class BaseProvider {
  constructor(config) {
    this.config = config || {};
    this.abortController = null;
  }

  /**
   * 流式聊天
   * @param {Array} messages - 消息数组 [{role, content}]
   * @param {Object} options - { model, maxTokens, temperature }
   * @param {Function} onChunk - 每收到一个 chunk 时回调 (deltaText) => void
   * @returns {Promise<string>} 完整回复文本
   */
  async stream(messages, options, onChunk) {
    throw new Error('子类必须实现 stream 方法');
  }

  /**
   * 中断当前请求
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 测试连接（发一条简单消息）
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async test() {
    try {
      await this.stream([{ role: 'user', content: 'hi' }], {}, () => {});
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  getModel() {
    return this.config.model || '';
  }
}

/**
 * OpenAI 兼容 API 适配器
 * 支持所有 OpenAI 格式的 API：DeepSeek、通义千问、智谱、月之暗面、OpenAI 等
 */
class OpenAICompatibleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.baseUrl = (config.baseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'mimo-v2.5-pro';
    this.maxTokens = config.maxTokens || 2048;
  }

  /**
   * 流式聊天
   * @param {Array} messages - 消息数组 [{role, content}]
   * @param {Object} options - { model, maxTokens, temperature, webSearch, webSearchMaxKeyword }
   * @param {Function} onChunk - 每收到一个文本 chunk 时回调 (deltaText) => void
   * @param {Function} onSources - 联网搜索来源回调 (sourcesArray) => void（可选）
   * @returns {Promise<string>} 完整回复文本
   */
  async stream(messages, options, onChunk, onSources) {
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || this.maxTokens;
    const temperature = options.temperature !== undefined ? options.temperature : 0.7;
    const webSearch = options.webSearch || false;
    const webSearchMaxKeyword = options.webSearchMaxKeyword || 3;

    this.abortController = new AbortController();

    const requestBody = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    // 联网搜索（部分提供商 API 支持）
    if (webSearch) {
      requestBody.tools = [{
        type: 'web_search',
        max_keyword: webSearchMaxKeyword,
        force_search: true,
        limit: 5,
      }];
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
          // 联网搜索来源
          if (onSources) {
            const annotations = parsed.choices?.[0]?.delta?.annotations || parsed.choices?.[0]?.message?.annotations;
            if (annotations && annotations.length > 0) {
              const sources = annotations
                .filter(a => a.type === 'url_citation')
                .map(a => ({
                  url: a.url,
                  title: a.title,
                  site_name: a.site_name,
                  publish_time: a.publish_time,
                }));
              if (sources.length > 0) onSources(sources);
            }
          }
        } catch (e) {
          // 忽略解析失败的行
        }
      }
    }

    this.abortController = null;
    return fullText;
  }
}

/**
 * Ollama 本地 API 适配器
 * 支持本地运行的 Ollama 服务（http://localhost:11434）
 */
class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3.1';
  }

  async stream(messages, options, onChunk) {
    const model = options.model || this.model;

    this.abortController = new AbortController();

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama 请求失败 (${response.status}): ${errText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const delta = parsed.message?.content || '';
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
        } catch (e) {
          // 忽略解析失败的行
        }
      }
    }

    this.abortController = null;
    return fullText;
  }
}

/**
 * Provider 工厂：根据配置创建对应的 Provider 实例
 */
function createProvider(config) {
  const type = config.type || 'openai-compatible';
  switch (type) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      return new OpenAICompatibleProvider(config);
  }
}

module.exports = {
  BaseProvider,
  OpenAICompatibleProvider,
  OllamaProvider,
  createProvider,
};
