/**
 * memoryStore.js — BOT 本地长期记忆（零依赖嵌入式向量存储）
 *
 * 设计：
 *   - 数据落盘为 JSON（%APPDATA%/BOT/memory/memory.json），随应用走，完全离线
 *   - 检索为余弦相似度暴力扫描（个人规模 < 10 万条下毫秒级）
 *   - 嵌入器可插拔：默认本地哈希嵌入；配置 embeddingModel 后走 API 嵌入
 *   - 若未来要换 LanceDB / Milvus，只需替换 _search / _persist 两个实现
 *
 * 对外 API：
 *   await store.init()
 *   await store.add(text, meta)
 *   await store.search(query, { topK, minScore })
 *   store.list({ limit, offset })
 *   await store.remove(id)
 *   await store.clear()
 *   store.stats()
 */

const fs = require('fs');
const path = require('path');
const { createEmbedder } = require('./embedding');

const STORE_VERSION = 1;

function hashText(text) {
  let h = 2166136261;
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function cosine(a, b) {
  // 双方都做过 L2 归一化，点积即余弦
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

class MemoryStore {
  /**
   * @param {Object} opts
   * @param {string} opts.dir        数据目录
   * @param {Object} opts.embedConfig { baseUrl, apiKey, embeddingModel }
   * @param {number} opts.maxItems   上限，超出按时间淘汰最旧
   */
  constructor({ dir, embedConfig = {}, maxItems = 20000 } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'memory.json');
    this.embedConfig = embedConfig;
    this.maxItems = maxItems;
    this.embedder = createEmbedder(embedConfig);
    this.dim = this.embedder.dim || 0;
    this.items = []; // { id, text, vec, hash, meta, ts }
    this.hashes = new Set();
    this._saveTimer = null;
    this._seq = 0;
    this.ready = false;
  }

  /** 配置变更时重建嵌入器（维度变化会触发全量重嵌） */
  async reconfigure(embedConfig) {
    this.embedConfig = embedConfig || {};
    this.embedder = createEmbedder(this.embedConfig);
    this.dim = this.embedder.dim || 0;
    // 维度不一致则清空向量，强制重嵌
    if (this.items.some((it) => it.vec && it.vec.length !== this.dim && this.dim > 0)) {
      await this._reembedAll();
    }
    await this._save();
  }

  async init() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        this.items = Array.isArray(data.items) ? data.items : [];
        if (data.dim) {
          this.dim = data.dim;
          this.embedder.dim = this.dim;
        }
      }
    } catch (e) {
      console.error('[memory] 读取失败，已忽略旧数据:', e.message);
      this.items = [];
    }
    this.hashes = new Set(this.items.map((it) => it.hash));
    this._seq = this.items.length ? Math.max(...this.items.map((it) => it.seq || 0)) + 1 : 1;
    this.ready = true;
    return this;
  }

  /** 新增一条记忆；重复内容（hash 相同）自动跳过 */
  async add(text, meta = {}) {
    const clean = String(text || '').trim();
    if (clean.length < 2) return { skipped: true, reason: 'too-short' };
    const h = hashText(clean);
    if (this.hashes.has(h)) return { skipped: true, reason: 'duplicate', hash: h };

    const [vec] = await this.embedder.embed([clean]);
    if (!this.dim) this.dim = vec.length;
    const item = {
      id: `${Date.now().toString(36)}-${(this._seq++).toString(36)}`,
      seq: this._seq,
      text: clean,
      hash: h,
      vec,
      meta,
      ts: Date.now(),
    };
    this.items.push(item);
    this.hashes.add(h);
    this._evict();
    this._scheduleSave();
    return { added: true, id: item.id };
  }

  /** 批量新增 */
  async addMany(list) {
    const results = [];
    for (const entry of list) {
      const text = typeof entry === 'string' ? entry : entry.text;
      const meta = typeof entry === 'string' ? {} : entry.meta;
      results.push(await this.add(text, meta));
    }
    return results;
  }

  /**
   * 语义检索
   * @returns {Promise<Array<{text,score,meta,ts,id}>>}
   */
  async search(query, { topK = 5, minScore = 0.1 } = {}) {
    const q = String(query || '').trim();
    if (!q || !this.items.length) return [];
    const [qv] = await this.embedder.embed([q]);
    const scored = this.items
      .filter((it) => Array.isArray(it.vec) && it.vec.length === qv.length)
      .map((it) => ({ id: it.id, text: it.text, meta: it.meta, ts: it.ts, score: cosine(qv, it.vec) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= minScore).slice(0, topK);
  }

  list({ limit = 100, offset = 0 } = {}) {
    return this.items
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(offset, offset + limit)
      .map((it) => ({ id: it.id, text: it.text, meta: it.meta, ts: it.ts }));
  }

  async remove(id) {
    const before = this.items.length;
    const removed = this.items.filter((it) => it.id === id);
    this.items = this.items.filter((it) => it.id !== id);
    removed.forEach((it) => this.hashes.delete(it.hash));
    if (this.items.length !== before) await this._save();
    return { removed: before - this.items.length };
  }

  async clear() {
    this.items = [];
    this.hashes.clear();
    await this._save();
    return { cleared: true };
  }

  stats() {
    return {
      count: this.items.length,
      dim: this.dim,
      embedder: this.embedder.name,
      maxItems: this.maxItems,
      file: this.file,
    };
  }

  // ---------------- 内部 ----------------

  _evict() {
    if (this.items.length <= this.maxItems) return;
    this.items.sort((a, b) => a.ts - b.ts); // 旧的在前
    const overflow = this.items.length - this.maxItems;
    const removed = this.items.splice(0, overflow);
    removed.forEach((it) => this.hashes.delete(it.hash));
  }

  async _reembedAll() {
    const texts = this.items.map((it) => it.text);
    if (!texts.length) return;
    const vecs = await this.embedder.embed(texts);
    this.dim = vecs[0].length;
    this.items.forEach((it, i) => (it.vec = vecs[i]));
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save().catch((e) => console.error('[memory] 保存失败:', e.message));
    }, 800);
  }

  async _save() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    const data = { version: STORE_VERSION, dim: this.dim, savedAt: Date.now(), items: this.items };
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file); // 原子替换
    return { saved: true };
  }

  /** 立即落盘（退出前调用） */
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    return this._save();
  }
}

module.exports = { MemoryStore, hashText };
