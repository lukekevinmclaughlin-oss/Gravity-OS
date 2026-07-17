//! Gravity OS core entry. Sets up the shell surface windows and,
//! on Windows, takes over the desktop.

mod commands;
mod platform;
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
    let (w, h) = match app.primary_monitor()? {
        Some(m) => {
            let size = m.size();
            let scale = m.scale_factor();
            (size.width as f64 / scale, size.height as f64 / scale)
        }
        None => (1920.0, 1080.0),
    };

    // Wallpaper / backdrop — behind app windows (not topmost).
    // Roadmap: reparent to WorkerW so real desktop icons sit above it.
    let deepfield = build_surface(app, "deepfield", "deepfield", false, true, false)?;
    deepfield.set_size(tauri::LogicalSize::new(w, h))?;
    deepfield.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Top menu bar strip.
    let horizon = build_surface(app, "horizon", "horizon", true, true, false)?;
    horizon.set_size(tauri::LogicalSize::new(w, HORIZON_STRIP))?;
    horizon.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Bottom dock strip.
    let orbit = build_surface(app, "orbit", "orbit", true, true, false)?;
    orbit.set_size(tauri::LogicalSize::new(w, ORBIT_STRIP))?;
    orbit.set_position(tauri::LogicalPosition::new(0.0, h - ORBIT_STRIP))?;

    // One reusable full-screen overlay for Singularity / Core / Constellation.
    // Focusable: Singularity needs the keyboard.
    let overlay = build_surface(app, "overlay", "overlay", true, false, true)?;
    overlay.set_size(tauri::LogicalSize::new(w, h))?;
    overlay.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Take over the desktop.
    let state = app.state::<AppState>();
    state.platform.engage_shell();

    Ok(())
}

/// Show the reusable overlay window with the requested surface.
/// Used by the global shortcuts; mirrors openOverlay() in the UI.
#[cfg(windows)]
fn open_overlay_surface(app: &tauri::AppHandle, surface: &str) {
    use tauri::Emitter;
    let _ = app.emit("gravity://overlay", serde_json::json!({ "surface": surface }));
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_focus();
    }
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
        let ctrl_alt_up: Shortcut = "ctrl+alt+up".parse().expect("parse ctrl+alt+up");
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([alt_space, ctrl_alt_up])
                .expect("register global shortcuts")
                .with_handler(move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if *shortcut == alt_space {
                            open_overlay_surface(app, "singularity");
                        } else if *shortcut == ctrl_alt_up {
                            open_overlay_surface(app, "constellation");
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
            commands::focus_window,
            commands::minimize_window,
            commands::close_window,
            commands::launch_app,
            commands::set_volume,
            commands::set_brightness,
            commands::toggle_setting,
            commands::dismiss_notification,
            commands::switch_orbit,
            commands::empty_trash,
            commands::engage_shell,
            commands::disengage_shell,
            commands::set_full_replacement,
            commands::is_shell_replaced,
            commands::get_app_icon,
            commands::power_action,
            commands::edit_action,
            commands::open_uri,
        ])
        .setup(|_app| {
            #[cfg(windows)]
            setup_shell(_app)?;
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
