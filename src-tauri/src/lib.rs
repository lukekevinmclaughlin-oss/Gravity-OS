//! Gravity OS core entry. Sets up the shell surface windows and,
//! on Windows, takes over the desktop.

mod commands;
mod geometry;
mod platform;
mod settings;
mod shell;

use commands::AppState;
use shell::{AppearanceMode, ResolvedAppearance, ShellMode, ShellTransitionResult};
use tauri::Manager;

#[cfg(windows)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Heights of the strip windows. Horizon is the closed bar height (the
/// window grows while a menu is open — see growHorizonWindow in the UI);
/// Orbit fits the 2.0× magnified tile plus its label (spec §3–4).
#[cfg(windows)]
const HORIZON_STRIP: f64 = 34.0;
#[cfg(windows)]
const ORBIT_STRIP: f64 = 170.0;

#[cfg(windows)]
fn build_surface(
    app: &tauri::App,
    label: &str,
    surface: &str,
    topmost: bool,
    visible: bool,
    focusable: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?surface={surface}").into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(topmost)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    // Interactive surfaces must be focusable for reliable WebView2 pointer,
    // keyboard, context-menu and accessibility behavior. Horizon preserves
    // its foreign target explicitly before it takes focus.
    .focusable(focusable)
    .visible(visible)
    .build()
}

#[cfg(windows)]
fn setup_shell(app: &tauri::App) -> tauri::Result<()> {
    // Take over the desktop *before* positioning our windows: the work-area
    // change broadcasts a relayout that would otherwise shift the strips.
    {
        let state = app.state::<AppState>();
        state.platform.engage_shell();
    }

    // Wallpaper / backdrop — reparented into Explorer's WorkerW so desktop
    // icons and every normal application naturally layer above it.
    let mut monitors = app.available_monitors()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    if monitors.is_empty() {
        return Err(tauri::Error::WindowNotFound);
    }

    for (index, monitor) in monitors.iter().enumerate() {
        let size = monitor.size();
        let position = monitor.position();
        let scale = monitor.scale_factor();
        let horizon_height = (HORIZON_STRIP * scale).round() as u32;
        let orbit_height = (ORBIT_STRIP * scale).round() as u32;
        let surface_url = |surface: &str| format!("{surface}&monitor={index}");

        let deepfield = build_surface(
            app,
            &format!("deepfield-{index}"),
            &surface_url("deepfield"),
            false,
            true,
            true,
        )?;
        deepfield.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
        deepfield.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
        if let Ok(hwnd) = deepfield.hwnd() {
            platform::shell_control::attach_to_desktop(hwnd.0 as isize);
        }

        // Wells live in a separate region-shaped child above Explorer's icon
        // view. The wallpaper remains behind icons, while only the visible
        // Well controls participate in native mouse hit testing.
        let wells = build_surface(
            app,
            &format!("wells-{index}"),
            &surface_url("wells"),
            false,
            true,
            true,
        )?;
        wells.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
        wells.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
        if let Ok(hwnd) = wells.hwnd() {
            platform::shell_control::configure_well_interaction_layer(hwnd.0 as isize);
            let _ = platform::shell_control::set_well_interaction_region(
                hwnd.0 as isize,
                size.width as i32,
                size.height as i32,
                &[],
                false,
            );
        }

        let horizon = build_surface(
            app,
            &format!("horizon-{index}"),
            &surface_url("horizon"),
            true,
            true,
            true,
        )?;
        horizon.set_size(tauri::PhysicalSize::new(size.width, horizon_height))?;
        horizon.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;

        let orbit = build_surface(
            app,
            &format!("orbit-{index}"),
            &surface_url("orbit"),
            true,
            true,
            true,
        )?;
        let orbit_width = ((980.0 * scale).round() as u32).min(size.width);
        orbit.set_size(tauri::PhysicalSize::new(orbit_width, orbit_height))?;
        orbit.set_position(tauri::PhysicalPosition::new(
            position.x + (size.width - orbit_width) as i32 / 2,
            position.y + size.height as i32 - orbit_height as i32,
        ))?;

        let overlay = build_surface(
            app,
            &format!("overlay-{index}"),
            &surface_url("overlay"),
            true,
            false,
            true,
        )?;
        overlay.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
        overlay.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;

        let snap = build_surface(
            app,
            &format!("snap-{index}"),
            &surface_url("snap"),
            true,
            false,
            false,
        )?;
        snap.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
        snap.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
        snap.set_ignore_cursor_events(true)?;

        if index == 0 {
            let pulse = build_surface(app, "pulse-0", &surface_url("pulse"), true, false, false)?;
            pulse.set_size(tauri::PhysicalSize::new(
                (370.0 * scale).round() as u32,
                (500.0 * scale).round() as u32,
            ))?;
            pulse.set_position(tauri::PhysicalPosition::new(
                position.x + size.width as i32 - (370.0 * scale).round() as i32,
                position.y,
            ))?;
        }
    }

    Ok(())
}

