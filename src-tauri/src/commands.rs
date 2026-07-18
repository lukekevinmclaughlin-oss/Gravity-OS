//! Tauri IPC surface. Thin wrappers over the active `ShellPlatform`.

use parking_lot::Mutex;
use tauri::{Emitter, State};

#[cfg(windows)]
use tauri::WebviewWindow;

use crate::platform::ShellPlatform;
use crate::settings::SettingsStore;
use crate::shell::{
    AppearanceMode, ShellMode, ShellState, ShellTransitionResult, WindowRule, WindowScene,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub app_id: String,
    pub accepted: bool,
}

pub struct AppState {
    pub platform: Box<dyn ShellPlatform>,
    pub settings: SettingsStore,
    pub shell_mode: Mutex<ShellMode>,
}

impl AppState {
    pub fn new() -> Self {
        let settings = SettingsStore::load();
        let platform = crate::platform::platform();
        let (gap, cycling) = settings.window_preferences();
        platform.configure_windowing(gap, cycling);
        platform.configure_rules(&settings.rules());
        Self {
            platform,
            settings,
            shell_mode: Mutex::new(ShellMode::Gravity),
        }
    }
}

#[tauri::command]
pub fn get_shell_state(state: State<AppState>) -> ShellState {
    let mut snapshot = state.platform.snapshot();
    state.settings.apply_to_state(&mut snapshot);
    snapshot.shell_mode = *state.shell_mode.lock();
    snapshot
}

fn state_changed(app: &tauri::AppHandle) {
    let _ = app.emit("gravity://state-changed", ());
}

