use std::io::Read;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::AppState;

const SERVICE: &str = "com.dai.meetingplz.desktop";
const ACCOUNT: &str = "session";

fn token_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("session.token"))
}

pub fn load_token(app: &AppHandle) -> Option<String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        if let Ok(t) = entry.get_password() {
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    let f = token_file(app)?;
    std::fs::read_to_string(f).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn save_token(app: &AppHandle, token: &str) {
    let stored = keyring::Entry::new(SERVICE, ACCOUNT)
        .and_then(|e| e.set_password(token))
        .is_ok();
    // Verify the keychain really returns it; otherwise fall back to a private file.
    let readable = stored
        && keyring::Entry::new(SERVICE, ACCOUNT)
            .and_then(|e| e.get_password())
            .map(|t| t == token)
            .unwrap_or(false);
    if readable {
        if let Some(f) = token_file(app) {
            let _ = std::fs::remove_file(f);
        }
        return;
    }
    if let Some(f) = token_file(app) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&f, token).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

/// Dev/QA seed: write straight to the private file (no keychain prompt on headless machines).
pub fn save_token_file_only(app: &AppHandle, token: &str) {
    if let Some(f) = token_file(app) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&f, token).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

pub fn clear_token(app: &AppHandle) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_credential();
    }
    if let Some(f) = token_file(app) {
        let _ = std::fs::remove_file(f);
    }
}

const CB_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>MeetingPlz</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#111;font:16px -apple-system,"SF Pro Display","Segoe UI",Inter,system-ui,sans-serif}
@media(prefers-color-scheme:dark){body{background:#0e0e0e;color:#f5f5f5}}
main{text-align:center;padding:24px}
h1{font-weight:800;letter-spacing:-.03em;font-size:34px;margin:0 0 8px}
p{color:#6b6b6b;margin:0}
</style>
<main><h1 id="h">One sec.</h1><p id="p">Finishing sign in.</p></main>
<script>
(function(){
  var h=document.getElementById('h'),p=document.getElementById('p');
  var t=new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null,'','/cb');
  if(!t){h.textContent='Sign in did not finish.';p.textContent='Go back to MeetingPlz and try again.';return;}
  fetch('/token',{method:'POST',body:t}).then(function(r){
    if(!r.ok)throw 0;
    h.textContent="You're in.";p.textContent='You can close this tab and go back to MeetingPlz.';
  }).catch(function(){h.textContent='Sign in did not finish.';p.textContent='Go back to MeetingPlz and try again.';});
})();
</script>"#;

fn valid_token(t: &str) -> bool {
    !t.is_empty() && t.len() <= 2048 && t.chars().all(|c| c.is_ascii_alphanumeric() || "-_.~+/=".contains(c))
}

pub fn start_sign_in(app: &AppHandle) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("no port")?;
    let gen = app.state::<AppState>().auth_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let base = std::env::var("MEETINGPLZ_API").unwrap_or_else(|_| crate::API_BASE.to_string());
    let url = format!(
        "{base}/api/auth/google/start?client=desktop&return=http%3A%2F%2F127.0.0.1%3A{port}%2Fcb"
    );

    let app2 = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(300) {
            if app2.state::<AppState>().auth_gen.load(Ordering::SeqCst) != gen {
                return; // a newer sign-in attempt replaced this one
            }
            let mut req = match server.recv_timeout(Duration::from_secs(1)) {
                Ok(Some(r)) => r,
                Ok(None) => continue,
                Err(_) => return,
            };
            let path = req.url().split('?').next().unwrap_or("").to_string();
            let method = req.method().as_str().to_string();
            if method == "GET" && path == "/cb" {
                let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap();
                let nostore = tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap();
                let _ = req.respond(tiny_http::Response::from_string(CB_PAGE).with_header(header).with_header(nostore));
            } else if method == "POST" && path == "/token" {
                let mut body = String::new();
                let _ = req.as_reader().take(4096).read_to_string(&mut body);
                let token = body.trim().to_string();
                if valid_token(&token) {
                    save_token(&app2, &token);
                    let _ = req.respond(tiny_http::Response::from_string("ok"));
                    let _ = app2.emit("auth-changed", ());
                    return;
                }
                let _ = req.respond(tiny_http::Response::from_string("bad token").with_status_code(400));
            } else {
                let _ = req.respond(tiny_http::Response::from_string("not found").with_status_code(404));
            }
        }
    });

    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
