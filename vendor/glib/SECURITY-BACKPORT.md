# GLib 0.18.5 security backport

This is the crates.io glib 0.18.5 source with the two-line upstream fix from
https://github.com/gtk-rs/gtk-rs-core/pull/1343 applied to `src/variant_iter.rs`.
The C output pointer is mutable and passed as `&mut p`, preventing undefined
behavior in forward and reverse string-array iteration (RUSTSEC-2024-0429).

The package version remains 0.18.5. This is a locally maintained backport, not
an upstream release. Tauri's GTK3 dependencies cannot accept glib 0.20.
Upstream declined a 0.18 patch release in
https://github.com/gtk-rs/gtk-rs-core/pull/1991#issuecomment-4786302302.

Retain the original MIT license and source. Remove this patch when the desktop
stack supports an upstream fixed GLib release. Version-only security scanners
may still report the advisory; disappearance from a dependency graph alone
does not establish remediation. Validate the optimized iterator regression
test and Linux desktop compilation before changing this patch.
