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
    shell_open(cmd);
}

/// ShellExecute "open" on a path, exe name or URI.
pub fn shell_open(target: &str) {
    let file = wide(target);
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

// ---- Real app icons (spec §4) ------------------------------------------
// The shell image factory resolves the correct icon for .lnk and .exe alike;
// we hand the frontend a raw RGBA bitmap and it composes the squircle plate.

pub struct IconData {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn icon_rgba(app_id: &str) -> Option<IconData> {
    let app = index().iter().find(|a| a.id == app_id)?;
    let cmd = app.exe.as_deref()?;
    let path = resolve_icon_source(cmd)?;
    extract_icon(&path)
}

/// Map a launch command to a filesystem path we can ask the shell to
/// thumbnail: absolute paths pass through, bare exe names resolve via the
/// App Paths registry then PATH; URI schemes have no file icon.
fn resolve_icon_source(cmd: &str) -> Option<String> {
    let p = Path::new(cmd);
    if p.is_absolute() {
        return p.exists().then(|| cmd.to_string());
    }
    // URI scheme (contains ':' but isn't a drive path) → no icon source.
    if cmd.contains(':') {
        return None;
    }
    app_paths_lookup(cmd).or_else(|| search_path(cmd))
}

fn app_paths_lookup(exe: &str) -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(format!(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
        ))
        .ok()?;
    let path: String = key.get_value("").ok()?;
    let path = path.trim_matches('"').to_string();
    Path::new(&path).exists().then_some(path)
}

fn search_path(exe: &str) -> Option<String> {
    use windows::Win32::Storage::FileSystem::SearchPathW;
    let name = wide(exe);
    let mut buf = vec![0u16; 512];
    let len = unsafe {
        SearchPathW(
            PCWSTR::null(),
            PCWSTR(name.as_ptr()),
            PCWSTR::null(),
            Some(&mut buf),
            None,
        )
    };
    (len > 0 && (len as usize) < buf.len())
        .then(|| String::from_utf16_lossy(&buf[..len as usize]))
}

fn extract_icon(path: &str) -> Option<IconData> {
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
        SIIGBF_ICONONLY,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let wpath = wide(path);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wpath.as_ptr()), None).ok()?;
        let hbmp = factory
            .GetImage(SIZE { cx: 128, cy: 128 }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
            .ok()?;

        let mut bm = BITMAP::default();
        let got = GetObjectW(
            hbmp,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut c_void),
        );
        if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
            let _ = DeleteObject(hbmp);
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(HWND(std::ptr::null_mut()));
        let lines = GetDIBits(
            hdc,
            hbmp,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        );
        ReleaseDC(HWND(std::ptr::null_mut()), hdc);
        let _ = DeleteObject(hbmp);
        if lines == 0 {
            return None;
        }

        // BGRA (premultiplied) → straight RGBA for canvas putImageData.
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
            let a = px[3] as u32;
            if a > 0 && a < 255 {
                px[0] = ((px[0] as u32 * 255) / a).min(255) as u8;
                px[1] = ((px[1] as u32 * 255) / a).min(255) as u8;
                px[2] = ((px[2] as u32 * 255) / a).min(255) as u8;
            }
        }

        Some(IconData {
            width: w as u32,
            height: h as u32,
            rgba: buf,
        })
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
