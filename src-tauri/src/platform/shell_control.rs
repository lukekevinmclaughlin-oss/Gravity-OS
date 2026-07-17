//! Desktop takeover primitives. Two levels:
//!
//!  * Overlay mode (default, safe, reversible at runtime): hide the taskbar
//!    and register native AppBars so classic apps respect Horizon and Orbit.
//!  * Full shell replacement (opt-in): set Gravity as the per-user Winlogon
//!    shell so it launches instead of the Windows desktop. Reversible by the
//!    uninstaller or `restore_default_shell()`.
//!
//! `#[cfg(windows)]` only.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE, WPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_GETSTATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE,
    ABM_SETPOS, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, SendMessageTimeoutW, SetParent, SetWindowPos,
    ShowWindow, HWND_TOPMOST, SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_HIDE, SW_SHOW,
};

static APP_BARS: OnceLock<Mutex<Vec<isize>>> = OnceLock::new();
static EXPLORER_APPBAR_STATE: OnceLock<Mutex<Option<isize>>> = OnceLock::new();
static TASKBAR_GUARD_ACTIVE: AtomicBool = AtomicBool::new(false);
static TASKBAR_GUARD_STARTED: OnceLock<()> = OnceLock::new();
static TASKBAR_VISIBILITY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum AppBarEdge {
    Top,
    Bottom,
}

fn app_bars() -> &'static Mutex<Vec<isize>> {
    APP_BARS.get_or_init(|| Mutex::new(Vec::new()))
}

fn explorer_appbar_state() -> &'static Mutex<Option<isize>> {
    EXPLORER_APPBAR_STATE.get_or_init(|| Mutex::new(None))
}

fn taskbar_visibility_lock() -> &'static Mutex<()> {
    TASKBAR_VISIBILITY_LOCK.get_or_init(|| Mutex::new(()))
}

/// Register a Gravity strip with Explorer's native AppBar protocol. This is
/// what makes maximized foreign applications respect the shell on every
/// monitor, including mixed-DPI and negative-coordinate arrangements.
pub fn register_app_bar(
    raw_hwnd: isize,
    edge: AppBarEdge,
    monitor_rect: RECT,
    thickness: i32,
) {
    let mut registered = app_bars().lock().expect("app bar lock");
    if registered.contains(&raw_hwnd) {
        return;
    }
    let hwnd = HWND(raw_hwnd as *mut c_void);
    let edge_value = match edge {
        AppBarEdge::Top => ABE_TOP,
        AppBarEdge::Bottom => ABE_BOTTOM,
    };
    let mut data = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: 0,
        uEdge: edge_value,
        rc: monitor_rect,
        lParam: LPARAM(0),
    };
    unsafe {
        SHAppBarMessage(ABM_NEW, &mut data);
        SHAppBarMessage(ABM_QUERYPOS, &mut data);
        match edge {
            AppBarEdge::Top => data.rc.bottom = data.rc.top + thickness,
            AppBarEdge::Bottom => data.rc.top = data.rc.bottom - thickness,
        }
        SHAppBarMessage(ABM_SETPOS, &mut data);
        // Horizon is a full-width strip. Orbit intentionally remains a
        // compact centered window so its transparent margins cannot steal
        // clicks from applications; its AppBar reservation is independent.
        if matches!(edge, AppBarEdge::Top) {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                data.rc.left,
                data.rc.top,
                data.rc.right - data.rc.left,
                data.rc.bottom - data.rc.top,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
    }
    registered.push(raw_hwnd);
}

fn unregister_app_bars() {
    let mut registered = app_bars().lock().expect("app bar lock");
    for raw in registered.drain(..) {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: HWND(raw as *mut c_void),
            ..Default::default()
        };
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &mut data);
        }
    }
}

