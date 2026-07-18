//! Application index: curated pinned builtins + a scan of the Start Menu
//! `.lnk` shortcuts, plus launch and window→app attribution.
//! `#[cfg(windows)]` only.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use windows::core::{IUnknown, IUnknown_Vtbl, Interface, BSTR, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, BOOL, FALSE, HANDLE, HWND, LPARAM, MAX_PATH, TRUE};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IPropertyStore, SHGetPropertyStoreForWindow, PROPERTYKEY,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetWindowThreadProcessId, HICON, SW_SHOWNORMAL,
};

use crate::shell::AppInfo;

/// The generated `Win32_UI_Controls` bindings statically import every
/// Common Controls entry point, including TaskDialogIndirect. Cargo test
/// executables do not carry Tauri's production Common Controls v6 manifest,
/// so that broad import prevents the test harness from starting. Gravity only
/// needs the stable IImageList::GetIcon ABI; keep that tiny COM surface local.
#[repr(transparent)]
struct ShellImageList(IUnknown);

impl Clone for ShellImageList {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

unsafe impl Interface for ShellImageList {
    type Vtable = ShellImageListVtbl;
    const IID: GUID = GUID::from_u128(0x46eb5926_582e_4017_9fdf_e8998daa0950);
}

#[repr(C)]
struct ShellImageListVtbl {
    base__: IUnknown_Vtbl,
    add: usize,
    replace_icon: usize,
    set_overlay_image: usize,
    replace: usize,
    add_masked: usize,
    draw: usize,
    remove: usize,
    get_icon: unsafe extern "system" fn(*mut c_void, i32, u32, *mut HICON) -> HRESULT,
}

/// Curated dock defaults: (name, launch command, icon source override).
/// `command` is handed to ShellExecute (exe name, URI scheme, or path).
/// UWP apps launch via URI but their icons come from `shell:AppsFolder\<AUMID>`
/// parsing names, which IShellItemImageFactory resolves to the packaged tile.
const BUILTINS: &[(&str, &str, Option<&str>)] = &[
    ("Files", "explorer.exe", None),
    ("Edge", "msedge.exe", None),
    (
        "Mail",
        "ms-mail:",
        Some(
            r"shell:AppsFolder\Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows",
        ),
    ),
    (
        "Photos",
        "ms-photos:",
        Some(r"shell:AppsFolder\Microsoft.Windows.Photos_8wekyb3d8bbwe!App"),
    ),
    (
        "Terminal",
        "wt.exe",
        Some(r"shell:AppsFolder\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"),
    ),
    (
        "Settings",
        "ms-settings:",
        Some(
            r"shell:AppsFolder\windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel",
        ),
    ),
    (
        "Calculator",
        "calc.exe",
        Some(r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"),
    ),
    (
        "Store",
        "ms-windows-store:",
        Some(r"shell:AppsFolder\Microsoft.WindowsStore_8wekyb3d8bbwe!App"),
    ),
];

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn slug(name: &str) -> String {
    name.to_lowercase().replace([' ', '_'], "-")
}

// NOTE: join with real components, not a "/"-separated string — the shell
// parsing APIs (SHCreateItemFromParsingName etc.) reject forward slashes
// even though std::fs tolerates them.
fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["ProgramData", "AppData"] {
        if let Ok(base) = std::env::var(var) {
            roots.push(
                Path::new(&base)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs"),
            );
        }
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
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("lnk"))
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
                out.push(AppInfo::new(
                    stem,
                    Some(path.to_string_lossy().into_owned()),
                    false,
                ));
            }
        }
    }
}

fn build_index() -> Vec<AppInfo> {
    let mut apps: Vec<AppInfo> = BUILTINS
        .iter()
        .map(|(name, cmd, _)| AppInfo::new(name, Some((*cmd).to_string()), true))
        .collect();
    for root in start_menu_roots() {
        scan_lnks(&root, &mut apps, 0);
    }
    scan_packaged_apps(&mut apps);
    apps
}

fn builtin_icon_hint(app_id: &str) -> Option<&'static str> {
    BUILTINS
        .iter()
        .find(|(name, _, _)| slug(name) == app_id)
        .and_then(|(_, _, hint)| *hint)
}

fn index() -> &'static Vec<AppInfo> {
    static INDEX: OnceLock<Vec<AppInfo>> = OnceLock::new();
    INDEX.get_or_init(build_index)
}

