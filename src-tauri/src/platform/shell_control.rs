//! Desktop takeover primitives. Two levels:
//!
//!  * Overlay mode (default, safe, reversible at runtime): hide the taskbar
//!    and reserve the work area so classic apps don't sit under Horizon/Orbit.
//!  * Full shell replacement (opt-in): set Gravity as the per-user Winlogon
//!    shell so it launches instead of the Windows desktop. Reversible by the
//!    uninstaller or `restore_default_shell()`.
//!
//! `#[cfg(windows)]` only.

use std::ffi::c_void;

use windows::core::PCWSTR;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::HiDpi::GetDpiForSystem;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetSystemMetrics, ShowWindow, SystemParametersInfoW, SM_CXSCREEN, SM_CYSCREEN,
    SPIF_SENDCHANGE, SPI_SETWORKAREA, SW_HIDE, SW_SHOW,
};

/// Logical (96-dpi) strip reserves; scaled by the system DPI at call time.
/// Horizon reserves its bar height; Orbit reserves the *unmagnified* shelf —
/// magnified tiles may transiently overlap content, as on macOS.
const HORIZON_LOGICAL: i32 = 30;
const ORBIT_LOGICAL: i32 = 88;

fn scaled(logical: i32) -> i32 {
    let dpi = unsafe { GetDpiForSystem() } as i32;
    logical * dpi.max(96) / 96
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn taskbar_windows() -> Vec<Vec<u16>> {
    ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"]
        .iter()
        .map(|c| wide(c))
        .collect()
}

fn set_taskbar_visible(visible: bool) {
    let cmd = if visible { SW_SHOW } else { SW_HIDE };
    for class in taskbar_windows() {
        unsafe {
            if let Ok(hwnd) = FindWindowW(PCWSTR(class.as_ptr()), PCWSTR::null()) {
                if !hwnd.0.is_null() {
                    let _ = ShowWindow(hwnd, cmd);
                }
            }
        }
    }
}

pub fn hide_taskbar() {
    set_taskbar_visible(false);
}

pub fn restore_taskbar() {
    set_taskbar_visible(true);
    reset_work_area();
}

/// Shrink the desktop work area so maximized apps leave room for Gravity.
pub fn reserve_work_area() {
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        let mut rect = RECT {
            left: 0,
            top: scaled(HORIZON_LOGICAL),
            right: w,
            bottom: h - scaled(ORBIT_LOGICAL),
        };
        // SPIF_SENDCHANGE so already-maximized windows re-fit the new area.
        let _ = SystemParametersInfoW(
            SPI_SETWORKAREA,
            0,
            Some(&mut rect as *mut _ as *mut c_void),
            SPIF_SENDCHANGE,
        );
    }
}

fn reset_work_area() {
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        let mut rect = RECT { left: 0, top: 0, right: w, bottom: h };
        let _ = SystemParametersInfoW(
            SPI_SETWORKAREA,
            0,
            Some(&mut rect as *mut _ as *mut c_void),
            SPIF_SENDCHANGE,
        );
    }
}

const WINLOGON: &str = r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon";

/// Make Gravity the per-user shell. Takes effect at next sign-in.
pub fn set_as_shell(exe_path: &str) -> std::io::Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey_with_flags(WINLOGON, KEY_SET_VALUE)?;
    key.set_value("Shell", &exe_path)?;
    Ok(())
}

/// Restore the default Windows shell (delete the per-user override so the
/// machine default `explorer.exe` applies again).
pub fn restore_default_shell() -> std::io::Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(WINLOGON, KEY_SET_VALUE) {
        // Ignore "not found": absence already means default shell.
        let _ = key.delete_value("Shell");
    }
    Ok(())
}

pub fn is_shell_replaced() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(WINLOGON)
        .and_then(|k| k.get_value::<String, _>("Shell"))
        .map(|s| s.to_lowercase().contains("gravity"))
        .unwrap_or(false)
}
