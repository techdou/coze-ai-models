import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const ENV_PATH = new URL('../.env', import.meta.url);

// Resolve each field independently. Empty values fall through to the environment.
export function loadConfig({ envPath = ENV_PATH, env = process.env } = {}) {
  let local = {};
  try {
    local = parseEnv(readFileSync(envPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read skill .env configuration.');
  }
  const value = (name) => local[name]?.trim() || env[name]?.trim() || '';
  const baseURL = value('COZE_MODELS_BASE_URL');
  const apiKey = value('COZE_MODELS_API_KEY');
  if (!baseURL && !apiKey) return null;
  if (!baseURL || !apiKey) {
    throw new Error('Both COZE_MODELS_BASE_URL and COZE_MODELS_API_KEY are required.');
  }
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error('COZE_MODELS_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('COZE_MODELS_BASE_URL must be an HTTP(S) URL without credentials, query or fragment.');
  }
  if (/[\r\n]/.test(apiKey)) throw new Error('COZE_MODELS_API_KEY must be a single line.');
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`;
  return { baseURL: url.href.replace(/\/$/, ''), apiKey };
}

export async function listGatewayModels(config, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${config.baseURL}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Gateway model request failed (network, redirect or timeout).');
  }
  // Do not echo upstream bodies: they may contain credentials or request headers.
  if (!response.ok) throw new Error(`Gateway model request failed (HTTP ${response.status}).`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Gateway model response is not JSON.');
  }
  if (!Array.isArray(payload?.data) || payload.data.some((model) => typeof model?.id !== 'string' || !model.id.trim())) {
    throw new Error('Gateway model response must contain data entries with model IDs.');
  }
  return payload.data.map(({ id }) => ({ id }));
}
