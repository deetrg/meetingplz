use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

use crate::AppState;

/// Bring the (accessory) app to the front so a window can take focus.
#[allow(unused_variables)]
pub fn activate_app(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(|| {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSApplication;
            if let Some(mtm) = MainThreadMarker::new() {
                #[allow(deprecated)]
                NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            }
        });
    }
}

/// macOS: float above full-screen apps and on every Space.
#[cfg(target_os = "macos")]
fn mac_configure(win: &WebviewWindow, focus: bool) {
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        use objc2_app_kit::{NSColor, NSWindow, NSWindowCollectionBehavior};
        if let Ok(ptr) = w.ns_window() {
            let nswin: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
            // NSScreenSaverWindowLevel == 1000
            nswin.setLevel(1000);
            nswin.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
            nswin.setHasShadow(false);
            nswin.setOpaque(false);
            nswin.setHidesOnDeactivate(false);
            nswin.setBackgroundColor(Some(&NSColor::clearColor()));
            if focus {
                nswin.makeKeyAndOrderFront(None);
            } else {
                nswin.orderFrontRegardless();
            }
        }
    });
}

pub fn close_all(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay-") {
            let _ = win.destroy();
        }
    }
    *app.state::<AppState>().overlay.lock().unwrap() = None;
}

#[tauri::command]
pub async fn close_overlays(app: AppHandle) {
    close_all(&app);
}

#[tauri::command]
pub async fn show_overlay(app: AppHandle, event: Value, settings: Value, mode: String) -> Result<(), String> {
    let key = event.get("key").cloned().unwrap_or(Value::Null);
    {
        let st = app.state::<AppState>();
        let cur = st.overlay.lock().unwrap();
        if let Some(c) = cur.as_ref() {
            if c.get("key") == Some(&key) && !key.is_null() {
                return Ok(()); // already showing this one
            }
        }
    }
    close_all(&app);

    let takeover = mode == "takeover";
    let payload = json!({ "event": event, "settings": settings, "mode": if takeover { "takeover" } else { "flyby" }, "key": key });

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| (m.position().x, m.position().y));
    let mut primary_label = String::new();

    *app.state::<AppState>().overlay.lock().unwrap() = Some(payload);

    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-{i}");
        let is_primary = match primary_pos {
            Some(p) => p == (m.position().x, m.position().y),
            None => i == 0,
        };
        if is_primary {
            primary_label = label.clone();
        }
        let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("overlay.html".into()))
            .title("MeetingPlz reminder")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .visible(false)
            .focused(takeover)
            .visible_on_all_workspaces(true);
        #[cfg(target_os = "macos")]
        {
            b = b.accept_first_mouse(true);
        }
        #[cfg(windows)]
        {
            b = b.additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
            );
        }
        let _ = &mut b;
        let win = b.build().map_err(|e| e.to_string())?;
        let _ = win.set_position(PhysicalPosition::new(m.position().x, m.position().y));
        let _ = win.set_size(PhysicalSize::new(m.size().width, m.size().height));
        if !takeover {
            let _ = win.set_ignore_cursor_events(true);
        }
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        #[cfg(target_os = "macos")]
        mac_configure(&win, takeover);
        if takeover && is_primary {
            let _ = win.set_focus();
        }
    }
    if primary_label.is_empty() {
        primary_label = "overlay-0".into();
    }
    *app.state::<AppState>().primary_label.lock().unwrap() = primary_label;
    if takeover {
        activate_app(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn get_overlay_payload(app: AppHandle, window: WebviewWindow) -> Value {
    let state = app.state::<AppState>();
    let mut v = state.overlay.lock().unwrap().clone().unwrap_or(Value::Null);
    let primary = state.primary_label.lock().unwrap().clone();
    if let Some(o) = v.as_object_mut() {
        o.insert("isPrimary".into(), Value::Bool(window.label() == primary));
    }
    v
}

#[tauri::command]
pub async fn overlay_action(app: AppHandle, action: String, key: Option<String>, link: Option<String>) -> Result<(), String> {
    if action == "join" {
        if let Some(l) = link.filter(|l| l.starts_with("http://") || l.starts_with("https://")) {
            let _ = app.opener().open_url(l, None::<&str>);
        }
    }
    close_all(&app);
    let _ = app.emit("reminder-action", json!({ "action": action, "key": key }));
    Ok(())
}

#[tauri::command]
pub fn set_ignore_cursor(window: WebviewWindow, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

/// Cursor position relative to this window in CSS pixels (works while the window ignores the mouse).
#[tauri::command]
pub fn cursor_in_window(app: AppHandle, window: WebviewWindow) -> Option<[f64; 2]> {
    let c = app.cursor_position().ok()?;
    let p = window.outer_position().ok()?;
    let sf = window.scale_factor().ok()?;
    Some([(c.x - p.x as f64) / sf, (c.y - p.y as f64) / sf])
}
