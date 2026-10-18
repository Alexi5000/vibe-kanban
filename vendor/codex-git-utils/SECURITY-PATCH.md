# Codex git-utils security override

Source: openai/codex tag rust-v0.147.0, commit be6e8eac029b183056b7e4402879f15d2c85f61b, codex-rs/git-utils. Apache 2.0 LICENSE and upstream NOTICE are preserved, along with all source and unit tests.

Cargo.toml expands the upstream workspace dependency and lint inheritance and changes gix from 0.81 to 0.83. The root git-source patch selects this crate while preserving all other Codex dependencies at 0.147.0. Patched resolution uses gix 0.83.0, gix-fs 0.21.2, and gix-pack 0.70.0. This addresses GitHub alerts 237–242 without changing the app-server protocol version or bundled CLI.

The crate is a workspace member so its upstream regression tests run in normal backend CI. Its upstream formatter and Clippy configuration are retained. Remove the local override when upstream Codex supports a patched gitoxide release. The bundled Codex CLI is separately versioned and this override does not patch its binary.
