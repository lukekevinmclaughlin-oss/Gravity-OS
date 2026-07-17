//! Application index: curated pinned builtins + a scan of the Start Menu
//! `.lnk` shortcuts, plus launch and window→app attribution.
//! `#[cfg(windows)]` only.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, FALSE, HWND, MAX_PATH};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, SW_SHOWNORMAL};

use crate::shell::AppInfo;

/// Curated dock defaults. `command` is handed to ShellExecute (exe name,
/// URI scheme, or path). These are always pinned and always present.
const BUILTINS: &[(&str, &str)] = &[
    ("Files", "explorer.exe"),
    ("Edge", "msedge.exe"),
    ("Mail", "ms-mail:"),
    ("Photos", "ms-photos:"),
    ("Terminal", "wt.exe"),
    ("Settings", "ms-settings:"),
    ("Calculator", "calc.exe"),
    ("Store", "ms-windows-store:"),
];

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn slug(name: &str) -> String {
    name.to_lowercase().replace([' ', '_'], "-")
}

fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(pd) = std::env::var("ProgramData") {
        roots.push(
            Path::new(&pd)
                .join("Microsoft/Windows/Start Menu/Programs"),
        );
    }
    if let Ok(ad) = std::env::var("AppData") {
        roots.push(
            Path::new(&ad)
                .join("Microsoft/Windows/Start Menu/Programs"),
        );
    }
    roots
}

fn scan_lnks(dir: &Path, out: &mut Vec<AppInfo>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_lnks(&path, out, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("lnk"))
            == Some(true)
        {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                // Skip uninstallers and noise.
                let low = stem.to_lowercase();
                if low.contains("uninstall") || low.contains("readme") {
                    continue;
                }
                let id = slug(stem);
                if out.iter().any(|a| a.id == id) {
                    continue;
                }
                out.push(AppInfo::new(stem, Some(path.to_string_lossy().into_owned()), false));
            }
        }
    }
}

fn build_index() -> Vec<AppInfo> {
    let mut apps: Vec<AppInfo> = BUILTINS
        .iter()
        .map(|(name, cmd)| AppInfo::new(name, Some((*cmd).to_string()), true))
        .collect();
    for root in start_menu_roots() {
        scan_lnks(&root, &mut apps, 0);
    }
    apps
}

fn index() -> &'static Vec<AppInfo> {
    static INDEX: OnceLock<Vec<AppInfo>> = OnceLock::new();
    INDEX.get_or_init(build_index)
}

pub fn pinned_and_indexed() -> Vec<AppInfo> {
    index().clone()
}

pub fn launch(app_id: &str) {
    let Some(app) = index().iter().find(|a| a.id == app_id) else {
        return;
    };
    let Some(cmd) = &app.exe else { return };
    let file = wide(cmd);
    let op = wide("open");
    unsafe {
        ShellExecuteW(
            HWND(std::ptr::null_mut()),
            PCWSTR(op.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// Attribute a top-level window to an app id via its process image name,
/// falling back to a slug of the window title.
pub fn app_id_for_window(hwnd: HWND, title: &str) -> String {
    if let Some(exe) = process_exe(hwnd) {
        // "msedge.exe" -> "edge" where a builtin matches, else the stem.
        let stem = Path::new(&exe)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if let Some(app) = index().iter().find(|a| {
            a.exe
                .as_deref()
                .map(|c| c.to_lowercase().contains(&stem) && !stem.is_empty())
                .unwrap_or(false)
        }) {
            return app.id.clone();
        }
        if !stem.is_empty() {
            return slug(&stem);
        }
    }
    slug(title.split('—').next_back().unwrap_or(title).trim())
}

fn process_exe(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid).ok()?;
        let mut buf = vec![0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        if ok.is_ok() && len > 0 {
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        } else {
            None
        }
    }
}

// Silence unused import warning on some toolchains.
#[allow(dead_code)]
const _C_VOID: usize = std::mem::size_of::<*mut c_void>();