/// Resize and center Orbit using native physical monitor coordinates. WebView2
/// can expose a work-area-relative monitor origin while an AppBar transition
/// is in flight; querying the HWND avoids that mixed-DPI offset entirely.
pub fn fit_orbit_window(raw_hwnd: isize, app_count: u32) {
    let hwnd = HWND(raw_hwnd as *mut c_void);
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return;
        }
        let mut window_rect = RECT::default();
        if windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut window_rect)
            .is_err()
        {
            return;
        }
        let dpi = GetDpiForWindow(hwnd).max(96);
        let monitor_width = info.rcMonitor.right - info.rcMonitor.left;
        let logical_monitor_width = monitor_width as f64 * 96.0 / dpi as f64;
        let logical_width = (92.0 + (app_count + 3) as f64 * 52.0 + 260.0)
            .min(logical_monitor_width);
        let width = (logical_width * dpi as f64 / 96.0).ceil() as i32;
        let height = window_rect.bottom - window_rect.top;
        let x = info.rcMonitor.left + (monitor_width - width) / 2;
        let y = info.rcMonitor.bottom - height;
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn find_desktop_worker(top_level: HWND, data: LPARAM) -> BOOL {
    let shell_view_class = wide("SHELLDLL_DefView");
    let shell_view = FindWindowExW(
        top_level,
        HWND(std::ptr::null_mut()),
        PCWSTR(shell_view_class.as_ptr()),
        PCWSTR::null(),
    )
    .ok();
    if shell_view.is_some_and(|window| !window.0.is_null()) {
        let worker_class = wide("WorkerW");
        if let Ok(worker) = FindWindowExW(
            HWND(std::ptr::null_mut()),
            top_level,
            PCWSTR(worker_class.as_ptr()),
            PCWSTR::null(),
        ) {
            if !worker.0.is_null() {
                *(data.0 as *mut isize) = worker.0 as isize;
                return BOOL(0);
            }
        }
    }
    TRUE
}

/// Place the animated desktop inside Explorer's WorkerW hierarchy. App
/// windows and desktop icons then naturally layer above it, while the shell
/// background remains absent from Alt+Tab and task switching.
pub fn attach_to_desktop(raw_hwnd: isize) {
    unsafe {
        let progman_class = wide("Progman");
        let Ok(progman) = FindWindowW(PCWSTR(progman_class.as_ptr()), PCWSTR::null()) else {
            return;
        };
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            WPARAM(0xD),
            LPARAM(1),
            SMTO_NORMAL,
            1000,
            None,
        );
        let mut worker = 0isize;
        let _ = EnumWindows(
            Some(find_desktop_worker),
            LPARAM(&mut worker as *mut _ as isize),
        );
        let parent = if worker != 0 {
            HWND(worker as *mut c_void)
        } else {
            progman
        };
        let _ = SetParent(HWND(raw_hwnd as *mut c_void), parent);
    }
}

fn taskbar_windows() -> Vec<Vec<u16>> {
    ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"]
        .iter()
        .map(|c| wide(c))
        .collect()
}

fn set_taskbar_visible(visible: bool) {
    let _guard = taskbar_visibility_lock()
        .lock()
        .expect("taskbar visibility lock");
    if !visible && !TASKBAR_GUARD_ACTIVE.load(Ordering::Acquire) {
        return;
    }
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

fn start_taskbar_guard() {
    TASKBAR_GUARD_STARTED.get_or_init(|| {
        std::thread::spawn(|| loop {
            if TASKBAR_GUARD_ACTIVE.load(Ordering::Acquire) {
                // Explorer can re-show its auto-hidden taskbar when the
                // pointer reaches Orbit. Re-hide it within one frame so the
                // native taskbar can never intercept dock input.
                set_taskbar_visible(false);
                std::thread::sleep(std::time::Duration::from_millis(16));
            } else {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    });
}

pub fn hide_taskbar() {
    let mut previous = explorer_appbar_state()
        .lock()
        .expect("Explorer AppBar state lock");
    if previous.is_none() {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            ..Default::default()
        };
        let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as isize;
        *previous = Some(state);
        data.lParam = LPARAM((state as u32 | ABS_AUTOHIDE) as isize);
        unsafe {
            SHAppBarMessage(ABM_SETSTATE, &mut data);
        }
    }
    TASKBAR_GUARD_ACTIVE.store(true, Ordering::Release);
    start_taskbar_guard();
    set_taskbar_visible(false);
}

pub fn restore_taskbar() {
    TASKBAR_GUARD_ACTIVE.store(false, Ordering::Release);
    unregister_app_bars();
    if let Some(state) = explorer_appbar_state()
        .lock()
        .expect("Explorer AppBar state lock")
        .take()
    {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            lParam: LPARAM(state),
            ..Default::default()
        };
        unsafe {
            SHAppBarMessage(ABM_SETSTATE, &mut data);
        }
    }
    set_taskbar_visible(true);
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
