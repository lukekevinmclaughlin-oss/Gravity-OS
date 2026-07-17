//! Platform abstraction. The shell UI talks only to `ShellPlatform`;
//! the concrete backend is chosen at compile time so the whole project
//! type-checks on macOS (mock) and drives the real shell on Windows.

use crate::shell::ShellState;

pub trait ShellPlatform: Send + Sync {
    /// Full snapshot of apps, windows and system status.
    fn snapshot(&self) -> ShellState;

    // Window control
    fn focus_window(&self, id: &str);
    fn minimize_window(&self, id: &str);
    fn close_window(&self, id: &str);

    // Apps
    fn launch_app(&self, app_id: &str);

    // System
    fn set_volume(&self, value: f32);
    fn set_brightness(&self, value: f32);
    fn toggle_setting(&self, key: &str);
    fn empty_trash(&self);

    // Spaces & notifications (managed shell-side)
    fn switch_orbit(&self, id: &str);
    fn dismiss_notification(&self, id: &str);

    /// Take over the desktop: hide the Windows taskbar and reserve the work
    /// area for Horizon/Orbit. Returns immediately on non-Windows.
    fn engage_shell(&self);

    /// Hand the desktop back: restore the taskbar and work area.
    fn disengage_shell(&self);
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod appindex;
#[cfg(windows)]
mod audio;
#[cfg(windows)]
pub mod shell_control;

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
