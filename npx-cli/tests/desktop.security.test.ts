import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installAndLaunch } from "../src/desktop.ts";

test(
  "archive paths with shell syntax remain literal filenames",
  { skip: process.platform === "win32" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-security-"));
    const previous = process.cwd();
    try {
      process.chdir(root);
      const source = path.join(root, "source");
      const destination = path.join(root, 'cache $(touch INJECTED) "quoted"');
      fs.mkdirSync(source);
      fs.mkdirSync(destination);
      fs.writeFileSync(
        path.join(source, "Demo.AppImage"),
        "#!/bin/sh\nexit 0\n",
      );
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
        JSON.parse(
          fs.readFileSync(path.join(destination, ".installed"), "utf8"),
        ).appPath,
        path.join(destination, "Demo.AppImage"),
      );
    } finally {
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "NSIS preserves an installation directory containing spaces",
  { skip: process.platform !== "win32" },
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "desktop nsis & security "),
    );
    try {
      const installer = path.join(root, "bundle-setup.exe");
      const script = path.join(root, "fixture.nsi");
      fs.writeFileSync(
        script,
        `OutFile "${installer}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nSetOutPath "$INSTDIR"\nFileOpen $0 "$INSTDIR\\installed.txt" w\nFileWrite $0 "installed"\nFileClose $0\nSectionEnd\n`,
      );
      const compiler = path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "NSIS",
        "makensis.exe",
      );
      execFileSync(compiler, [script]);
      await installAndLaunch(
        { dir: root } as Parameters<typeof installAndLaunch>[0],
        "win32",
      );
      assert.equal(
        fs.readFileSync(path.join(root, "app", "installed.txt"), "utf8"),
        "installed",
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(root, ".installed"), "utf8"))
          .appPath,
        path.join(root, "app"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
