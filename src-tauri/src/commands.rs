//! Tauri IPC surface. Thin wrappers over the active `ShellPlatform`.

use tauri::State;

use crate::platform::ShellPlatform;
use crate::shell::ShellState;

pub struct AppState {
    pub platform: Box<dyn ShellPlatform>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            platform: crate::platform::platform(),
        }
    }
}

#[tauri::command]
pub fn get_shell_state(state: State<AppState>) -> ShellState {
    state.platform.snapshot()
}

#[tauri::command]
pub fn focus_window(state: State<AppState>, id: String) {
    state.platform.focus_window(&id);
}

#[tauri::command]
pub fn minimize_window(state: State<AppState>, id: String) {
    state.platform.minimize_window(&id);
}

#[tauri::command]
pub fn close_window(state: State<AppState>, id: String) {
    state.platform.close_window(&id);
}

#[tauri::command]
pub fn launch_app(state: State<AppState>, app_id: String) {
    state.platform.launch_app(&app_id);
}

#[tauri::command]
pub fn set_volume(state: State<AppState>, value: f32) {
    state.platform.set_volume(value);
}

#[tauri::command]
pub fn set_brightness(state: State<AppState>, value: f32) {
    state.platform.set_brightness(value);
}

#[tauri::command]
pub fn toggle_setting(state: State<AppState>, key: String) {
    state.platform.toggle_setting(&key);
}

#[tauri::command]
pub fn dismiss_notification(state: State<AppState>, id: String) {
    state.platform.dismiss_notification(&id);
}

#[tauri::command]
pub fn switch_orbit(state: State<AppState>, id: String) {
    state.platform.switch_orbit(&id);
}

#[tauri::command]
pub fn empty_trash(state: State<AppState>) {
    state.platform.empty_trash();
}

#[tauri::command]
pub fn engage_shell(state: State<AppState>) {
    state.platform.engage_shell();
}

#[tauri::command]
pub fn disengage_shell(state: State<AppState>) {
    state.platform.disengage_shell();
}

/// Extracted app icon as raw RGBA for the frontend to plate (spec §4).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconPayload {
    pub width: u32,
    pub height: u32,
    /// base64-encoded straight-alpha RGBA, row-major
    pub rgba: String,
}

#[tauri::command]
pub fn get_app_icon(app_id: String) -> Option<AppIconPayload> {
    #[cfg(windows)]
    {
        use base64::Engine;
        crate::platform::appindex::icon_rgba(&app_id).map(|d| AppIconPayload {
            width: d.width,
            height: d.height,
            rgba: base64::engine::general_purpose::STANDARD.encode(d.rgba),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = app_id;
        None
    }
}

/// Real session power verbs from the Gravity menu (spec §3). The UI shows
/// its own confirmation for restart/shutdown before invoking this.
#[tauri::command]
pub fn power_action(kind: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let (exe, args): (&str, &[&str]) = match kind.as_str() {
            "sleep" => ("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"]),
            "restart" => ("shutdown.exe", &["/r", "/t", "0"]),
            "shutdown" => ("shutdown.exe", &["/s", "/t", "0"]),
            "lock" => ("rundll32.exe", &["user32.dll,LockWorkStation"]),
            _ => return Err(format!("unknown power action: {kind}")),
        };
        std::process::Command::new(exe)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        Ok(())
    }
}

/// Synthesize a Ctrl edit chord into the focused foreign window (spec §3).
#[tauri::command]
pub fn edit_action(kind: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::platform::input::edit_chord(&kind)
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        Ok(())
    }
}

/// Open a deep link. Whitelisted to ms-settings: so the webview cannot be
/// used as an arbitrary-launch primitive.
#[tauri::command]
pub fn open_uri(uri: String) -> Result<(), String> {
    if !uri.starts_with("ms-settings:") {
        return Err("scheme not allowed".into());
    }
    #[cfg(windows)]
    {
        crate::platform::appindex::shell_open(&uri);
    }
    Ok(())
}

/// Enable/disable full shell replacement (per-user Winlogon shell).
/// No-op off Windows.
#[tauri::command]
pub fn set_full_replacement(_enable: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use crate::platform::shell_control;
        if _enable {
            let exe = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            shell_control::set_as_shell(&exe).map_err(|e| e.to_string())?;
        } else {
            shell_control::restore_default_shell().map_err(|e| e.to_string())?;
        }
        Ok(_enable)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn is_shell_replaced() -> bool {
    #[cfg(windows)]
    {
        crate::platform::shell_control::is_shell_replaced()
    }
    #[cfg(not(windows))]
    {
        false
    }
}
