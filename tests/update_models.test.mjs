import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GATEWAY = { COZE_MODELS_BASE_URL: 'https://gateway.example', COZE_MODELS_API_KEY: 'mock-gateway-key' };
const SDK = { COZE_API_TOKEN: 'mock-sdk-token' };

function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'coze-sync-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = path.join(root, 'skill');
  const references = path.join(skill, 'references');
  mkdirSync(references, { recursive: true });
  mkdirSync(path.join(skill, 'scripts'));
  for (const name of ['update_models.mjs', 'config.mjs']) {
    copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(skill, 'scripts', name));
  }

  // Put the SDK in the caller's project, not alongside the skill.
  const project = path.join(root, 'project');
  const sdk = path.join(project, 'node_modules', 'coze-coding-dev-sdk');
  mkdirSync(sdk, { recursive: true });
  writeFileSync(path.join(sdk, 'index.js'), `
    exports.listModels = async () => {
      if (process.env.COZE_API_TOKEN !== 'mock-sdk-token') throw Error('unexpected SDK call');
      if (process.env.TEST_SDK_FAIL) throw Object.assign(Error(process.env.COZE_API_TOKEN), { statusCode: 503 });
      return [{ model_id: 'mock-text', input_types: ['text'] }, { model_id: 'mock-vision', input_types: ['image'] }];
    };
  `);
  const preload = path.join(root, 'offline.mjs');
  writeFileSync(preload, `
    globalThis.fetch = async (url, { headers }) => {
      if (url !== 'https://gateway.example/v1/models' || headers.Authorization !== 'Bearer mock-gateway-key') {
        throw Error('unexpected HTTP request');
      }
      if (process.env.TEST_GATEWAY_FAIL) return new Response('mock-gateway-key', { status: 502 });
      return Response.json({ data: [{ id: 'mock-gateway-model' }] });
    };
  `);

  return {
    references,
    read: (name) => JSON.parse(readFileSync(path.join(references, name), 'utf8')),
    run(env, args = [], expectedExit = 0) {
      const run = spawnSync(process.execPath, [
        '--import', pathToFileURL(preload).href, path.join(skill, 'scripts', 'update_models.mjs'), ...args,
      ], {
        cwd: project,
        env: { SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root, ...env },
        timeout: 8_000,
        encoding: 'utf8',
      });
      assert.ifError(run.error);
      assert.equal(run.status, expectedExit, run.stderr);
      assert.doesNotMatch(run.stdout + run.stderr, /mock-gateway-key|mock-sdk-token/);
      return run;
    },
  };
}

function assertSuccess(catalog, key, count) {
  const sync = catalog[key];
  assert.ok(Number.isFinite(Date.parse(sync.attemptedAt)));
  assert.ok(Date.parse(sync.lastSuccessAt) >= Date.parse(sync.attemptedAt));
  assert.deepEqual(sync, {
    success: true, skipped: false, skipReason: null, error: null, upstreamCount: count,
    attemptedAt: sync.attemptedAt, lastSuccessAt: catalog.generatedAt,
  });
}

function assertSkipped(sync, reason) {
  assert.deepEqual(sync, {
    success: false, skipped: true, skipReason: sync.skipReason, error: null,
    upstreamCount: 0, attemptedAt: sync.attemptedAt, lastSuccessAt: null,
  });
  assert.match(sync.skipReason, reason);
  assert.ok(Number.isFinite(Date.parse(sync.attemptedAt)));
}

test('default all refreshes both catalogs with independent success timestamps', (t) => {
  const f = setup(t);
  f.run({ ...GATEWAY, ...SDK });
  const gateway = f.read('gateway-models.json');
  const sdk = f.read('models.json');
  assertSuccess(gateway, 'gatewaySync', 1);
  assertSuccess(sdk, 'sdkSync', 2);
  assert.deepEqual(gateway.models, [{ id: 'mock-gateway-model' }]);
  assert.equal(gateway.baseURL, 'https://gateway.example/v1');
  assert.ok(sdk.models.llm.some((model) => model.id === 'mock-text' && model.source === 'upstream'));
  assert.equal(sdk.models.vision[0].id, 'mock-vision');
  assert.ok(sdk.models.video.some((model) => model.default && model.source === 'static'));
});