pub fn pinned_and_indexed() -> Vec<AppInfo> {
    index().clone()
}

pub fn launch(app_id: &str) -> Result<(), String> {
    let app = index()
        .iter()
        .find(|a| a.id == app_id)
        .ok_or_else(|| format!("Application '{app_id}' is no longer installed."))?;
    let cmd = app
        .exe
        .as_deref()
        .ok_or_else(|| format!("{} has no launch target.", app.name))?;
    shell_open(cmd).map_err(|error| format!("Could not open {}: {error}", app.name))
}

/// File activation from Orbit. ShellExecute forwards the validated files to
/// classic executables and Start Menu shortcuts just as Explorer's Open With
/// command does. Protocol-only apps do not expose a generic file contract, so
/// they fail visibly instead of silently launching the wrong application.
pub fn launch_with_files(app_id: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Drop at least one file onto an application.".into());
    }
    if paths.len() > 16 {
        return Err("Open at most 16 files at once.".into());
    }
    let app = index()
        .iter()
        .find(|item| item.id == app_id)
        .ok_or_else(|| format!("Application '{app_id}' is no longer installed."))?;
    let target = app
        .exe
        .as_deref()
        .ok_or_else(|| format!("{} has no launch target.", app.name))?;
    if target.contains(':') && !Path::new(target).is_absolute() {
        return Err(format!(
            "{} does not advertise support for files dropped from the desktop.",
            app.name
        ));
    }

    let mut clean = Vec::with_capacity(paths.len());
    for path in paths {
        let candidate = Path::new(path);
        if !candidate.exists() {
            return Err(format!("The dropped item no longer exists: {path}"));
        }
        clean.push(quote_windows_argument(path));
    }
    let parameters = clean.join(" ");
    let file = wide(target);
    let params = wide(&parameters);
    let op = wide("open");
    unsafe {
        let result = ShellExecuteW(
            HWND(std::ptr::null_mut()),
            PCWSTR(op.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(params.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        let code = result.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(format!(
                "Could not open the dropped files with {}: {}",
                app.name,
                shell_execute_error(code)
            ))
        }
    }
}

fn quote_windows_argument(value: &str) -> String {
    let mut output = String::from("\"");
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                output.push_str(&"\\".repeat(backslashes * 2 + 1));
                output.push('"');
                backslashes = 0;
            }
            _ => {
                output.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                output.push(character);
            }
        }
    }
    output.push_str(&"\\".repeat(backslashes * 2));
    output.push('"');
    output
}

/// ShellExecute "open" on a path, exe name or URI.
pub fn shell_open(target: &str) -> Result<(), String> {
    let file = wide(target);
    let op = wide("open");
    unsafe {
        let result = ShellExecuteW(
            HWND(std::ptr::null_mut()),
            PCWSTR(op.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        let code = result.0 as isize;
        if code > 32 {
            Ok(())
        } else {
            Err(shell_execute_error(code))
        }
    }
}

/// Add packaged/UWP applications exposed by the Windows AppsFolder. Modern
/// Store applications do not necessarily have `.lnk` files in the Start Menu.
fn scan_packaged_apps(out: &mut Vec<AppInfo>) {
    for (name, target) in apps_folder_entries().iter().cloned() {
        let low = name.to_lowercase();
        if low.contains("uninstall") || low.contains("help") {
            continue;
        }
        let base_id = slug(&name);
        if out.iter().any(|app| app.id == base_id) {
            continue;
        }
        let mut app = AppInfo::new(&name, Some(target), false);
        if out.iter().any(|existing| existing.id == app.id) {
            app.id = format!("{}-app", app.id);
        }
        out.push(app);
    }
}

fn apps_folder_entries() -> &'static Vec<(String, String)> {
    static ENTRIES: OnceLock<Vec<(String, String)>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        std::thread::spawn(enumerate_packaged_apps_sta)
            .join()
            .unwrap_or_default()
    })
}

