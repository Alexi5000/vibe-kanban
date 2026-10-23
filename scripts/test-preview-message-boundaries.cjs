const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const root = process.env.SECURITY_TEST_ROOT || path.join(__dirname, "..");

function child(script, embedded = true) {
  const listeners = new Map();
  const sent = [];
  const parent = { postMessage: (...args) => sent.push(args) };
  const element = () => ({
    style: {},
    appendChild(node) {
      node.parentNode = this;
    },
    removeChild() {},
  });
  const body = element();
  const document = {
    referrer: "https://preview.example/previous-page",
    readyState: "complete",
    body,
    createElement: element,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const eruda = {
    _isShow: false,
    init() {},
    show() {
      this._isShow = true;
    },
    hide() {
      this._isShow = false;
    },
  };
  const window = {
    parent,
    eruda,
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  if (!embedded) window.parent = window;
  vm.runInNewContext(
    readFileSync(path.join(root, "crates/preview-proxy/src", script), "utf8"),
    {
      window,
      document,
      console: { debug() {} },
    },
  );
  return {
    body,
    eruda,
    sent,
    receive(data, origin = "https://board.example", source = window.parent) {
      listeners.get("message")({ data, origin, source });
    },
  };
}

for (const [script, command, check] of [
  [
    "eruda_init.js",
    { source: "vibe-kanban", command: "show-eruda" },
    (page) => page.eruda._isShow,
  ],
  [
    "click_to_component_script.js",
    {
      source: "click-to-component",
      type: "toggle-inspect",
      payload: { active: true },
    },
    (page) => page.body.style.cursor === "crosshair",
  ],
]) {
  test(`${script} binds commands to the real parent and its origin`, () => {
    const page = child(script);
    for (const source of [{}, null])
      page.receive(command, "https://board.example", source);
    page.receive(command, "null");
    page.receive(command, "");
    assert.equal(check(page), false);
    page.receive({ source: command.source }, "https://board.example");
    page.receive(command, "https://attacker.example");
    assert.equal(check(page), false);
    page.receive(command);
    assert.equal(check(page), true);
  });
  test(`${script} rejects standalone commands`, () => {
    const page = child(script, false);
    page.receive(command);
    assert.equal(check(page), false);
  });
}

test("parent bridge accepts only the selected iframe and current configured origin", () => {
  const source = readFileSync(
    path.join(root, "packages/web-core/src/shared/lib/previewBridge.ts"),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const listeners = new Map();
  const exports = {};
  const sent = [];
  const window = {
    location: { href: "https://board.example/tasks" },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  vm.runInNewContext(code, { exports, window, URL });
  const frame = {
    src: "http://localhost:3000/preview",
    contentWindow: { postMessage: (...args) => sent.push(args) },
  };
  const ref = { current: frame };
  let ready = 0;
  let opened = 0;
  const bridge = new exports.ClickToComponentListener(
    { onReady: () => ready++, onOpenInEditor: () => opened++ },
    ref,
  );
  bridge.start();
  const data = { source: "click-to-component", type: "ready" };
  const receive = (origin, source = frame.contentWindow, message = data) =>
    listeners.get("message")({ origin, source, data: message });
  receive("http://localhost:3000", {});
  receive("https://attacker.example");
  receive("null");
  assert.equal(ready, 0);
  receive("http://localhost:3000");
  assert.equal(ready, 1);
  assert.equal(sent[0][1], "http://localhost:3000");
  receive("http://localhost:3000", frame.contentWindow, {
    ...data,
    type: "open-in-editor",
    payload: {},
  });
  assert.equal(opened, 1);
  frame.src = "https://next-preview.example/app";
  receive("http://localhost:3000");
  assert.equal(ready, 1);
  receive("https://next-preview.example");
  assert.equal(ready, 2);
  bridge.sendToIframe(frame, { type: "command" });
  assert.equal(sent.at(-1)[1], "https://next-preview.example");
  const oldWindow = frame.contentWindow;
  ref.current = { src: frame.src, contentWindow: {} };
  receive("https://next-preview.example", oldWindow);
  assert.equal(ready, 2);
  bridge.stop();
  assert.equal(listeners.size, 0);
});
