const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, 'devtools_script.js'), 'utf8');

function preview(embedded = true) {
  const listeners = new Map();
  const storage = new Map();
  const calls = [];
  const location = {
    href: 'https://preview.example/start',
    search: '',
    reload: () => calls.push('refresh'),
  };
  const window = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    setInterval() {},
    postMessage() {},
  };
  window.parent = embedded ? { postMessage() {} } : window;
  vm.runInNewContext(script, {
    window, location, URL, URLSearchParams,
    document: { title: 'Preview', readyState: 'complete' },
    history: {
      pushState() {}, replaceState() {},
      back: () => calls.push('back'),
      forward: () => calls.push('forward'),
    },
    sessionStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  });
  return {
    location, calls, storage,
    navigate(payload, source = window.parent) {
      listeners.get('message')({
        source, data: { source: 'vibe-devtools', type: 'navigate', payload },
      });
    },
  };
}

test('only the embedding parent can navigate or reload', () => {
  const page = preview();
  const before = [...page.storage];
  for (const source of [{}, null]) {
    page.navigate({ action: 'goto', url: 'https://attacker.example/' }, source);
    page.navigate({ action: 'refresh' }, source);
  }
  assert.equal(page.location.href, 'https://preview.example/start');
  assert.deepEqual(page.calls, []);
  assert.deepEqual([...page.storage], before);
  const standalone = preview(false);
  standalone.navigate({ action: 'refresh' });
  assert.deepEqual(standalone.calls, []);
});

test('reject executable and non-web URL schemes without changing navigation state', () => {
  for (const url of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '\tjava\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd',
    'vbscript:msgbox(1)', 'blob:https://preview.example/id', 'https://[', {}, 1,
  ]) {
    const page = preview();
    const before = [...page.storage];
    page.navigate({ action: 'goto', url });
    assert.equal(page.location.href, 'https://preview.example/start');
    assert.deepEqual([...page.storage], before);
  }
});

test('retain parent HTTP, HTTPS, relative navigation and history controls', () => {
  for (const [url, expected] of [
    ['http://localhost:3000/app', 'http://localhost:3000/app'],
    ['https://other.example/path?q=1#section', 'https://other.example/path?q=1#section'],
    ['/next', 'https://preview.example/next'],
    ['#section', 'https://preview.example/start#section'],
  ]) {
    const page = preview();
    page.navigate({ action: 'goto', url });
    assert.equal(page.location.href, expected);
    page.navigate({ action: 'back' });
    page.navigate({ action: 'refresh' });
    assert.deepEqual(page.calls, ['back', 'refresh']);
  }
});
