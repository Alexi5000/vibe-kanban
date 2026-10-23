const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

for (const [file, prefix] of [
  ["npx-cli/src/cli.ts", "Download failed:"],
  ["npx-cli/src/cli.ts", "Desktop app not available:"],
  [
    "packages/remote-web/src/shared/lib/relay/ws.ts",
    "Failed to process relay WebSocket frame:",
  ],
]) {
  test(`${prefix} preserves readable content without injected records or terminal controls`, () => {
    const source = readFileSync(
      path.join(
        process.env.SECURITY_TEST_ROOT || path.join(__dirname, ".."),
        file,
      ),
      "utf8",
    );
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let sink;
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "console.error" &&
        node.arguments[0]?.getText(ast).includes(prefix)
      )
        sink = node;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(sink, "expected actual production log sink");
    const text = sink.getText(ast);
    for (const message of [
      "normal: file not found",
      "remote\r\nFORGED\u001b[2J\u0085record\u2028line\u2029para\u202ereversed",
    ]) {
      const output = [];
      const code = ts.transpileModule(text, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      vm.runInNewContext(code, {
        msg: message,
        message,
        error: message,
        console: { error: (...args) => output.push(args.join(" ")) },
      });
      const logged = output[0]
        .slice(output[0].indexOf(prefix) + prefix.length)
        .trim();
      assert.doesNotMatch(
        logged,
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/,
      );
      assert.equal(JSON.parse(logged), message);
    }
  });
}
