//! Pop-out "modal" windows. Each app modal (Settings, …) can open as its own
//! frameless OS window that loads the SAME SPA at `index.html#<kind>`. The
//! frontend entry reads the hash and renders just that modal. The window label
//! equals the kind, so a second open() focuses the existing window, and the
//! capability ACL is keyed per kind (the label must be listed in a capability
//! or every invoke from that window is denied).

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Per-kind window spec: (width, height, title). Unknown kinds are rejected.
fn spec(kind: &str) -> Option<(f64, f64, &'static str)> {
    match kind {
        "settings" => Some((480.0, 760.0, "Settings")),
        _ => None,
    }
}

#[tauri::command]
pub fn open_modal_window<R: Runtime>(app: AppHandle<R>, kind: String) -> Result<(), String> {
    let Some((w, h, title)) = spec(&kind) else {
        return Err(format!("unknown modal kind: {kind}"));
    };
    // Already open → focus it instead of stacking a duplicate.
    if let Some(win) = app.get_webview_window(&kind) {
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        kind.as_str(),
        WebviewUrl::App(format!("index.html#{kind}").into()),
    )
    .title(title)
    .inner_size(w, h)
    .min_inner_size(420.0, 520.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_modal_window<R: Runtime>(app: AppHandle<R>, kind: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&kind) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