fn enumerate_packaged_apps_sta() -> Vec<(String, String)> {
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, SHGetKnownFolderItem,
        KNOWN_FOLDER_FLAG, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_NORMALDISPLAY,
    };

    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            return Vec::new();
        }
        let result = (|| -> windows::core::Result<Vec<(String, String)>> {
            let folder: IShellItem = SHGetKnownFolderItem(
                &FOLDERID_AppsFolder,
                KNOWN_FOLDER_FLAG(0),
                HANDLE::default(),
            )?;
            let enumerator: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
            let mut result = Vec::new();
            loop {
                let mut items = [None];
                let mut fetched = 0u32;
                enumerator.Next(&mut items, Some(&mut fetched))?;
                if fetched == 0 {
                    break;
                }
                let Some(item) = items[0].take() else {
                    continue;
                };
                let name_ptr = item.GetDisplayName(SIGDN_NORMALDISPLAY)?;
                let name = name_ptr.to_string().unwrap_or_default();
                CoTaskMemFree(Some(name_ptr.0.cast()));
                let target_ptr = item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING)?;
                let target = target_ptr.to_string().unwrap_or_default();
                CoTaskMemFree(Some(target_ptr.0.cast()));
                if !name.trim().is_empty() && !target.trim().is_empty() {
                    result.push((name, target));
                }
            }
            Ok(result)
        })()
        .unwrap_or_default();
        CoUninitialize();
        result
    }
}

