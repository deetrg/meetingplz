#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod overlay;

use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};

pub const API_BASE: &str = "https://meetingplz.pages.dev";

#[derive(Default)]
pub struct AppState {
    pub overlay: Mutex<Option<Value>>,
    pub primary_label: Mutex<String>,
    pub next_item: Mutex<Option<MenuItem<Wry>>>,
    pub shared_state: Mutex<String>,
    pub auth_gen: AtomicU64,
}

fn api_base() -> String {
    std::env::var("MEETINGPLZ_API").unwrap_or_else(|_| API_BASE.to_string())
}

fn demo_mode() -> bool {
    std::env::var("MEETINGPLZ_DEMO").map(|v| v == "1" || v == "true").unwrap_or(false)
}

#[tauri::command]
fn get_config() -> Value {
    json!({
        "api": api_base(),
        "demo": demo_mode(),
        "platform": std::env::consts::OS,
        "forceMotion": std::env::var("MEETINGPLZ_FORCE_MOTION").map(|v| v == "1").unwrap_or(false),
        "freezeMs": std::env::var("MEETINGPLZ_FREEZE_MS").ok().and_then(|v| v.parse::<f64>().ok()),
    })
}

#[tauri::command]
fn log_line(app: AppHandle, line: String) {
    if std::env::var("MEETINGPLZ_DEBUG").is_err() && !demo_mode() {
        return;
    }
    eprintln!("[meetingplz] {line}");
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("debug.log")) {
            let _ = writeln!(f, "{line}");
        }
    }
}

#[tauri::command]
fn get_token(app: AppHandle) -> Option<String> {
    auth::load_token(&app)
}

#[tauri::command]
fn sign_in(app: AppHandle) -> Result<(), String> {
    auth::start_sign_in(&app)
}

#[tauri::command]
fn link_listen(app: AppHandle) -> Result<u16, String> {
    auth::spawn_listener(&app)
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    auth::open_google_url(&app, &url)
}

#[tauri::command]
fn sign_out(app: AppHandle) {
    auth::clear_token(&app);
    let _ = app.emit("auth-changed", ());
}

#[tauri::command]
fn set_next(app: AppHandle, text: String) {
    let state = app.state::<AppState>();
    if let Some(item) = state.next_item.lock().unwrap().as_ref() {
        let _ = item.set_text(&text);
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("MeetingPlz\n{text}")));
    }
}

#[tauri::command]
fn publish_state(app: AppHandle, state: String) {
    *app.state::<AppState>().shared_state.lock().unwrap() = state.clone();
    let _ = app.emit("state-changed", state);
}

#[tauri::command]
fn get_state(app: AppHandle) -> String {
    app.state::<AppState>().shared_state.lock().unwrap().clone()
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    let al = app.autolaunch();
    let _ = if enabled { al.enable() } else { al.disable() };
    al.is_enabled().unwrap_or(false)
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app).map_err(|e| e.to_string())
}

pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        overlay::activate_app(app);
        return Ok(());
    }
    let app2 = app.clone();
    let w = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("MeetingPlz")
        .inner_size(400.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .build()?;
    let _ = w.show();
    let _ = w.set_focus();
    overlay::activate_app(&app2);
    Ok(())
}

fn tray_images() -> (Image<'static>, Image<'static>) {
    let template = Image::from_bytes(include_bytes!("../icons/tray-template.png")).expect("tray template");
    let color = Image::from_bytes(include_bytes!("../icons/tray-color.png")).expect("tray color");
    (template, color)
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let next = MenuItemBuilder::with_id("next", "Next: sign in to start").enabled(false).build(app)?;
    let test = MenuItemBuilder::with_id("test", "Test it").build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open MeetingPlz").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&next)
        .separator()
        .item(&test)
        .item(&open)
        .separator()
        .item(&quit)
        .build()?;
    *app.state::<AppState>().next_item.lock().unwrap() = Some(next);

    let (template, color) = tray_images();
    let is_mac = cfg!(target_os = "macos");
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("MeetingPlz")
        .show_menu_on_left_click(is_mac)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "test" => {
                let _ = app.emit("test-it", ());
            }
            "open" => {
                let _ = open_settings_window(app);
            }
            "quit" => {
                overlay::close_all(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if !cfg!(target_os = "macos") {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    let _ = open_settings_window(tray.app_handle());
                }
            }
        });
    if is_mac {
        builder = builder.icon(template).icon_as_template(true);
    } else {
        builder = builder.icon(color);
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn disable_app_nap() {
    use objc2_foundation::{ns_string, NSActivityOptions, NSProcessInfo};
    let info = NSProcessInfo::processInfo();
    let token = info.beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        ns_string!("MeetingPlz watches your calendar"),
    );
    std::mem::forget(token);
}

fn ensure_autostart_default(app: &AppHandle) {
    let flag = match app.path().app_data_dir() {
        Ok(d) => d.join("autostart-initialised"),
        Err(_) => return,
    };
    if flag.exists() {
        return;
    }
    let _ = app.autolaunch().enable();
    if let Some(parent) = flag.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(flag, b"1");
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = open_settings_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_token,
            log_line,
            sign_in,
            link_listen,
            open_url,
            sign_out,
            set_next,
            publish_state,
            get_state,
            get_autostart,
            set_autostart,
            open_settings,
            overlay::show_overlay,
            overlay::get_overlay_payload,
            overlay::overlay_action,
            overlay::set_ignore_cursor,
            overlay::cursor_in_window,
            overlay::close_overlays,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                disable_app_nap();
            }
            let handle = app.handle().clone();
            // Dev/QA only: seed the stored session from the environment (ignored when empty).
            if let Ok(t) = std::env::var("MEETINGPLZ_TOKEN") {
                let t = t.trim();
                if !t.is_empty() {
                    auth::save_token_file_only(&handle, t);
                }
            }
            setup_tray(&handle)?;
            if std::env::var("MEETINGPLZ_OPEN_SETTINGS").map(|v| v == "1").unwrap_or(false) {
                let _ = open_settings_window(&handle);
            }
            if !demo_mode() {
                ensure_autostart_default(&handle);
            }
            // Heartbeat from native side so the hidden webview never sleeps through a reminder.
            let hb = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(15));
                let _ = hb.emit("tick", ());
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MeetingPlz");

    app.run(|_app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