/// Show the reusable overlay window with the requested surface.
/// Used by the global shortcuts; mirrors openOverlay() in the UI.
#[cfg(windows)]
fn open_overlay_surface(app: &tauri::AppHandle, surface: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "gravity://overlay",
        serde_json::json!({ "surface": surface }),
    );
    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    let mut point = windows::Win32::Foundation::POINT::default();
    let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) };
    let monitor_index = monitors
        .iter()
        .position(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            point.x >= position.x
                && point.x < position.x + size.width as i32
                && point.y >= position.y
                && point.y < position.y + size.height as i32
        })
        .unwrap_or(0);
    if let Some(w) = app.get_webview_window(&format!("overlay-{monitor_index}")) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(windows)]
fn configured_shortcut_action(
    app: &tauri::AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
) -> Option<String> {
    app.state::<AppState>()
        .settings
        .shortcuts()
        .into_iter()
        .find_map(|(action, binding)| {
            binding
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .ok()
                .filter(|candidate| candidate == shortcut)
                .map(|_| action)
        })
}

#[cfg(windows)]
fn dispatch_configured_shortcut(app: &tauri::AppHandle, action: &str) {
    use tauri::Emitter;
    match action {
        "open-window-studio" => open_overlay_surface(app, "window-studio"),
        "grid-picker" | "warp-mode" => {
            open_overlay_surface(app, "window-studio");
            let _ = app.emit(
                "gravity://window-studio-tab",
                serde_json::json!({ "tab": if action == "grid-picker" { "grid" } else { "warp" } }),
            );
        }
        "save-scene" => {
            let state = app.state::<AppState>();
            let name = format!(
                "Scene {}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            );
            if let Ok(scene) = state.platform.capture_scene(&name) {
                let _ = state.settings.add_scene(scene);
                let _ = app.emit("gravity://state-changed", ());
            }
        }
        "restore-scene" => {
            let state = app.state::<AppState>();
            if let Some(scene) = state.settings.latest_scene() {
                let _ = state.platform.restore_scene(&scene);
                let _ = app.emit("gravity://state-changed", ());
            }
        }
        "toggle-shapes" | "equalize-shapes" => {
            let _ = app.emit(
                "gravity://well-command",
                serde_json::json!({ "command": action }),
            );
        }
        "release-parked-windows" => {
            let state = app.state::<AppState>();
            let _ = state.platform.release_all_parked_windows();
            let _ = app.emit("gravity://state-changed", ());
        }
        "new-well" => {
            let _ = app.emit(
                "gravity://well-command",
                serde_json::json!({ "command": "add-well" }),
            );
        }
        "minimize-active" | "close-active" => {
            let state = app.state::<AppState>();
            let snapshot = state.platform.snapshot();
            let target = snapshot
                .windows
                .iter()
                .find(|window| window.focused && window.parked_well_id.is_none())
                .or_else(|| {
                    snapshot
                        .windows
                        .iter()
                        .find(|window| !window.minimized && window.parked_well_id.is_none())
                });
            if let Some(window) = target {
                let _ = if action == "minimize-active" {
                    state.platform.minimize_window(&window.id)
                } else {
                    state.platform.close_window(&window.id)
                };
                let _ = app.emit("gravity://state-changed", ());
            }
        }
        "toggle-appearance" => {
            let state = app.state::<AppState>();
            let mut snapshot = state.platform.snapshot();
            state.settings.apply_to_state(&mut snapshot);
            let next = if matches!(snapshot.appearance.resolved, ResolvedAppearance::Light) {
                AppearanceMode::Dark
            } else {
                AppearanceMode::Light
            };
            let _ = state.settings.set_appearance(next);
            let _ = app.emit("gravity://state-changed", ());
        }
        action if action.starts_with("store-well-") => {
            let Some(index) = action
                .strip_prefix("store-well-")
                .and_then(|value| value.parse::<usize>().ok())
                .and_then(|value| value.checked_sub(1))
            else {
                return;
            };
            let state = app.state::<AppState>();
            let targets = platform::snap::well_targets_snapshot();
            let Some(well) = targets.get(index) else {
                return;
            };
            let snapshot = state.platform.snapshot();
            let occupied = snapshot
                .windows
                .iter()
                .filter(|window| window.parked_well_id.as_deref() == Some(well.id.as_str()))
                .count();
            let target = snapshot
                .windows
                .iter()
                .find(|window| {
                    window.focused && !window.minimized && window.parked_well_id.is_none()
                })
                .or_else(|| {
                    snapshot
                        .windows
                        .iter()
                        .find(|window| !window.minimized && window.parked_well_id.is_none())
                });
            if occupied < well.capacity {
                if let Some(window) = target {
                    let _ = state.platform.park_window(&window.id, &well.id);
                    let _ = app.emit("gravity://state-changed", ());
                }
            }
        }
        action => {
            let state = app.state::<AppState>();
            let _ = state.platform.window_action(action);
        }
    }
}

#[cfg(windows)]
fn negotiate_surface_appbars(app: &tauri::AppHandle) {
    use platform::shell_control::{register_app_bar, AppBarEdge};
    use windows::Win32::Foundation::RECT;

    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));

    // Negotiate every top edge first, then every bottom edge. AppBar geometry
    // is global Explorer state, so deterministic ordering avoids a surface
    // inheriting a reservation made by another Gravity surface.
    for (prefix, edge) in [("horizon", AppBarEdge::Top), ("orbit", AppBarEdge::Bottom)] {
        for (index, monitor) in monitors.iter().enumerate() {
            let Some(window) = app.get_webview_window(&format!("{prefix}-{index}")) else {
                continue;
            };
            let Ok(hwnd) = window.hwnd() else { continue };
            let position = monitor.position();
            let size = monitor.size();
            let thickness = match edge {
                AppBarEdge::Top => (HORIZON_STRIP * monitor.scale_factor()).round() as i32,
                AppBarEdge::Bottom => (ORBIT_STRIP * monitor.scale_factor()).round() as i32,
            };
            register_app_bar(
                hwnd.0 as isize,
                edge,
                RECT {
                    left: position.x,
                    top: position.y,
                    right: position.x + size.width as i32,
                    bottom: position.y + size.height as i32,
                },
                thickness,
            );
        }
    }
}

