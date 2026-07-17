//! Gravity OS core entry. Sets up the shell surface windows and,
//! on Windows, takes over the desktop.

mod commands;
mod platform;
mod shell;

use commands::AppState;
use tauri::Manager;

#[cfg(windows)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Heights reserved for the top (Horizon) and bottom (Orbit) strips.
#[cfg(windows)]
const HORIZON_STRIP: f64 = 56.0;
#[cfg(windows)]
const ORBIT_STRIP: f64 = 124.0;

#[cfg(windows)]
fn build_surface(
    app: &tauri::App,
    label: &str,
    surface: &str,
    topmost: bool,
    visible: bool,
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
    let deepfield = build_surface(app, "deepfield", "deepfield", false, true)?;
    deepfield.set_size(tauri::LogicalSize::new(w, h))?;
    deepfield.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Top menu bar strip.
    let horizon = build_surface(app, "horizon", "horizon", true, true)?;
    horizon.set_size(tauri::LogicalSize::new(w, HORIZON_STRIP))?;
    horizon.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Bottom dock strip.
    let orbit = build_surface(app, "orbit", "orbit", true, true)?;
    orbit.set_size(tauri::LogicalSize::new(w, ORBIT_STRIP))?;
    orbit.set_position(tauri::LogicalPosition::new(0.0, h - ORBIT_STRIP))?;

    // One reusable full-screen overlay for Singularity / Core / Constellation.
    let overlay = build_surface(app, "overlay", "overlay", true, false)?;
    overlay.set_size(tauri::LogicalSize::new(w, h))?;
    overlay.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Take over the desktop.
    let state = app.state::<AppState>();
    state.platform.engage_shell();

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
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
