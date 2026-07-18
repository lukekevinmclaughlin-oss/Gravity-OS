//! Platform abstraction. The shell UI talks only to `ShellPlatform`;
//! the concrete backend is chosen at compile time so the whole project
//! type-checks with a mock and drives the real shell on Windows.

use crate::shell::{ShellState, WindowRule, WindowScene};

pub trait ShellPlatform: Send + Sync {
    /// Full snapshot of apps, windows and system status.
    fn snapshot(&self) -> ShellState;

    // Window control
    fn focus_window(&self, id: &str) -> Result<(), String>;
    fn minimize_window(&self, id: &str) -> Result<(), String>;
    fn toggle_maximize_window(&self, id: &str) -> Result<(), String>;
    fn close_window(&self, id: &str) -> Result<(), String>;
    fn active_window_control(&self, kind: &str) -> Result<(), String>;
    fn window_action(&self, action: &str) -> Result<(), String>;
    fn window_action_for(&self, window_id: &str, action: &str) -> Result<(), String>;
    fn apply_grid_region(
        &self,
        window_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String>;
    fn apply_grid_region_on_monitor(
        &self,
        window_id: &str,
        monitor: usize,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String>;
    fn warp_window(&self, window_id: &str, operation: &str) -> Result<(), String>;
    fn park_window(&self, window_id: &str, well_id: &str) -> Result<(), String>;
    fn release_window(&self, window_id: &str) -> Result<(), String>;
    fn release_all_parked_windows(&self) -> Result<(), String>;
    /// Minimize every unparked window, or restore the set a previous toggle
    /// hid. Returns true when the desktop was revealed.
    fn toggle_show_desktop(&self) -> Result<bool, String>;
    /// Drive the current system media session: play-pause, next, previous.
    fn media_control(&self, kind: &str) -> Result<(), String>;
    fn configure_windowing(&self, gap: u32, cycling: bool);
    fn configure_rules(&self, rules: &[WindowRule]);
    fn configure_ignored(&self, app_ids: &[String]);
    fn current_display_fingerprint(&self) -> String;
    fn capture_scene(&self, name: &str) -> Result<WindowScene, String>;
    fn restore_scene(&self, scene: &WindowScene) -> Result<(), String>;

    // Apps
    fn launch_app(&self, app_id: &str) -> Result<(), String>;
    fn launch_app_with_files(&self, app_id: &str, paths: &[String]) -> Result<(), String>;

    // System
    fn set_volume(&self, value: f32) -> Result<(), String>;
    fn set_brightness(&self, value: f32) -> Result<(), String>;
    fn toggle_setting(&self, key: &str) -> Result<(), String>;
    fn empty_trash(&self) -> Result<(), String>;

    // Spaces & notifications (managed shell-side)
    fn switch_orbit(&self, id: &str) -> Result<(), String>;
    fn move_window_to_orbit(&self, window_id: &str, orbit_id: &str) -> Result<(), String>;
    fn dismiss_notification(&self, id: &str) -> Result<(), String>;

    /// Take over the desktop: hide the Windows taskbar and reserve the work
    /// area for Horizon/Orbit. Returns immediately on non-Windows.
    fn engage_shell(&self);

    /// Hand the desktop back: restore the taskbar and work area.
    fn disengage_shell(&self);
}

#[cfg(windows)]
pub mod appindex;
#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod brightness;
#[cfg(windows)]
pub mod events;
#[cfg(windows)]
pub mod input;
#[cfg(windows)]
pub mod media;
#[cfg(windows)]
mod network;
#[cfg(windows)]
mod notifications;
#[cfg(windows)]
mod radio;
#[cfg(windows)]
pub mod shell_control;
#[cfg(windows)]
pub mod snap;
#[cfg(windows)]
mod windowing;
#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
mod mock;

#[cfg(windows)]
pub fn platform() -> Box<dyn ShellPlatform> {
    Box::new(windows::WindowsPlatform::new())
}

#[cfg(not(windows))]
pub fn platform() -> Box<dyn ShellPlatform> {
    Box::new(mock::MockPlatform::new())
}