#[cfg(windows)]
fn register_surface_appbars(app: &tauri::AppHandle) {
    negotiate_surface_appbars(app);

    // Explorer publishes a late work-area relayout after ABM_SETPOS. Reassert
    // the immutable physical coordinates once that broadcast has drained.
    // This retry uses raw Win32 only and is serialized with Windows handoff in
    // shell_control; it cannot block or re-enter the WebView event loop.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(300));
        platform::shell_control::refresh_app_bars_if_active();
    });
}

/// The Gravity ⇄ Windows 11 toggle: suspend hides every Gravity surface and
/// hands the desktop back (taskbar + work area); resume re-engages. The tray
/// icon stays either way, so Windows mode always has a way back.
#[cfg(windows)]
pub(crate) fn set_shell_active_impl(
    app: &tauri::AppHandle,
    active: bool,
) -> Result<ShellTransitionResult, String> {
    use tauri::Emitter;
    let state = app.state::<AppState>();
    let settled = if active {
        ShellMode::Gravity
    } else {
        ShellMode::Windows
    };
    {
        // Never hold this state mutex while emitting events, talking to
        // Explorer, or dispatching Tauri window operations. Those paths can
        // synchronously re-enter `get_shell_state` from WebView2 or the global
        // shortcut event loop; keeping the guard would deadlock the shell.
        let mut mode = state.shell_mode.lock();
        if *mode == settled {
            return Ok(ShellTransitionResult {
                mode: settled,
                active,
            });
        }
        *mode = if active {
            ShellMode::EnteringGravity
        } else {
            ShellMode::LeavingGravity
        };
    }
    let _ = app.emit("gravity://state-changed", ());

    let mut failures = Vec::new();
    if active {
        state.platform.engage_shell();
    }
    for (label, window) in app.webview_windows() {
        if ["deepfield-", "wells-", "horizon-", "orbit-"]
            .iter()
            .any(|prefix| label.starts_with(prefix))
        {
            let result = if active { window.show() } else { window.hide() };
            if let Err(error) = result {
                failures.push(format!("{label}: {error}"));
            }
        } else if label.starts_with("overlay-")
            || label.starts_with("snap-")
            || label.starts_with("pulse-")
        {
            if let Err(error) = window.hide() {
                failures.push(format!("{label}: {error}"));
            }
        }
    }
    if active {
        // Showing a previously hidden WebView can restore the work-area-
        // relative placement cached by Windows. Negotiate and position the
        // AppBars only after every strip is visible so the raw physical
        // coordinates remain authoritative across repeated handoffs.
        register_surface_appbars(app);
    } else {
        state.platform.disengage_shell();
    }

    if !failures.is_empty() {
        *state.shell_mode.lock() = ShellMode::Faulted;
        let message = format!("Shell transition was incomplete: {}", failures.join("; "));
        let _ = app.emit("gravity://state-changed", ());
        return Err(message);
    }

    *state.shell_mode.lock() = settled;
    let _ = app.emit("gravity://shell-active", active);
    let _ = app.emit("gravity://state-changed", ());
    Ok(ShellTransitionResult {
        mode: settled,
        active,
    })
}

