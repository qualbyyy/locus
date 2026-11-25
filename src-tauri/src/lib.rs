use std::path::PathBuf;
use std::sync::Mutex;

#[derive(serde::Serialize)]
struct LaunchFilePayload {
    name: String,
    path: String,
    bytes: Vec<u8>,
}

struct LaunchFileState(Mutex<Option<PathBuf>>);

fn find_initial_launch_file() -> Option<PathBuf> {
    for arg in std::env::args_os().skip(1) {
        let candidate = PathBuf::from(&arg);
        if candidate.is_file() {
            if let Some(ext) = candidate.extension().and_then(|s| s.to_str()) {
                let lower = ext.to_ascii_lowercase();
                if matches!(
                    lower.as_str(),
                    "locus" | "svg" | "png" | "jpg" | "jpeg" | "webp"
                ) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

#[tauri::command]
fn take_launch_file(state: tauri::State<'_, LaunchFileState>) -> Result<Option<LaunchFilePayload>, String> {
    let path = state
        .0
        .lock()
        .map_err(|_| "launch state lock poisoned".to_string())?
        .take();
    let Some(path) = path else {
        return Ok(None);
    };
    const MAX_LAUNCH_FILE_BYTES: u64 = 64 * 1024 * 1024;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_LAUNCH_FILE_BYTES {
        return Err("Файл слишком большой для автооткрытия при запуске".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    Ok(Some(LaunchFilePayload {
        name,
        path: path.to_string_lossy().into_owned(),
        bytes,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_file = find_initial_launch_file();
    tauri::Builder::default()
        .manage(LaunchFileState(Mutex::new(initial_file)))
        .invoke_handler(tauri::generate_handler![take_launch_file])
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Locus");
}
