const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const bundle = buildSync({
  entryPoints: [path.join(__dirname, '../packages/web-core/src/integrations/vscode/bridge.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;

function bridge() {
  const handlers = new Map();
  const sent = [];
  const input = {
    tagName: 'TEXTAREA', value: '', selectionStart: 0, selectionEnd: 0,
    focus() {}, dispatchEvent() {},
    setRangeText(text) { this.value += text; },
  };
  const parent = { postMessage: message => sent.push(message) };
  const window = { parent, addEventListener: (name, fn) => handlers.set(name, fn) };
  const module = { exports: {} };
  vm.runInNewContext(bundle, {
    module, window, Event,
    document: { activeElement: input, querySelector: () => input },
  });
  return {
    sent, input,
    read: module.exports.parentClipboardRead,
    receive(data, source = parent) { handlers.get('message')({ data, source }); },
  };
}

test('clipboard responses require parent sender and matching pending request', async () => {
  const page = bridge();
  let resolved = false;
  const result = page.read().then(text => { resolved = true; return text; });
  const { requestId } = page.sent[0];
  const response = { type: 'vscode-iframe-clipboard-paste-result', requestId, text: 'allowed' };
  page.receive(response, {});
  page.receive({ ...response, requestId: 'unknown' });
  page.receive({ ...response, text: {} });
  await Promise.resolve();
  assert.equal(resolved, false);
  page.receive(response);
  assert.equal(await result, 'allowed');
  page.receive({ ...response, text: 'duplicate' });
});

test('prototype property names are never callable request handlers', () => {
  const page = bridge();
  for (const requestId of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.doesNotThrow(() => page.receive({
      type: 'vscode-iframe-clipboard-paste-result', requestId, text: 'ignored',
    }));
  }
});

test('only parent messages can insert text into the editor', () => {
  const page = bridge();
  page.receive({ type: 'VIBE_ADD_TO_INPUT', text: 'untrusted' }, {});
  page.receive({ type: 'VIBE_ADD_TO_INPUT', text: {} });
  assert.equal(page.input.value, '');
  page.receive({ type: 'VIBE_ADD_TO_INPUT', text: 'trusted' });
  assert.equal(page.input.value, 'trusted');
});