#[cfg(windows)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let resume = MenuItem::with_id(app, "resume", "Resume Gravity", true, None::<&str>)?;
    let windows11 =
        MenuItem::with_id(app, "windows11", "Switch to Windows 11", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Gravity OS", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&resume, &windows11, &quit])?;

    let mut tray = TrayIconBuilder::with_id("gravity")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Gravity OS");
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "resume" => {
            let _ = set_shell_active_impl(app, true);
        }
        "windows11" => {
            let _ = set_shell_active_impl(app, false);
        }
        "quit" => {
            let _ = set_shell_active_impl(app, false);
            app.exit(0);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}

#[cfg(windows)]
fn start_scene_auto_restore(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_fingerprint = String::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let state = app.state::<AppState>();
            let fingerprint = state.platform.current_display_fingerprint();
            if fingerprint == last_fingerprint {
                continue;
            }
            last_fingerprint = fingerprint.clone();
            if !matches!(
                *state.shell_mode.lock(),
                ShellMode::Gravity | ShellMode::EnteringGravity
            ) {
                continue;
            }
            if let Some(scene) = state.settings.auto_restore_scene(&fingerprint) {
                if state.platform.restore_scene(&scene).is_ok() {
                    use tauri::Emitter;
                    let _ = app.emit("gravity://state-changed", ());
                }
            }
        }
    });
}

