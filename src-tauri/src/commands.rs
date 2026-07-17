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
