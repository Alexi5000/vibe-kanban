# Updater ZIP dependency repair

Source: published `tauri-plugin-updater` 2.10.0, upstream commit
`50b159f668a5fcf42d6356e2af1dc549632b413d`, `plugins/updater` in
https://github.com/tauri-apps/plugins-workspace.

Permissions, build script and upstream licenses are retained.
TLS certificate/hostname verification bypass options are now rejected during
configuration, updater construction and requests. Vibe does not enable these
options; normal verified HTTPS behavior is preserved.
Two source files are formatted to the repository Rust style.
The normalized Cargo manifest replaces Windows ZIP 4 with ZIP 9.0.5 and
raises the plugin's Rust minimum to 1.88, as required by ZIP 9. The application
already uses Rust 1.91 or newer. No signature verification or installer launch
logic is changed. ZIP remains optional with default features disabled.

Regression tests exercise installer payload extraction, parent traversal,
external symlink targets, privileged permission bits and external-target modes.
The three ZIP advisories are RUSTSEC-2026-0367, RUSTSEC-2026-0368 and
RUSTSEC-2026-0369. This dependency repair does not certify an actual signed
Windows installation or rollback.

Remove this override when the upstream Tauri 2 updater supports patched ZIP
and passes these regressions. The original manifest remains in Cargo.toml.orig.
