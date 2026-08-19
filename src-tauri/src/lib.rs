use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::Window;

const SERVICE_NAME: &str = "com.quilibrium.quorum";
const ALLOWED_SECRET_KEYS: &[&str] = &["farcaster-account", "farcaster-signer"];
const SENSITIVE_CLIPBOARD_CLEAR_MS: u64 = 60_000;

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureStorageStatus {
    pub available: bool,
    pub backend: String,
}

#[derive(Default)]
pub struct AppState {
    pub pending_clipboard_secret: Arc<Mutex<Option<String>>>,
}

fn is_allowed_key(key: &str) -> bool {
    ALLOWED_SECRET_KEYS.contains(&key)
}

pub mod commands {
    use super::*;

    #[tauri::command]
    pub fn secure_storage_status() -> SecureStorageStatus {
        let probe_entry = keyring::Entry::new(SERVICE_NAME, "__probe__");
        let available = probe_entry.is_ok();
        let backend = if cfg!(target_os = "linux") {
            "secret-service"
        } else if cfg!(target_os = "macos") {
            "keychain"
        } else if cfg!(target_os = "windows") {
            "credential-manager"
        } else {
            "generic"
        };

        SecureStorageStatus {
            available,
            backend: backend.to_string(),
        }
    }

    #[tauri::command]
    pub fn secure_storage_get(key: String) -> Result<Option<String>, String> {
        if !is_allowed_key(&key) {
            return Err("Unsupported secret key".into());
        }
        let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    #[tauri::command]
    pub fn secure_storage_set(key: String, value: String) -> Result<(), String> {
        if !is_allowed_key(&key) {
            return Err("Unsupported secret key".into());
        }
        if value.len() > 32_768 {
            return Err("Invalid secret value (too large)".into());
        }
        let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
        entry.set_password(&value).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[tauri::command]
    pub fn secure_storage_delete(key: String) -> Result<bool, String> {
        if !is_allowed_key(&key) {
            return Err("Unsupported secret key".into());
        }
        let entry = keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }

    #[tauri::command]
    pub async fn clipboard_copy_secret(
        text: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<u64, String> {
        if text.is_empty() || text.len() > 4096 {
            return Err("Invalid clipboard payload".into());
        }

        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(&text).map_err(|e| e.to_string())?;

        {
            let mut guard = state.pending_clipboard_secret.lock().unwrap();
            *guard = Some(text.clone());
        }

        let pending_secret = Arc::clone(&state.pending_clipboard_secret);
        let expected_secret = text;

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(SENSITIVE_CLIPBOARD_CLEAR_MS)).await;
            let should_clear = {
                let mut guard = pending_secret.lock().unwrap();
                if guard.as_deref() == Some(&expected_secret) {
                    *guard = None;
                    true
                } else {
                    false
                }
            };

            if should_clear {
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    if let Ok(current_text) = cb.get_text() {
                        if current_text == expected_secret {
                            let _ = cb.clear();
                        }
                    }
                }
            }
        });

        Ok(SENSITIVE_CLIPBOARD_CLEAR_MS)
    }

    #[tauri::command]
    pub fn window_minimize(window: Window) -> Result<(), String> {
        window.minimize().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn window_maximize(window: Window) -> Result<(), String> {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }

    #[tauri::command]
    pub fn window_close(window: Window) -> Result<(), String> {
        window.close().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn get_platform() -> &'static str {
        match std::env::consts::OS {
            "macos" => "darwin",
            "windows" => "win32",
            _ => "linux",
        }
    }

    #[tauri::command]
    pub fn open_login() -> Result<(), String> {
        let url = "https://app.quorummessenger.com";
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
    }

    fn append_to_debug_log(line: &str) {
        eprintln!("{}", line);
        if let Some(home) = std::env::var_os("HOME") {
            let log_path = std::path::Path::new(&home).join(".local/share/quorum-desktop/quorum-debug.log");
            if let Some(parent) = log_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                use std::io::Write;
                let _ = writeln!(file, "{}", line);
            }
        }
    }

    #[tauri::command]
    pub fn log_message(level: String, message: String) {
        let tag = level.to_uppercase();
        append_to_debug_log(&format!("[{}] {}", tag, message));
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct HttpResponse {
        pub status: u16,
        pub body: String,
        pub ok: bool,
    }

    #[tauri::command]
    pub async fn http_fetch(
        url: String,
        method: Option<String>,
        headers: Option<std::collections::HashMap<String, String>>,
        body: Option<String>,
        body_base64: Option<String>,
    ) -> Result<HttpResponse, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        let method_str = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
        append_to_debug_log(&format!("[HTTP] {} {}", method_str, url));

        let req_method = match method_str.as_str() {
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            "HEAD" => reqwest::Method::HEAD,
            _ => reqwest::Method::GET,
        };

        let mut req = client.request(req_method, &url);
        if let Some(h) = headers {
            for (k, v) in h {
                if let (Ok(hn), Ok(hv)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(&v),
                ) {
                    req = req.header(hn, hv);
                }
            }
        }

        if let Some(b64) = body_base64 {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("Invalid base64 body: {}", e))?;
            append_to_debug_log(&format!("[HTTP] Sending binary body: {} bytes", bytes.len()));
            req = req.body(bytes);
        } else if let Some(b) = body {
            req = req.body(b);
        }

        let resp = req.send().await.map_err(|e| {
            append_to_debug_log(&format!("[HTTP ERROR] {} {} -> {}", method_str, url, e));
            e.to_string()
        })?;
        let status = resp.status().as_u16();
        let ok = resp.status().is_success();
        let body_text = resp.text().await.map_err(|e| e.to_string())?;
        append_to_debug_log(&format!("[HTTP] {} {} -> {}", method_str, url, status));

        Ok(HttpResponse {
            status,
            body: body_text,
            ok,
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::secure_storage_status,
            commands::secure_storage_get,
            commands::secure_storage_set,
            commands::secure_storage_delete,
            commands::clipboard_copy_secret,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::get_platform,
            commands::open_login,
            commands::http_fetch,
            commands::log_message,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