test('gateway only: SDK is explicitly skipped and does not replace the gateway update', (t) => {
  const f = setup(t);
  const run = f.run(GATEWAY);
  assertSuccess(f.read('gateway-models.json'), 'gatewaySync', 1);
  assertSkipped(f.read('models.json').sdkSync, /COZE_API_TOKEN/);
  assert.match(run.stdout, /models\.json 跳过/);
});

test('SDK only: gateway is explicitly skipped', (t) => {
  const f = setup(t);
  f.run(SDK);
  assertSuccess(f.read('models.json'), 'sdkSync', 2);
  const gateway = f.read('gateway-models.json');
  assertSkipped(gateway.gatewaySync, /COZE_MODELS_API_KEY/);
  assert.deepEqual(gateway.models, []);
});

for (const [side, env, name, okName, message, okKey, count] of [
  ['sdk', { TEST_SDK_FAIL: '1' }, 'models.json', 'gateway-models.json', /HTTP 503/, 'gatewaySync', 1],
  ['gateway', { TEST_GATEWAY_FAIL: '1' }, 'gateway-models.json', 'models.json', /HTTP 502/, 'sdkSync', 2],
]) {
  test(`${side} failure does not block its peer; repeated failures preserve cached models and last success`, (t) => {
    const f = setup(t);
    const auth = { ...GATEWAY, ...SDK };
    const key = `${side}Sync`;
    f.run(auth);
    const previous = f.read(name);
    for (let i = 0; i < 2; i++) {
      const run = f.run({ ...auth, ...env });
      const catalog = f.read(name);
      assertSuccess(f.read(okName), okKey, count);
      assert.deepEqual(catalog.models, previous.models);
      assert.deepEqual(catalog[key], {
        success: false, skipped: false, skipReason: null, error: catalog[key].error, upstreamCount: 0,
        attemptedAt: catalog[key].attemptedAt, lastSuccessAt: previous[key].lastSuccessAt,
      });
      assert.match(catalog[key].error, message);
      assert.match(run.stderr, message);
      assert.doesNotMatch(JSON.stringify(catalog), /mock-gateway-key|mock-sdk-token/);
    }
  });
}

test('targets and fallback-only leave the unselected catalog untouched', (t) => {
  const f = setup(t);
  const auth = { ...GATEWAY, ...SDK };
  f.run(auth, ['--target', 'gateway']);
  assert.throws(() => f.read('models.json'), { code: 'ENOENT' });
  const gateway = f.read('gateway-models.json');
  f.run({ ...auth, TEST_GATEWAY_FAIL: '1' }, ['--target=sdk']);
  const sdk = f.read('models.json');
  assertSuccess(sdk, 'sdkSync', 2);
  f.run({ ...auth, TEST_SDK_FAIL: '1', TEST_GATEWAY_FAIL: '1' }, ['--fallback-only']);
  const fallback = f.read('models.json');
  assert.equal(fallback.sdkSync.skipped, true);
  assert.match(fallback.sdkSync.skipReason, /--fallback-only/);
  assert.equal(fallback.sdkSync.lastSuccessAt, sdk.sdkSync.lastSuccessAt);
  assert.deepEqual(fallback.models, sdk.models);
  assert.deepEqual(f.read('gateway-models.json'), gateway);
  f.run(auth, ['--target', 'bad'], 1);
});

test('partial gateway credentials are a configuration failure but SDK still refreshes', (t) => {
  const f = setup(t);
  f.run({ ...SDK, COZE_MODELS_BASE_URL: GATEWAY.COZE_MODELS_BASE_URL });
  const gateway = f.read('gateway-models.json').gatewaySync;
  assert.equal(gateway.skipped, false);
  assert.match(gateway.error, /Both COZE_MODELS_BASE_URL and COZE_MODELS_API_KEY/);
  assertSuccess(f.read('models.json'), 'sdkSync', 2);
});

test('a catalog filesystem error exits non-zero without blocking the peer', (t) => {
  const f = setup(t);
  mkdirSync(path.join(f.references, 'gateway-models.json'));
  f.run({ ...GATEWAY, ...SDK }, [], 1);
  assertSuccess(f.read('models.json'), 'sdkSync', 2);
});
