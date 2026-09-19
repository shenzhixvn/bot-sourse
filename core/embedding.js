/**
 * embedding.js — 文本向量化
 *
 * 两种模式：
 *   1. API 模式：调用当前提供商（或指定提供商）的 OpenAI 兼容 /embeddings 接口
 *   2. 本地模式：纯 JS 哈希向量（无需联网、无需 API Key，中文友好）
 *
 * 对外统一返回 { dim, embed(texts) -> Promise<number[][]> }
 */

const LOCAL_DIM = 512;

// ---------------- 本地哈希嵌入 ----------------

function tokenize(text) {
  const t = String(text || '').toLowerCase();
  const tokens = [];
  // 拉丁字母 / 数字词
  const words = t.match(/[a-z0-9_]{1,32}/g);
  if (words) tokens.push(...words);
  // 中日韩：单字 + 二元组（bigram），对中文语义更敏感
  const cjk = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (cjk) {
    for (let i = 0; i < cjk.length; i++) tokens.push(cjk[i]);
    for (let i = 0; i + 1 < cjk.length; i++) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function l2normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * 本地哈希向量：把 token 映射到固定维度，符号哈希降低碰撞偏置，再 L2 归一化。
 * 效果不等同于神经嵌入，但对"找相似句子/回忆"这类用途足够，且完全离线。
 */
function localEmbedOne(text, dim = LOCAL_DIM) {
  const vec = new Array(dim).fill(0);
  const tokens = tokenize(text);
  const freq = new Map();
  for (const tk of tokens) freq.set(tk, (freq.get(tk) || 0) + 1);
  for (const [tk, count] of freq) {
    const h = fnv1a(tk);
    const idx = h % dim;
    const sign = ((h >>> 16) & 1) === 0 ? 1 : -1;
    // sublinear tf：抑制高频词主导
    vec[idx] += sign * (1 + Math.log(count));
  }
  return l2normalize(vec);
}

function createLocalEmbedder(dim = LOCAL_DIM) {
  return {
    name: 'local-hash',
    dim,
    async embed(texts) {
      return texts.map((t) => localEmbedOne(t, dim));
    },
  };
}

// ---------------- API 嵌入（OpenAI 兼容） ----------------

function joinUrl(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  // 已经是 /embeddings 结尾则直接用
  if (/\/embeddings$/.test(base)) return base;
  return base + suffix;
}

function createApiEmbedder({ baseUrl, apiKey, model, dim = 0 }) {
  return {
    name: `api:${model || 'embedding'}`,
    dim,
    async embed(texts) {
      const url = joinUrl(baseUrl, '/embeddings');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const data = json.data || json.embeddings || [];
      const vectors = data
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((d) => (Array.isArray(d) ? d : d.embedding));
      if (!vectors.length || !Array.isArray(vectors[0])) {
        throw new Error('Embedding API 返回格式无法识别');
      }
      this.dim = vectors[0].length;
      return vectors.map((v) => l2normalize(v.slice()));
    },
  };
}

/**
 * 根据配置选择嵌入器。
 * config: { baseUrl, apiKey, embeddingModel }
 * 若未配置 embeddingModel，则使用本地模式。
 */
function createEmbedder(config = {}) {
  if (config.embeddingModel && config.baseUrl) {
    return createApiEmbedder({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.embeddingModel,
    });
  }
  return createLocalEmbedder();
}

module.exports = {
  createEmbedder,
  createLocalEmbedder,
  createApiEmbedder,
  localEmbedOne,
  tokenize,
  LOCAL_DIM,
};
