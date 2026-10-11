import { loadConfig } from './config.mjs';

/**
 * gateway.mjs — 网关调用的稳定性公共库。
 *
 * 机制：
 * - 指数退避重试：仅对网络错误 / 429 / 5xx 生效；400/401/403/404 属请求问题，直接抛出
 * - 每次尝试独立超时（AbortSignal.timeout）
 * - 配置统一走 loadConfig()（skill 目录 .env 优先，其次进程环境变量），不回显密钥
 * - 二进制响应返回 Buffer；JSON 响应返回解析后的对象；解析失败返回原始文本
 */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class GatewayError extends Error {
  constructor(message, { status = null, body = null, endpoint = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 稳定请求网关端点。
 * @param {string} path 以 / 开头的路径（自动拼在 baseURL/v1 后）
 * @param {object} opts { method, body(object|Buffer), headers, timeoutMs, retries, parse: 'json'|'text'|'buffer', quiet }
 * @returns {Promise<{status:number, data:any, headers:Headers}>}
 */
export async function gateway(path, opts = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = 60_000,
    retries = 2,
    parse = 'json',
    quiet = false,
  } = opts;

  const cfg = loadConfig();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const init = {
        method,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (body !== undefined) {
        init.body = body instanceof Buffer ? body : JSON.stringify(body);
        if (!(body instanceof Buffer) && !init.headers['Content-Type']) {
          init.headers['Content-Type'] = 'application/json';
        }
      }
      const response = await fetch(cfg.baseURL + path, init);

      if (RETRYABLE.has(response.status) && attempt < retries) {
        const backoff = 1000 * 2 ** attempt;
        if (!quiet) console.error(`[gateway] HTTP ${response.status}，${backoff}ms 后重试（${attempt + 1}/${retries}）`);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new GatewayError(`HTTP ${response.status} ${response.statusText}`, {
          status: response.status,
          body: text.slice(0, 2000),
          endpoint: path,
        });
      }
      if (parse === 'buffer') {
        return { status: response.status, data: Buffer.from(await response.arrayBuffer()), headers: response.headers };
      }
      const text = await response.text();
      let data = text;
      if (parse === 'json') {
        try {
          data = JSON.parse(text);
        } catch {
          throw new GatewayError('响应不是合法 JSON', { status: response.status, body: text.slice(0, 500), endpoint: path });
        }
      }
      return { status: response.status, data, headers: response.headers };
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      lastError = error;
      if (attempt < retries) {
        const backoff = 1000 * 2 ** attempt;
        if (!quiet) console.error(`[gateway] ${error.name || 'Error'}，${backoff}ms 后重试（${attempt + 1}/${retries}）`);
        await sleep(backoff);
      }
    }
  }
  throw new GatewayError(`网络请求失败（已重试 ${retries} 次）: ${lastError?.message ?? lastError}`, { endpoint: path });
}

/** CLI 统一错误出口：错误信息写 stderr（含网关返回体），退出码 1。 */
export function fail(message, detail = null) {
  console.error(`[错误] ${message}`);
  if (detail) console.error(String(detail).slice(0, 2000));
  process.exit(1);
}

/** 极简 CLI 参数解析：--name value / --flag。 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[name] = true;
      } else {
        args[name] = next;
        i++;
      }
    }
  }
  return args;
}

/** 下载远程文件到本地（带重试）。 */
export async function downloadTo(url, filePath, { timeoutMs = 300_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const { writeFileSync } = await import('node:fs');
      writeFileSync(filePath, buf);
      return { filePath, bytes: buf.length };
    } catch (error) {
      if (attempt >= 2) throw new GatewayError(`下载失败（已重试 2 次）: ${error.message}`);
      await sleep(1500 * 2 ** attempt);
    }
  }
}
