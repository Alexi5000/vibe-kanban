const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const productName of ['Vibe Kanban', 'Vibe$(touch${IFS}injected)', 'Vibe`touch${IFS}injected`', 'Vibe"quoted']) {
  test(`MSI builder passes ${JSON.stringify(productName)} literally`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msi boundary '));
    try {
      for (const dir of ['scripts', 'bin', 'crates/tauri-app/icons', 'target/x86_64-pc-windows-msvc/release']) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
      }
      fs.copyFileSync(path.join(__dirname, 'build-tauri-msi.js'), path.join(root, 'scripts/build-tauri-msi.js'));
      fs.writeFileSync(path.join(root, 'crates/tauri-app/tauri.conf.json'), JSON.stringify({ productName, version: '1.2.3' }));
      fs.writeFileSync(path.join(root, 'crates/tauri-app/msi-template.wxs'), '{{product_name}} {{version}}');
      fs.writeFileSync(path.join(root, 'crates/tauri-app/icons/icon.ico'), 'fixture');
      fs.writeFileSync(path.join(root, 'target/x86_64-pc-windows-msvc/release/vibe-kanban-tauri.exe'), 'fixture');
      fs.writeFileSync(path.join(root, 'bin/wixl'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.writeFileSync('arguments.json', JSON.stringify(args));\nfs.writeFileSync(args[args.indexOf('-o') + 1], 'fixture MSI');\n`, { mode: 0o755 });
      const result = spawnSync(process.execPath, ['scripts/build-tauri-msi.js', '--target', 'x86_64-pc-windows-msvc'], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(path.join(root, 'injected')), false);
      const args = JSON.parse(fs.readFileSync(path.join(root, 'arguments.json'), 'utf8'));
      const bundle = path.join(root, 'target/x86_64-pc-windows-msvc/release/bundle/msi');
      assert.deepEqual(args, ['-v', '--arch', 'x64', '--ext', 'ui', path.join(bundle, 'processed.wxs'), '-o', path.join(bundle, `${productName.replace(/\s+/g, '-')}-1.2.3-x86_64.msi`)]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
