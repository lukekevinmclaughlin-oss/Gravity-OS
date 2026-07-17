//! Gravity OS core entry. Sets up the shell surface windows and,
//! on Windows, takes over the desktop.

mod commands;
mod geometry;
mod platform;
mod settings;
mod shell;

use commands::AppState;
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
    // Strips are non-activating (like the macOS menu bar and Dock): clicking
    // them must not steal focus, so Edit chords reach the frontmost app.
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
            false,
        )?;
        deepfield.set_size(tauri::PhysicalSize::new(size.width, size.height))?;
        deepfield.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
        if let Ok(hwnd) = deepfield.hwnd() {
            platform::shell_control::attach_to_desktop(hwnd.0 as isize);
        }

        let horizon = build_surface(
            app,
            &format!("horizon-{index}"),
            &surface_url("horizon"),
            true,
            true,
            false,
        )?;
        horizon.set_size(tauri::PhysicalSize::new(size.width, horizon_height))?;
        horizon.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;

        let orbit = build_surface(
            app,
            &format!("orbit-{index}"),
            &surface_url("orbit"),
            true,
            true,
            false,
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
            let pulse = build_surface(
                app,
                "pulse-0",
                &surface_url("pulse"),
                true,
                false,
                false,
            )?;
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
    let _ = app.emit("gravity://overlay", serde_json::json!({ "surface": surface }));
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
fn register_surface_appbars(app: &tauri::AppHandle) {
    use platform::shell_control::{register_app_bar, AppBarEdge};
    use windows::Win32::Foundation::RECT;

    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));

    // Negotiate every top edge first, then every bottom edge. AppBar geometry
    // is global Explorer state, so deterministic ordering avoids a surface
    // inheriting a reservation made by another Gravity surface.
    for (prefix, edge) in [
        ("horizon", AppBarEdge::Top),
        ("orbit", AppBarEdge::Bottom),
    ] {
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

    anchor_shell_surfaces(app);

    // Explorer applies the negotiated AppBar rectangles asynchronously. A
    // second anchor after that commit keeps Horizon flush to the monitor edge
    // while its reservation begins immediately below it.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(160));
        anchor_shell_surfaces(&app);
    });
}

#[cfg(windows)]
fn anchor_shell_surfaces(app: &tauri::AppHandle) {
    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));

    // AppBar reservation and visual hitbox are intentionally separate for
    // Orbit, whose transparent margins must never steal application clicks.
    for (index, monitor) in monitors.iter().enumerate() {
        let position = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let horizon_height = (HORIZON_STRIP * scale).round() as u32;
        if let Some(horizon) = app.get_webview_window(&format!("horizon-{index}")) {
            let _ = horizon.set_size(tauri::PhysicalSize::new(size.width, horizon_height));
            let _ = horizon.set_position(tauri::PhysicalPosition::new(position.x, position.y));
        }
        let orbit_height = (ORBIT_STRIP * scale).round() as u32;
        let orbit_width = ((980.0 * scale).round() as u32).min(size.width);
        if let Some(orbit) = app.get_webview_window(&format!("orbit-{index}")) {
            let _ = orbit.set_size(tauri::PhysicalSize::new(orbit_width, orbit_height));
            let _ = orbit.set_position(tauri::PhysicalPosition::new(
                position.x + (size.width - orbit_width) as i32 / 2,
                position.y + size.height as i32 - orbit_height as i32,
            ));
        }
    }
}

/// The Gravity ⇄ Windows 11 toggle: suspend hides every Gravity surface and
/// hands the desktop back (taskbar + work area); resume re-engages. The tray
/// icon stays either way, so Windows mode always has a way back.
#[cfg(windows)]
pub(crate) fn set_shell_active_impl(app: &tauri::AppHandle, active: bool) {
    use tauri::Emitter;
    let state = app.state::<AppState>();
    if active {
        state.platform.engage_shell();
        register_surface_appbars(app);
    } else {
        state.platform.disengage_shell();
    }
    for (label, window) in app.webview_windows() {
        if ["deepfield-", "horizon-", "orbit-"]
            .iter()
            .any(|prefix| label.starts_with(prefix))
        {
            let _ = if active { window.show() } else { window.hide() };
        } else if label.starts_with("overlay-")
            || label.starts_with("snap-")
            || label.starts_with("pulse-")
        {
            let _ = window.hide();
        }
    }
    let _ = app.emit("gravity://shell-active", active);
}

