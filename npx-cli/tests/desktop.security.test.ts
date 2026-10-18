import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installAndLaunch } from "../src/desktop.ts";

test("archive paths with shell syntax remain literal filenames", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-security-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    const source = path.join(root, "source");
    const destination = path.join(root, 'cache $(touch INJECTED) "quoted"');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(source, "Demo.AppImage"), "#!/bin/sh\nexit 0\n");
    const archivePath = path.join(
      root,
      'bundle $(touch INJECTED) "quoted".tar.gz',
    );
    execFileSync("tar", ["-czf", archivePath, "-C", source, "Demo.AppImage"]);
    const result = await installAndLaunch(
      { archivePath, dir: destination } as Parameters<
        typeof installAndLaunch
      >[0],
      "linux",
    );
    assert.equal(result, 0);
    assert.equal(fs.existsSync(path.join(root, "INJECTED")), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(destination, ".installed"), "utf8"))
        .appPath,
      path.join(destination, "Demo.AppImage"),
    );
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