pub fn run() {
    let builder = tauri::Builder::default();

    // A second launch is a deliberate "resume Gravity" action. This keeps
    // the Start menu and desktop shortcut useful while Windows mode is active
    // without ever creating a duplicate shell process.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = set_shell_active_impl(app, true);
    }));

    // Global hotkeys (spec §12): Alt+Space → Singularity (Spotlight muscle
    // memory, PowerToys-Run precedent), Ctrl+Alt+Up → Constellation
    // F3 opens the window overview. Registered core-side; no capability surface.
    #[cfg(windows)]
    let builder = {
        use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
        let alt_space: Shortcut = "alt+space".parse().expect("parse alt+space");
        let constellation: Shortcut = "f3".parse().expect("parse f3");
        let toggle_shell: Shortcut = "ctrl+alt+g".parse().expect("parse shell toggle");
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([alt_space, constellation, toggle_shell])
                .expect("register global shortcuts")
                .with_handler(move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if *shortcut == toggle_shell {
                            let active = {
                                let state = app.state::<AppState>();
                                let mode = *state.shell_mode.lock();
                                matches!(mode, ShellMode::Gravity | ShellMode::EnteringGravity)
                            };
                            let _ = set_shell_active_impl(app, !active);
                        } else if *shortcut == alt_space {
                            open_overlay_surface(app, "singularity");
                        } else if *shortcut == constellation {
                            open_overlay_surface(app, "constellation");
                        } else if let Some(action) = configured_shortcut_action(app, shortcut) {
                            dispatch_configured_shortcut(app, &action);
                        }
                    }
                })
                .build(),
        )
    };

    let app = builder
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_shell_state,
            commands::fit_orbit_window,
            commands::set_shell_surface_expanded,
            commands::focus_window,
            commands::minimize_window,
            commands::toggle_maximize_window,
            commands::close_window,
            commands::active_window_control,
            commands::window_action,
            commands::window_action_for,
            commands::apply_grid_region,
            commands::apply_grid_region_on_monitor,
            commands::warp_window,
            commands::park_window,
            commands::release_window,
            commands::release_all_parked_windows,
            commands::register_desktop_wells,
            commands::set_well_surface_expanded,
            commands::set_pulse_interaction_region,
            commands::register_desktop_trash_target,
            commands::is_desktop_trash_target,
            commands::desktop_pointer_location,
            commands::begin_dock_window_drag,
            commands::store_app_in_well,
            commands::begin_dock_app_drag,
            commands::launch_app,
            commands::launch_app_with_files,
            commands::set_app_pinned,
            commands::reorder_pinned_apps,
            commands::set_appearance,
            commands::set_wallpaper,
            commands::set_window_preferences,
            commands::set_shortcut,
            commands::reset_shortcuts,
            commands::capture_scene,
            commands::restore_scene,
            commands::delete_scene,
            commands::set_scene_auto_restore,
            commands::set_app_ignored,
            commands::set_launch_at_login,
            commands::upsert_window_rule,
            commands::delete_window_rule,
            commands::set_volume,
            commands::set_brightness,
            commands::toggle_setting,
            commands::dismiss_notification,
            commands::switch_orbit,
            commands::move_window_to_orbit,
            commands::empty_trash,
            commands::engage_shell,
            commands::disengage_shell,
            commands::set_full_replacement,
            commands::is_shell_replaced,
            commands::get_app_icon,
            commands::power_action,
            commands::edit_action,
            commands::open_uri,
            commands::set_shell_active,
            commands::quit_shell,
        ])
        .setup(|_app| {
            #[cfg(windows)]
            {
                commands::register_configured_shortcuts(_app.handle());
                setup_shell(_app)?;
                register_surface_appbars(_app.handle());
                platform::snap::start(_app.handle().clone());
                start_scene_auto_restore(_app.handle().clone());
                setup_tray(_app)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gravity OS");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app.state::<AppState>();
            state.platform.disengage_shell();
        }
    });
}
