//! Windows 11 backend. Drives real top-level windows, power, and the
//! recycle bin, and hands the taskbar over to Gravity.
//!
//! NOTE: this module is `#[cfg(windows)]`, so it is not compiled during
//! macOS development. It must be built on a Windows host (see README).

#![allow(clippy::missing_safety_doc)]

use parking_lot::Mutex;
use std::ffi::c_void;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE, WPARAM};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::Shell::{
    SHEmptyRecycleBinW, SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI,
    SHERB_NOSOUND, SHQUERYRBINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow, ShowWindow, GWL_EXSTYLE,
    SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WS_EX_TOOLWINDOW,
};

use super::{audio, shell_control, appindex, ShellPlatform};
use crate::shell::{OrbitSpace, PulseNote, ShellState, SystemStatus, WindowInfo};

fn hwnd_to_id(hwnd: HWND) -> String {
    (hwnd.0 as isize).to_string()
}
fn id_to_hwnd(id: &str) -> Option<HWND> {
    id.parse::<isize>().ok().map(|v| HWND(v as *mut c_void))
}

/// Shell-side state that has no OS source of truth: virtual-desktop mapping,
/// notifications, and cosmetic radio toggles.
struct Internal {
    orbits: Vec<OrbitSpace>,
    active_orbit: String,
    notifications: Vec<PulseNote>,
    focus: bool,
    wifi_on: bool,
    bluetooth_on: bool,
}

pub struct WindowsPlatform {
    inner: Mutex<Internal>,
}

impl WindowsPlatform {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Internal {
                orbits: vec![
                    OrbitSpace { id: "o1".into(), name: "Orbit 1".into() },
                    OrbitSpace { id: "o2".into(), name: "Orbit 2".into() },
                    OrbitSpace { id: "o3".into(), name: "Orbit 3".into() },
                ],
                active_orbit: "o1".into(),
                notifications: Vec::new(),
                focus: false,
                wifi_on: true,
                bluetooth_on: true,
            }),
        }
    }
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<WindowInfo>);

    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }
    // Skip tool windows (tray helpers, tooltips).
    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex & WS_EX_TOOLWINDOW.0 != 0 {
        return TRUE;
    }
    let len = GetWindowTextLengthW(hwnd);
    if len == 0 {
        return TRUE;
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let read = GetWindowTextW(hwnd, &mut buf);
    if read == 0 {
        return TRUE;
    }
    let title = String::from_utf16_lossy(&buf[..read as usize]);
    if title == "Program Manager" {
        return TRUE;
    }

    let foreground = GetForegroundWindow();
    out.push(WindowInfo {
        id: hwnd_to_id(hwnd),
        app_id: appindex::app_id_for_window(hwnd, &title),
        title,
        minimized: IsIconic(hwnd).as_bool(),
        focused: hwnd == foreground,
        orbit_id: "o1".into(),
    });
    TRUE
}

fn live_windows(active_orbit: &str) -> Vec<WindowInfo> {
    let mut out: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut out as *mut _ as isize));
    }
    // All real windows live on the active orbit until virtual-desktop
    // integration lands (roadmap).
    for w in &mut out {
        w.orbit_id = active_orbit.to_string();
    }
    out
}

fn power_status(base: &mut SystemStatus) {
    unsafe {
        let mut sps = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut sps).is_ok() {
            base.charging = sps.ACLineStatus == 1;
            base.battery_percent = if sps.BatteryLifePercent == 255 {
                None
            } else {
                Some(sps.BatteryLifePercent as u32)
            };
        }
    }
}

fn recycle_bin_full() -> bool {
    unsafe {
        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            i64Size: 0,
            i64NumItems: 0,
        };
        if SHQueryRecycleBinW(PCWSTR::null(), &mut info).is_ok() {
            info.i64NumItems > 0
        } else {
            false
        }
    }
}

impl ShellPlatform for WindowsPlatform {
    fn snapshot(&self) -> ShellState {
        let inner = self.inner.lock();
        let mut status = SystemStatus {
            online: inner.wifi_on,
            network: if inner.wifi_on { Some("Network".into()) } else { None },
            volume: audio::get_volume().unwrap_or(0.5),
            brightness: None, // desktop displays: roadmap (WMI/DDC-CI)
            focus: inner.focus,
            bluetooth: inner.bluetooth_on,
            trash_full: recycle_bin_full(),
            ..Default::default()
        };
        power_status(&mut status);

        ShellState {
            apps: appindex::pinned_and_indexed(),
            windows: live_windows(&inner.active_orbit),
            status,
            orbits: inner.orbits.clone(),
            active_orbit: inner.active_orbit.clone(),
            notifications: inner.notifications.clone(),
        }
    }

    fn focus_window(&self, id: &str) {
        if let Some(hwnd) = id_to_hwnd(id) {
            unsafe {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }

    fn minimize_window(&self, id: &str) {
        if let Some(hwnd) = id_to_hwnd(id) {
            unsafe {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            }
        }
    }

    fn close_window(&self, id: &str) {
        if let Some(hwnd) = id_to_hwnd(id) {
            unsafe {
                let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
    }

    fn launch_app(&self, app_id: &str) {
        appindex::launch(app_id);
    }

    fn set_volume(&self, value: f32) {
        audio::set_volume(value.clamp(0.0, 1.0));
    }

    fn set_brightness(&self, _value: f32) {
        // Roadmap: WMI (laptop panels) / DDC-CI (external monitors).
    }

    fn toggle_setting(&self, key: &str) {
        let mut inner = self.inner.lock();
        match key {
            "wifi" => inner.wifi_on = !inner.wifi_on,
            "bluetooth" => inner.bluetooth_on = !inner.bluetooth_on,
            "focus" => inner.focus = !inner.focus,
            _ => {}
        }
    }

    fn empty_trash(&self) {
        unsafe {
            let _ = SHEmptyRecycleBinW(
                HWND(std::ptr::null_mut()),
                PCWSTR::null(),
                SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
            );
        }
    }

    fn switch_orbit(&self, id: &str) {
        self.inner.lock().active_orbit = id.to_string();
    }

    fn dismiss_notification(&self, id: &str) {
        self.inner.lock().notifications.retain(|n| n.id != id);
    }

    fn engage_shell(&self) {
        shell_control::hide_taskbar();
        shell_control::reserve_work_area();
    }

    fn disengage_shell(&self) {
        shell_control::restore_taskbar();
    }
}
