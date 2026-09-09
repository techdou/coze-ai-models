import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, listGatewayModels } from '../scripts/config.mjs';

function fixture(t, text) {
  const dir = mkdtempSync(path.join(tmpdir(), 'coze-config-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envPath = path.join(dir, '.env');
  if (text !== undefined) writeFileSync(envPath, text);
  return envPath;
}

test('.env overrides environment per field without mutating it', (t) => {
  const envPath = fixture(t, 'COZE_MODELS_BASE_URL="https://file.example/"\nCOZE_MODELS_API_KEY="file#key" # comment\n');
  const env = { COZE_MODELS_BASE_URL: 'https://env.example', COZE_MODELS_API_KEY: 'env-key' };
  assert.deepEqual(loadConfig({ envPath, env }), { baseURL: 'https://file.example/v1', apiKey: 'file#key' });
  assert.equal(env.COZE_MODELS_API_KEY, 'env-key');
});

test('missing file falls back to environment and preserves /v1', (t) => {
  const envPath = fixture(t);
  assert.deepEqual(loadConfig({ envPath, env: {
    COZE_MODELS_BASE_URL: 'https://env.example/prefix/v1/', COZE_MODELS_API_KEY: 'env-key',
  } }), { baseURL: 'https://env.example/prefix/v1', apiKey: 'env-key' });
  assert.equal(loadConfig({ envPath, env: {} }), null);
});

test('blank or missing fields fall back independently', (t) => {
  const envPath = fixture(t, 'COZE_MODELS_BASE_URL=https://file.example\nCOZE_MODELS_API_KEY=\n');
  assert.deepEqual(loadConfig({ envPath, env: { COZE_MODELS_API_KEY: 'env-key' } }), {
    baseURL: 'https://file.example/v1', apiKey: 'env-key',
  });
  assert.throws(() => loadConfig({ envPath, env: {} }), /Both COZE_MODELS/);
});

test('invalid URLs fail without exposing credentials', (t) => {
  const envPath = fixture(t);
  for (const baseURL of ['invalid', 'ftp://host', 'https://user:secret@host', 'https://host/?key=secret']) {
    assert.throws(() => loadConfig({ envPath, env: {
      COZE_MODELS_BASE_URL: baseURL, COZE_MODELS_API_KEY: 'secret',
    } }), (error) => !error.message.includes('secret') && error.message.includes('COZE_MODELS_BASE_URL'));
  }
});

test('model requests use configured URL and auth; store only model IDs', async () => {
  const config = { baseURL: 'https://gateway.example/v1', apiKey: 'test-secret' };
  const models = await listGatewayModels(config, async (url, options) => {
    assert.equal(url, 'https://gateway.example/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    return Response.json({ data: [{ id: 'model-a', private_metadata: 'omit-me' }] });
  });
  assert.deepEqual(models, [{ id: 'model-a' }]);
});

test('network, HTTP and malformed response errors are sanitized', async () => {
  const config = { baseURL: 'https://gateway.example/v1', apiKey: 'test-secret' };
  await assert.rejects(listGatewayModels(config, async () => { throw Error('test-secret'); }), /network, redirect or timeout/);
  await assert.rejects(listGatewayModels(config, async () => new Response('test-secret', { status: 401 })), /^Error: Gateway model request failed \(HTTP 401\)\.$/);
  await assert.rejects(listGatewayModels(config, async () => new Response('test-secret')), /not JSON/);
  await assert.rejects(listGatewayModels(config, async () => Response.json({ data: [{}] })), /model IDs/);
});
