/**
 * AI Provider 管理器
 * 管理多套提供商配置，支持切换当前激活的 Provider
 */
const { createProvider } = require('./aiProvider');

class ProviderManager {
  constructor() {
    this.providers = [];        // 提供商配置列表
    this.activeProviderId = null; // 当前激活的提供商 ID
    this.activeInstance = null;   // 当前激活的 Provider 实例
  }

  /**
   * 加载配置
   * @param {Object} config - 完整配置对象
   */
  loadConfig(config) {
    // 兼容旧配置：如果没有 providers 数组，从旧字段生成默认提供商
    if (!config.providers || !Array.isArray(config.providers) || config.providers.length === 0) {
      this.providers = [this._createDefaultProvider(config)];
      this.activeProviderId = this.providers[0].id;
    } else {
      this.providers = config.providers;
      this.activeProviderId = config.activeProvider || this.providers[0].id;
    }
    this._refreshInstance();
  }

  /**
   * 从旧配置生成默认提供商（兼容迁移）
   */
  _createDefaultProvider(config) {
    return {
      id: 'default-mimo',
      name: '小米 MiMo',
      type: 'openai-compatible',
      baseUrl: config.baseUrl || 'https://api.xiaomimimo.com/v1',
      apiKey: config.apiKey || '',
      model: config.model || 'mimo-v2.5-pro',
      maxTokens: config.maxTokens || 2048,
    };
  }

  /**
   * 刷新当前激活的 Provider 实例
   */
  _refreshInstance() {
    const cfg = this.providers.find(p => p.id === this.activeProviderId);
    if (cfg) {
      this.activeInstance = createProvider(cfg);
    } else if (this.providers.length > 0) {
      this.activeProviderId = this.providers[0].id;
      this.activeInstance = createProvider(this.providers[0]);
    } else {
      this.activeInstance = null;
    }
  }

  /**
   * 获取当前激活的 Provider 实例
   */
  getActive() {
    return this.activeInstance;
  }

  /**
   * 获取当前激活的提供商配置
   */
  getActiveConfig() {
    return this.providers.find(p => p.id === this.activeProviderId) || null;
  }

  /**
   * 获取所有提供商列表
   */
  list() {
    return this.providers.map(p => ({ ...p }));
  }

  /**
   * 保存/更新提供商配置
   * @param {Object} providerConfig - 提供商配置（含 id 则更新，不含则新增）
   */
  save(providerConfig) {
    if (!providerConfig.id) {
      providerConfig.id = 'provider-' + Date.now();
      this.providers.push(providerConfig);
    } else {
      const idx = this.providers.findIndex(p => p.id === providerConfig.id);
      if (idx >= 0) {
        this.providers[idx] = { ...this.providers[idx], ...providerConfig };
      } else {
        this.providers.push(providerConfig);
      }
    }
    if (providerConfig.id === this.activeProviderId) {
      this._refreshInstance();
    }
    return providerConfig;
  }

  /**
   * 删除提供商
   * @param {string} id - 提供商 ID
   */
  remove(id) {
    const idx = this.providers.findIndex(p => p.id === id);
    if (idx < 0) return false;
    // 不允许删除最后一个提供商
    if (this.providers.length <= 1) return false;
    this.providers.splice(idx, 1);
    if (this.activeProviderId === id) {
      this.activeProviderId = this.providers[0].id;
      this._refreshInstance();
    }
    return true;
  }

  /**
   * 切换当前激活的提供商
   * @param {string} id - 提供商 ID
   */
  setActive(id) {
    const exists = this.providers.find(p => p.id === id);
    if (!exists) return false;
    this.activeProviderId = id;
    this._refreshInstance();
    return true;
  }

  /**
   * 测试指定提供商的连接
   * @param {string} id - 提供商 ID
   */
  async test(id) {
    const cfg = this.providers.find(p => p.id === id);
    if (!cfg) return { success: false, error: '提供商不存在' };
    const instance = createProvider(cfg);
    return await instance.test();
  }

  /**
   * 导出配置（用于保存到 config.json）
   */
  exportConfig() {
    return {
      providers: this.providers.map(p => ({ ...p })),
      activeProvider: this.activeProviderId,
    };
  }
}

module.exports = ProviderManager;