fn shell_execute_error(code: isize) -> String {
    match code {
        0 => "Windows could not start the application.".into(),
        2 => "The application file was not found.".into(),
        3 => "The application path was not found.".into(),
        5 => "Windows denied access to the application.".into(),
        8 => "Windows did not have enough memory to start the application.".into(),
        26 => "The application is currently locked by another process.".into(),
        27 => "The file association is incomplete or invalid.".into(),
        28 => "The application did not respond to the launch request.".into(),
        29 => "Windows could not complete the launch conversation.".into(),
        30 => "Windows is busy handling another launch request.".into(),
        31 => "No application is registered for this target.".into(),
        32 => "A required application component was not found.".into(),
        other => format!("Windows rejected the launch request (error {other})."),
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

/// Icon extraction touches IShellLink/thumbnail providers that expect a
/// single-threaded apartment; Tauri's IPC pool is MTA, so run each request
/// on a short-lived STA thread. Results are cached on the frontend.
pub fn icon_rgba(app_id: &str) -> Option<IconData> {
    let app_id = app_id.to_string();
    std::thread::spawn(move || icon_rgba_sta(&app_id))
        .join()
        .ok()
        .flatten()
}

fn icon_rgba_sta(app_id: &str) -> Option<IconData> {
    let mut sources = Vec::new();
    if let Some(hint) = builtin_icon_hint(app_id) {
        sources.push(hint.to_string());
    }
    if let Some(command) = index()
        .iter()
        .find(|app| app.id == app_id)
        .and_then(|app| app.exe.as_deref())
    {
        if let Some(source) = resolve_icon_source(command) {
            if Path::new(&source)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
            {
                sources.extend(shortcut_icon_sources(&source));
            }
            sources.push(source);
        }
    }
    // AppsFolder exposes authoritative icon parsing names for both packaged
    // apps and registered desktop shortcuts. This recovers modern apps such
    // as ChatGPT and Claude when their Start Menu .lnk has no extractable
    // bitmap or launches through an update shim.
    let wanted = app_id.strip_suffix("-app").unwrap_or(app_id);
    if let Some((_, target)) = apps_folder_entries()
        .iter()
        .find(|(name, _)| slug(name) == wanted || slug(name) == app_id)
    {
        // SIGDN_DESKTOPABSOLUTEPARSING commonly returns a bare AUMID. Shell
        // image factories require the AppsFolder parsing prefix to bind that
        // identity to the package's visual-assets manifest.
        let registered = [format!(r"shell:AppsFolder\{target}"), target.clone()];
        if target.contains('!') {
            // Packaged app: AppsFolder owns the authoritative visual assets.
            let mut preferred = registered.to_vec();
            preferred.append(&mut sources);
            sources = preferred;
        } else {
            // Registered desktop/Squirrel app: AppsFolder often returns the
            // generic window glyph. Prefer the resolved Start Menu shortcut
            // or executable, then retain AppsFolder as a fallback.
            sources.extend(registered);
        }
    }
    let mut seen = std::collections::HashSet::new();
    sources.retain(|source| seen.insert(source.clone()));
    let raw = sources
        .iter()
        .find_map(|source| extract_icon(source).or_else(|| extract_icon_imagelist(source)));
    #[cfg(test)]
    eprintln!(
        "  [sta] sources {sources:?}; raw -> {:?}",
        raw.as_ref().map(|d| (d.width, d.height))
    );
    raw.map(crop_to_content)
}

/// Map a launch command to something the shell can produce an image for:
/// `shell:` parsing names pass through, absolute paths pass through, bare
/// exe names resolve via the App Paths registry then PATH; other URI
/// schemes have no icon source.
fn resolve_icon_source(cmd: &str) -> Option<String> {
    if cmd.starts_with("shell:") {
        return Some(cmd.to_string());
    }
    let p = Path::new(cmd);
    if p.is_absolute() {
        // Shell parsing names require backslashes; std::fs doesn't care.
        return p.exists().then(|| cmd.replace('/', "\\"));
    }
    // URI scheme (contains ':' but isn't a drive path) → no icon source.
    if cmd.contains(':') {
        return None;
    }
    app_paths_lookup(cmd).or_else(|| search_path(cmd))
}

/// Resolve the explicit icon and executable behind a Start Menu shortcut.
/// Explorer can return a generic document glyph for a valid `.lnk` whose own
/// icon location is blank (notably Squirrel apps); the target executable still
/// carries the vendor's real icon resources.
fn shortcut_icon_sources(path: &str) -> Vec<String> {
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH, SLR_NO_UI};

    unsafe {
        let mut sources = shortcut_property_target(path)
            .into_iter()
            .collect::<Vec<_>>();
        let _initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        #[cfg(test)]
        eprintln!("shortcut CoInitializeEx -> {_initialized:?}");
        let link: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) {
            Ok(link) => link,
            Err(_error) => {
                #[cfg(test)]
                eprintln!("shortcut CoCreateInstance -> {_error:?}");
                return sources;
            }
        };
        let persist = match link.cast::<IPersistFile>() {
            Ok(persist) => persist,
            Err(_error) => {
                #[cfg(test)]
                eprintln!("shortcut IPersistFile cast -> {_error:?}");
                return sources;
            }
        };
        let shortcut = wide(path);
        if let Err(_error) = persist.Load(PCWSTR(shortcut.as_ptr()), STGM_READ) {
            #[cfg(test)]
            eprintln!("shortcut Load({path}) -> {_error:?}");
            return sources;
        }

        let read = |buffer: &[u16]| {
            let length = buffer
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(buffer.len());
            (length > 0).then(|| String::from_utf16_lossy(&buffer[..length]))
        };
        let mut icon_path = vec![0u16; MAX_PATH as usize];
        let mut icon_index = 0i32;
        if link
            .GetIconLocation(&mut icon_path, &mut icon_index)
            .is_ok()
        {
            if let Some(icon) = read(&icon_path).filter(|value| Path::new(value).exists()) {
                sources.push(icon);
            }
        }

        let mut target = vec![0u16; MAX_PATH as usize];
        let mut find_data = WIN32_FIND_DATAW::default();
        let _ = link.Resolve(HWND::default(), SLR_NO_UI.0 as u32);
        let get_path = link.GetPath(&mut target, &mut find_data, SLGP_RAWPATH.0 as u32);
        #[cfg(test)]
        eprintln!("shortcut GetPath -> {get_path:?}");
        if get_path.is_ok() {
            if let Some(target) = read(&target).filter(|value| Path::new(value).exists()) {
                sources.push(target);
            }
        }
        sources
    }
}

const PKEY_LINK_TARGET_PARSING_PATH: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25),
    pid: 2,
};

fn shortcut_property_target(path: &str) -> Option<String> {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::PropertiesSystem::{
        SHGetPropertyStoreFromParsingName, GPS_DEFAULT,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let path = wide(path);
        let store: IPropertyStore =
            SHGetPropertyStoreFromParsingName(PCWSTR(path.as_ptr()), None, GPS_DEFAULT).ok()?;
        let value = store.GetValue(&PKEY_LINK_TARGET_PARSING_PATH).ok()?;
        let target = BSTR::try_from(&value).ok()?.to_string();
        (!target.is_empty() && Path::new(&target).exists()).then_some(target)
    }
}

