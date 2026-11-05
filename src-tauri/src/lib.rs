mod store;

use store::{KeySource, Store};
use tauri::{Manager, State};

/// Offline sign-in works for cashiers who signed in online on this till within this many days.
const OFFLINE_LOGIN_MAX_AGE_DAYS: i64 = 7;

#[tauri::command]
fn kv_get(store: State<Store>, key: String) -> Result<Option<String>, String> {
    store.kv_get(&key)
}

#[tauri::command]
fn kv_set(store: State<Store>, key: String, value: String) -> Result<(), String> {
    store.kv_set(&key, &value)
}

#[tauri::command]
fn kv_delete(store: State<Store>, key: String) -> Result<(), String> {
    store.kv_delete(&key)
}

#[tauri::command]
fn reset_till(store: State<Store>) -> Result<(), String> {
    store.reset()
}

#[tauri::command]
fn remember_cashier(store: State<Store>, email: String, password: String, session_json: String) -> Result<(), String> {
    store.remember_cashier(&email, &password, &session_json)
}

#[tauri::command]
fn offline_login(store: State<Store>, email: String, password: String) -> Result<Option<String>, String> {
    store.offline_login(&email, &password, OFFLINE_LOGIN_MAX_AGE_DAYS)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // One till window per computer: launching the shortcut again focuses the open window instead of
        // starting a second copy that would hold its own, diverging sale queue.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir, KeySource::OsKeyring)?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![kv_get, kv_set, kv_delete, reset_till, remember_cashier, offline_login])
        .run(tauri::generate_context!())
        .expect("error while running the Riskyc POS app");
}
