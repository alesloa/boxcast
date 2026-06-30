fn main() {
    let mut attributes = tauri_build::Attributes::new();
    // The in-crate "downloader" plugin (private build) needs an ACL manifest so its
    // capability resolves. Gate on the PRESENCE of the git-excluded permission dir,
    // not on the feature flag: a plain `cargo build` (no feature) on a dev machine
    // that still has the private files then validates capabilities/downloader.json
    // instead of erroring, while the public repo (which has no permissions/downloader/)
    // skips this entirely and stays clean. Per-command names live only in that
    // excluded TOML — never in this tracked file.
    if std::path::Path::new("permissions/downloader").exists() {
        attributes = attributes.plugin("downloader", tauri_build::InlinedPlugin::new());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