/// Trim transparent margins (with a small pad) so 48px icons returned
/// inside a 256px jumbo canvas don't render as a tiny glyph in a corner.
fn crop_to_content(data: IconData) -> IconData {
    let (w, h) = (data.width as usize, data.height as usize);
    let (mut minx, mut miny, mut maxx, mut maxy) = (w, h, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if data.rgba[(y * w + x) * 4 + 3] > 8 {
                minx = minx.min(x);
                miny = miny.min(y);
                maxx = maxx.max(x);
                maxy = maxy.max(y);
            }
        }
    }
    if minx > maxx || (minx == 0 && miny == 0 && maxx == w - 1 && maxy == h - 1) {
        return data; // empty or already full-bleed
    }
    // Keep the crop square and padded so plating stays centred.
    let side = (maxx - minx + 1).max(maxy - miny + 1);
    let pad = (side / 16).max(1);
    let side = (side + pad * 2).min(w.min(h));
    let cx = (minx + maxx).div_ceil(2);
    let cy = (miny + maxy).div_ceil(2);
    let x0 = cx.saturating_sub(side / 2).min(w - side);
    let y0 = cy.saturating_sub(side / 2).min(h - side);
    let mut out = vec![0u8; side * side * 4];
    for y in 0..side {
        let src = ((y0 + y) * w + x0) * 4;
        out[y * side * 4..(y + 1) * side * 4].copy_from_slice(&data.rgba[src..src + side * 4]);
    }
    IconData {
        width: side as u32,
        height: side as u32,
        rgba: out,
    }
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
    (len > 0 && (len as usize) < buf.len()).then(|| String::from_utf16_lossy(&buf[..len as usize]))
}

fn extract_icon(path: &str) -> Option<IconData> {
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let wpath = wide(path);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wpath.as_ptr()), None).ok()?;
        let hbmp = factory
            .GetImage(
                SIZE { cx: 128, cy: 128 },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
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

const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
    pid: 5,
};

fn property_aumid(hwnd: HWND) -> Option<String> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        let value = store.GetValue(&PKEY_APP_USER_MODEL_ID).ok()?;
        let text = BSTR::try_from(&value).ok()?.to_string();
        (!text.is_empty()).then_some(text)
    }
}

unsafe extern "system" fn collect_child(hwnd: HWND, data: LPARAM) -> BOOL {
    (*(data.0 as *mut Vec<HWND>)).push(hwnd);
    TRUE
}

fn window_aumid(hwnd: HWND) -> Option<String> {
    if let Some(aumid) = property_aumid(hwnd) {
        return Some(aumid);
    }
    let mut children = Vec::new();
    unsafe {
        let _ = EnumChildWindows(
            hwnd,
            Some(collect_child),
            LPARAM(&mut children as *mut _ as isize),
        );
    }
    children.into_iter().find_map(property_aumid)
}

fn catalog_id_for_aumid(aumid: &str) -> Option<String> {
    let aumid = aumid.to_lowercase();
    index().iter().find_map(|app| {
        let launch_match = app
            .exe
            .as_deref()
            .is_some_and(|target| target.to_lowercase().contains(&aumid));
        let hint_match =
            builtin_icon_hint(&app.id).is_some_and(|target| target.to_lowercase().contains(&aumid));
        (launch_match || hint_match).then(|| app.id.clone())
    })
}

fn catalog_id_for_title(title: &str) -> Option<String> {
    let title = title.trim();
    index()
        .iter()
        .find(|app| app.name.eq_ignore_ascii_case(title) || app.id == slug(title))
        .map(|app| app.id.clone())
}

/// Attribute a top-level window to the same stable catalog id that launches
/// it. Packaged apps are keyed by AppUserModelID because their visible frame
/// often belongs to the generic ApplicationFrameHost process.
pub fn app_id_for_window(hwnd: HWND, title: &str) -> String {
    if let Some(app_id) = window_aumid(hwnd).and_then(|aumid| catalog_id_for_aumid(&aumid)) {
        return app_id;
    }
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
        if let Some(app_id) = catalog_id_for_title(title) {
            return app_id;
        }
        if !stem.is_empty() {
            return slug(&stem);
        }
    }
    let title = title.split('—').next_back().unwrap_or(title).trim();
    catalog_id_for_title(title).unwrap_or_else(|| slug(title))
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