#[cfg(windows)]
#[tauri::command]
pub fn fit_orbit_window(window: WebviewWindow, app_count: u32) -> Result<(), String> {
    if !window.label().starts_with("orbit-") {
        return Err("Orbit sizing is only available to Orbit surfaces".into());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    crate::platform::shell_control::fit_orbit_window(hwnd.0 as isize, app_count);
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
pub fn set_shell_surface_expanded(
    window: WebviewWindow,
    expanded: bool,
    requested_height: f64,
) -> Result<(), String> {
    let surface = if window.label().starts_with("horizon-") {
        "horizon"
    } else if window.label().starts_with("orbit-") {
        "orbit"
    } else {
        return Err("Surface expansion is only available to Horizon and Orbit".into());
    };
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    crate::platform::shell_control::set_shell_surface_expanded(
        hwnd.0 as isize,
        surface,
        expanded,
        requested_height,
    )
}

#[tauri::command]
pub fn set_app_pinned(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_id: String,
    pinned: bool,
) -> Result<(), String> {
    let catalog = state.platform.snapshot().apps;
    state.settings.set_app_pinned(&catalog, &app_id, pinned)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn reorder_pinned_apps(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_ids: Vec<String>,
) -> Result<(), String> {
    let catalog = state.platform.snapshot().apps;
    state.settings.reorder_pinned(&catalog, app_ids)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_appearance(app: tauri::AppHandle, state: State<AppState>, mode: AppearanceMode) -> Result<(), String> {
    state.settings.set_appearance(mode)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_wallpaper(app: tauri::AppHandle, state: State<AppState>, wallpaper_id: String) -> Result<(), String> {
    state.settings.set_wallpaper(wallpaper_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_window_preferences(
    app: tauri::AppHandle,
    state: State<AppState>,
    gap: u32,
    cycling: bool,
) -> Result<(), String> {
    state.settings.set_window_preferences(gap, cycling)?;
    state.platform.configure_windowing(gap, cycling);
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn capture_scene(app: tauri::AppHandle, state: State<AppState>, name: String) -> Result<WindowScene, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err("Scene names must contain 1 to 64 characters".into());
    }
    let scene = state.platform.capture_scene(name)?;
    state.settings.add_scene(scene.clone())?;
    state_changed(&app);
    Ok(scene)
}

#[tauri::command]
pub fn restore_scene(app: tauri::AppHandle, state: State<AppState>, scene_id: String) -> Result<(), String> {
    let scene = state
        .settings
        .scene(&scene_id)
        .ok_or_else(|| "That Scene no longer exists".to_string())?;
    state.platform.restore_scene(&scene)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_scene(app: tauri::AppHandle, state: State<AppState>, scene_id: String) -> Result<(), String> {
    state.settings.delete_scene(&scene_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn upsert_window_rule(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_id: String,
    action: String,
    enabled: bool,
) -> Result<(), String> {
    if crate::geometry::Placement::parse(&action).is_none() {
        return Err("Rules only support deterministic placement layouts".into());
    }
    let catalog = state.platform.snapshot().apps;
    let app_info = catalog
        .iter()
        .find(|app| app.id == app_id)
        .ok_or_else(|| "That application is no longer installed".to_string())?;
    state.settings.upsert_rule(WindowRule {
        id: format!("rule-{app_id}"),
        app_id,
        app_name: app_info.name.clone(),
        action,
        enabled,
    })?;
    state.platform.configure_rules(&state.settings.rules());
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_window_rule(app: tauri::AppHandle, state: State<AppState>, rule_id: String) -> Result<(), String> {
    state.settings.delete_rule(&rule_id)?;
    state.platform.configure_rules(&state.settings.rules());
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn focus_window(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.focus_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn minimize_window(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.minimize_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn toggle_maximize_window(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.toggle_maximize_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn close_window(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.close_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn window_action(app: tauri::AppHandle, state: State<AppState>, action: String) -> Result<(), String> {
    state.platform.window_action(&action)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn window_action_for(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
    action: String,
) -> Result<(), String> {
    state.platform.window_action_for(&window_id, &action)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn launch_app(app: tauri::AppHandle, state: State<AppState>, app_id: String) -> Result<LaunchResult, String> {
    state.platform.launch_app(&app_id)?;
    state_changed(&app);
    Ok(LaunchResult {
        app_id,
        accepted: true,
    })
}

#[tauri::command]
pub fn launch_app_with_files(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_id: String,
    paths: Vec<String>,
) -> Result<LaunchResult, String> {
    state.platform.launch_app_with_files(&app_id, &paths)?;
    state_changed(&app);
    Ok(LaunchResult {
        app_id,
        accepted: true,
    })
}

#[tauri::command]
pub fn set_volume(app: tauri::AppHandle, state: State<AppState>, value: f32) -> Result<(), String> {
    state.platform.set_volume(value)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_brightness(app: tauri::AppHandle, state: State<AppState>, value: f32) -> Result<(), String> {
    state.platform.set_brightness(value)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn toggle_setting(app: tauri::AppHandle, state: State<AppState>, key: String) -> Result<(), String> {
    state.platform.toggle_setting(&key)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn dismiss_notification(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.dismiss_notification(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn switch_orbit(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.platform.switch_orbit(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn move_window_to_orbit(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
    orbit_id: String,
) -> Result<(), String> {
    state.platform.move_window_to_orbit(&window_id, &orbit_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn empty_trash(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    state.platform.empty_trash()?;
    state_changed(&app);
    Ok(())
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
pub fn edit_action(kind: String, target_window_id: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Some(window_id) = target_window_id {
            crate::platform::input::edit_chord_for(&window_id, &kind)
        } else {
            crate::platform::input::edit_chord(&kind)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (kind, target_window_id);
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
        crate::platform::appindex::shell_open(&uri)?;
    }
    Ok(())
}

/// The Gravity ⇄ Windows 11 toggle (Horizon menu + dock tile + tray).
#[tauri::command]
pub fn set_shell_active(
    app: tauri::AppHandle,
    active: bool,
) -> Result<ShellTransitionResult, String> {
    #[cfg(windows)]
    {
        crate::set_shell_active_impl(&app, active)
    }
    #[cfg(not(windows))]
    {
        let mode = if active {
            ShellMode::Gravity
        } else {
            ShellMode::Windows
        };
        *app.state::<AppState>().shell_mode.lock() = mode;
        Ok(ShellTransitionResult { mode, active })
    }
}

/// Quit Gravity entirely, restoring the Windows desktop first.
#[tauri::command]
pub fn quit_shell(app: tauri::AppHandle) {
    #[cfg(windows)]
    let _ = crate::set_shell_active_impl(&app, false);
    app.exit(0);
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
