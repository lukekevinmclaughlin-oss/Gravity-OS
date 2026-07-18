//! Tauri IPC surface. Thin wrappers over the active `ShellPlatform`.

use parking_lot::Mutex;
use std::collections::BTreeMap;
use tauri::{Emitter, Manager, State};

#[cfg(windows)]
use tauri::WebviewWindow;
#[cfg(windows)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

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
        platform.configure_ignored(&settings.ignored_app_ids());
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
pub fn register_desktop_wells(targets: Vec<crate::platform::snap::WellTarget>) {
    crate::platform::snap::set_well_targets(targets);
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
pub fn set_appearance(
    app: tauri::AppHandle,
    state: State<AppState>,
    mode: AppearanceMode,
) -> Result<(), String> {
    state.settings.set_appearance(mode)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_wallpaper(
    app: tauri::AppHandle,
    state: State<AppState>,
    wallpaper_id: String,
) -> Result<(), String> {
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

#[cfg(windows)]
fn validated_shortcuts(
    shortcuts: &BTreeMap<String, String>,
) -> Result<Vec<(String, Shortcut)>, String> {
    let supported = crate::settings::default_shortcuts();
    let reserved = ["alt+space", "f3", "ctrl+alt+g"]
        .into_iter()
        .map(|binding| {
            binding
                .parse::<Shortcut>()
                .expect("valid reserved shortcut")
        })
        .collect::<Vec<_>>();
    let mut parsed = Vec::with_capacity(shortcuts.len());
    for (action, binding) in shortcuts {
        if !supported.contains_key(action) {
            return Err(format!("'{action}' is not a configurable Gravity action"));
        }
        if binding.trim().is_empty() || binding.len() > 64 || !binding.is_ascii() {
            return Err("Shortcut bindings must be 1 to 64 ASCII characters".into());
        }
        let shortcut = binding
            .parse::<Shortcut>()
            .map_err(|error| format!("'{binding}' is not a valid shortcut: {error}"))?;
        if shortcut.mods.is_empty() {
            return Err("Configurable shortcuts must include Ctrl, Alt, Shift, or Windows".into());
        }
        if reserved.contains(&shortcut) {
            return Err(format!(
                "'{binding}' is reserved for a critical Gravity shell control"
            ));
        }
        if let Some((other, _)) = parsed.iter().find(|(_, value)| *value == shortcut) {
            return Err(format!("'{binding}' is already assigned to {other}"));
        }
        parsed.push((action.clone(), shortcut));
    }
    Ok(parsed)
}

#[cfg(windows)]
fn install_shortcut_map(
    app: &tauri::AppHandle,
    state: &AppState,
    next: BTreeMap<String, String>,
) -> Result<(), String> {
    let current = state.settings.shortcuts();
    let current_parsed = validated_shortcuts(&current)?;
    let next_parsed = validated_shortcuts(&next)?;
    let manager = app.global_shortcut();

    for (_, shortcut) in &current_parsed {
        if manager.is_registered(*shortcut) {
            manager
                .unregister(*shortcut)
                .map_err(|error| error.to_string())?;
        }
    }

    let mut installed = Vec::new();
    for (_, shortcut) in &next_parsed {
        if let Err(error) = manager.register(*shortcut) {
            for registered in installed {
                let _ = manager.unregister(registered);
            }
            for (_, previous) in &current_parsed {
                let _ = manager.register(*previous);
            }
            return Err(format!("Windows could not claim that shortcut: {error}"));
        }
        installed.push(*shortcut);
    }

    if let Err(error) = state.settings.replace_shortcuts(next) {
        for shortcut in installed {
            let _ = manager.unregister(shortcut);
        }
        for (_, previous) in &current_parsed {
            let _ = manager.register(*previous);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
pub fn register_configured_shortcuts(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    match validated_shortcuts(&state.settings.shortcuts()) {
        Ok(shortcuts) => {
            for (action, shortcut) in shortcuts {
                if let Err(error) = app.global_shortcut().register(shortcut) {
                    eprintln!("Gravity shortcut '{action}' could not be registered: {error}");
                }
            }
        }
        Err(error) => eprintln!("Gravity shortcut settings were ignored: {error}"),
    }
}

#[tauri::command]
pub fn set_shortcut(
    app: tauri::AppHandle,
    state: State<AppState>,
    action_id: String,
    binding: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut next = state.settings.shortcuts();
        if !crate::settings::default_shortcuts().contains_key(&action_id) {
            return Err("That shortcut action is not supported".into());
        }
        if let Some(binding) = binding.map(|value| value.trim().to_ascii_lowercase()) {
            next.insert(action_id, binding);
        } else {
            next.remove(&action_id);
        }
        install_shortcut_map(&app, &state, next)?;
        state_changed(&app);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, action_id, binding);
        Ok(())
    }
}

#[tauri::command]
pub fn reset_shortcuts(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    #[cfg(windows)]
    {
        install_shortcut_map(&app, &state, crate::settings::default_shortcuts())?;
        state_changed(&app);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
        Ok(())
    }
}

#[tauri::command]
pub fn capture_scene(
    app: tauri::AppHandle,
    state: State<AppState>,
    name: String,
) -> Result<WindowScene, String> {
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
pub fn restore_scene(
    app: tauri::AppHandle,
    state: State<AppState>,
    scene_id: String,
) -> Result<(), String> {
    let scene = state
        .settings
        .scene(&scene_id)
        .ok_or_else(|| "That Scene no longer exists".to_string())?;
    state.platform.restore_scene(&scene)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_scene(
    app: tauri::AppHandle,
    state: State<AppState>,
    scene_id: String,
) -> Result<(), String> {
    state.settings.delete_scene(&scene_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_scene_auto_restore(
    app: tauri::AppHandle,
    state: State<AppState>,
    scene_id: String,
    enabled: bool,
) -> Result<(), String> {
    state.settings.set_scene_auto_restore(&scene_id, enabled)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn set_app_ignored(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_id: String,
    ignored: bool,
) -> Result<(), String> {
    if !state
        .platform
        .snapshot()
        .apps
        .iter()
        .any(|item| item.id == app_id)
    {
        return Err("That application is no longer installed".into());
    }
    state.settings.set_app_ignored(&app_id, ignored)?;
    state
        .platform
        .configure_ignored(&state.settings.ignored_app_ids());
    state_changed(&app);
    Ok(())
}

#[cfg(windows)]
fn apply_launch_at_login(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|error| error.to_string())?;
    if enabled {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        key.set_value("Gravity OS", &format!("\"{}\"", executable.display()))
            .map_err(|error| error.to_string())
    } else {
        match key.delete_value("Gravity OS") {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn set_launch_at_login(
    app: tauri::AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    apply_launch_at_login(enabled)?;
    state.settings.set_launch_at_login(enabled)?;
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
pub fn delete_window_rule(
    app: tauri::AppHandle,
    state: State<AppState>,
    rule_id: String,
) -> Result<(), String> {
    state.settings.delete_rule(&rule_id)?;
    state.platform.configure_rules(&state.settings.rules());
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn focus_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    state.platform.focus_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn minimize_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    state.platform.minimize_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn toggle_maximize_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    state.platform.toggle_maximize_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn close_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    state.platform.close_window(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn window_action(
    app: tauri::AppHandle,
    state: State<AppState>,
    action: String,
) -> Result<(), String> {
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
pub fn apply_grid_region(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    state
        .platform
        .apply_grid_region(&window_id, x, y, width, height)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn warp_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
    operation: String,
) -> Result<(), String> {
    state.platform.warp_window(&window_id, &operation)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn park_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
    well_id: String,
) -> Result<(), String> {
    state.platform.park_window(&window_id, &well_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn release_window(
    app: tauri::AppHandle,
    state: State<AppState>,
    window_id: String,
) -> Result<(), String> {
    state.platform.release_window(&window_id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn release_all_parked_windows(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    state.platform.release_all_parked_windows()?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn launch_app(
    app: tauri::AppHandle,
    state: State<AppState>,
    app_id: String,
) -> Result<LaunchResult, String> {
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
pub fn set_brightness(
    app: tauri::AppHandle,
    state: State<AppState>,
    value: f32,
) -> Result<(), String> {
    state.platform.set_brightness(value)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn toggle_setting(
    app: tauri::AppHandle,
    state: State<AppState>,
    key: String,
) -> Result<(), String> {
    state.platform.toggle_setting(&key)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn dismiss_notification(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    state.platform.dismiss_notification(&id)?;
    state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn switch_orbit(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
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

#[cfg(all(test, windows))]
mod shortcut_tests {
    use super::*;

    #[test]
    fn every_default_shortcut_parses_without_reserved_or_duplicate_chords() {
        let parsed = validated_shortcuts(&crate::settings::default_shortcuts()).unwrap();
        assert_eq!(parsed.len(), crate::settings::default_shortcuts().len());
    }

    #[test]
    fn shortcut_validation_rejects_the_critical_windows_handoff() {
        let mut shortcuts = BTreeMap::new();
        shortcuts.insert("left-half".into(), "ctrl+alt+g".into());
        assert!(validated_shortcuts(&shortcuts)
            .unwrap_err()
            .contains("critical Gravity shell control"));
    }
}