/// Fallback for sources IShellItemImageFactory rejects: classic shell icon
/// via the system image list (jumbo tier), rendered into a 32bpp DIB.
fn extract_icon_imagelist(path: &str) -> Option<IconData> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX, SHIL_JUMBO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};

    const SIDE: i32 = 256;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let wpath = wide(path);
        let mut sfi = SHFILEINFOW::default();
        let ok = SHGetFileInfoW(
            PCWSTR(wpath.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut sfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX,
        );
        if ok == 0 {
            return None;
        }
        let list: ShellImageList = SHGetImageList(SHIL_JUMBO as i32).ok()?;
        let mut hicon = HICON::default();
        (list.vtable().get_icon)(list.as_raw(), sfi.iIcon, 1, &mut hicon)
            .ok()
            .ok()?;
        if hicon.is_invalid() {
            return None;
        }

        let hdc = CreateCompatibleDC(None);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIDE,
                biHeight: -SIDE, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(hdc, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok();
        let result = dib.and_then(|dib| {
            let old = SelectObject(hdc, dib);
            let drew = DrawIconEx(hdc, 0, 0, hicon, SIDE, SIDE, 0, None, DI_NORMAL).is_ok();
            let out = drew.then(|| {
                let n = (SIDE * SIDE * 4) as usize;
                let mut buf = vec![0u8; n];
                std::ptr::copy_nonoverlapping(bits as *const u8, buf.as_mut_ptr(), n);
                for px in buf.chunks_exact_mut(4) {
                    px.swap(0, 2); // BGRA → RGBA
                }
                IconData {
                    width: SIDE as u32,
                    height: SIDE as u32,
                    rgba: buf,
                }
            });
            SelectObject(hdc, old);
            let _ = DeleteObject(dib);
            out
        });
        let _ = DeleteDC(hdc);
        let _ = DestroyIcon(hicon);
        result
    }
}

// Silence unused import warning on some toolchains.
#[allow(dead_code)]
const _C_VOID: usize = std::mem::size_of::<*mut c_void>();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_file_activation_arguments_for_windows() {
        assert_eq!(
            quote_windows_argument(r"C:\Gravity Files\note.txt"),
            r#""C:\Gravity Files\note.txt""#
        );
        assert_eq!(
            quote_windows_argument(r#"C:\Work\say "hi".txt"#),
            r#""C:\Work\say \"hi\".txt""#
        );
    }

    #[test]
    #[ignore = "requires Google Chrome at the default Start Menu path"]
    fn probe_lnk_icon_pipeline() {
        let lnk = r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk";
        assert!(
            Path::new(lnk).exists(),
            "chrome lnk missing on this machine"
        );
        let src = resolve_icon_source(lnk);
        eprintln!("resolve_icon_source -> {src:?}");
        let src = src.expect("source should resolve");
        let a = extract_icon(&src);
        eprintln!(
            "extract_icon -> {:?}",
            a.as_ref().map(|d| (d.width, d.height, d.rgba.len()))
        );
        let b = extract_icon_imagelist(&src);
        eprintln!(
            "extract_icon_imagelist -> {:?}",
            b.as_ref().map(|d| (d.width, d.height, d.rgba.len()))
        );
        let full = icon_rgba("google-chrome");
        eprintln!(
            "icon_rgba(google-chrome) -> {:?}",
            full.as_ref().map(|d| (d.width, d.height))
        );
        assert!(full.is_some(), "end-to-end icon extraction failed");
    }

    #[test]
    #[ignore = "requires ChatGPT and Claude to be installed"]
    fn probe_registered_modern_app_icons() {
        let claude_link = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(r"Microsoft\Windows\Start Menu\Programs\Claude.lnk");
        let claude_sources = shortcut_icon_sources(&claude_link.to_string_lossy());
        eprintln!("Claude shortcut sources -> {claude_sources:?}");
        assert!(
            claude_sources.iter().any(|source| source
                .to_ascii_lowercase()
                .ends_with(r"anthropicclaude\claude.exe")),
            "Claude shortcut target was not resolved"
        );
        for app_id in ["chatgpt", "claude"] {
            let icon = icon_rgba(app_id);
            eprintln!(
                "icon_rgba({app_id}) -> {:?}",
                icon.as_ref().map(|data| (data.width, data.height))
            );
            assert!(icon.is_some(), "{app_id} icon extraction failed");
        }
    }
}