#[cfg(windows)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let resume = MenuItem::with_id(app, "resume", "Resume Gravity", true, None::<&str>)?;
    let windows11 = MenuItem::with_id(app, "windows11", "Switch to Windows 11", true, None::<&str>)?;
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
        "resume" => set_shell_active_impl(app, true),
        "windows11" => set_shell_active_impl(app, false),
        "quit" => {
            set_shell_active_impl(app, false);
            app.exit(0);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default();

    // Global hotkeys (spec §12): Alt+Space → Singularity (Spotlight muscle
    // memory, PowerToys-Run precedent), Ctrl+Alt+Up → Constellation
    // (macOS Ctrl+Up). Registered core-side; no capability surface.
    #[cfg(windows)]
    let builder = {
        use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
        let alt_space: Shortcut = "alt+space".parse().expect("parse alt+space");
        let constellation: Shortcut = "f3".parse().expect("parse f3");
        let left: Shortcut = "ctrl+alt+left".parse().expect("parse left layout");
        let right: Shortcut = "ctrl+alt+right".parse().expect("parse right layout");
        let top: Shortcut = "ctrl+alt+up".parse().expect("parse top layout");
        let bottom: Shortcut = "ctrl+alt+down".parse().expect("parse bottom layout");
        let maximize: Shortcut = "ctrl+alt+enter".parse().expect("parse maximize");
        let undo: Shortcut = "ctrl+alt+z".parse().expect("parse layout undo");
        let previous_display: Shortcut = "ctrl+alt+shift+left"
            .parse()
            .expect("parse previous display");
        let next_display: Shortcut = "ctrl+alt+shift+right"
            .parse()
            .expect("parse next display");
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([
                    alt_space,
                    constellation,
                    left,
                    right,
                    top,
                    bottom,
                    maximize,
                    undo,
                    previous_display,
                    next_display,
                ])
                .expect("register global shortcuts")
                .with_handler(move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if *shortcut == alt_space {
                            open_overlay_surface(app, "singularity");
                        } else if *shortcut == constellation {
                            open_overlay_surface(app, "constellation");
                        } else {
                            let action = if *shortcut == left {
                                Some("left-half")
                            } else if *shortcut == right {
                                Some("right-half")
                            } else if *shortcut == top {
                                Some("top-half")
                            } else if *shortcut == bottom {
                                Some("bottom-half")
                            } else if *shortcut == maximize {
                                Some("maximize")
                            } else if *shortcut == undo {
                                Some("undo")
                            } else if *shortcut == previous_display {
                                Some("previous-display")
                            } else if *shortcut == next_display {
                                Some("next-display")
                            } else {
                                None
                            };
                            if let Some(action) = action {
                                let state = app.state::<AppState>();
                                let _ = state.platform.window_action(action);
                            }
                        }
                    }
                })
                .build(),
        )
    };

    builder
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_shell_state,
            commands::fit_orbit_window,
            commands::focus_window,
            commands::minimize_window,
            commands::close_window,
            commands::window_action,
            commands::window_action_for,
            commands::launch_app,
            commands::set_app_pinned,
            commands::reorder_pinned_apps,
            commands::set_appearance,
            commands::set_wallpaper,
            commands::set_window_preferences,
            commands::capture_scene,
            commands::restore_scene,
            commands::delete_scene,
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
                setup_shell(_app)?;
                register_surface_appbars(_app.handle());
                platform::snap::start(_app.handle().clone());
                setup_tray(_app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // When the shell exits, always hand the desktop back.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                state.platform.disengage_shell();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Gravity OS");
}
