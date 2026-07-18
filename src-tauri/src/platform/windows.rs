//! Windows 11 backend. Drives real top-level windows, power, and the
//! recycle bin, and hands the taskbar over to Gravity.
//!
//! NOTE: this module is `#[cfg(windows)]`, so it is not compiled during
//! non-native development. It must be built on a Windows host.

#![allow(clippy::missing_safety_doc)]

use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE, WPARAM};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::Shell::{
    SHEmptyRecycleBinW, SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI,
    SHERB_NOSOUND, SHQUERYRBINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed,
    PostMessageW, SetForegroundWindow, ShowWindow, GWL_EXSTYLE, SW_HIDE, SW_MAXIMIZE, SW_MINIMIZE,
    SW_RESTORE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WM_CLOSE, WS_EX_TOOLWINDOW,
};

use super::{
    appindex, audio, brightness, network, notifications, radio, shell_control,
    windowing::WindowManager, ShellPlatform,
};
use crate::geometry::UnitRect;
use crate::shell::{
    AppearanceState, OrbitSpace, PulseNote, SceneWindow, ShellState, SystemStatus, WindowInfo,
    WindowRule, WindowScene, WindowingState,
};

fn hwnd_to_id(hwnd: HWND) -> String {
    (hwnd.0 as isize).to_string()
}
fn id_to_hwnd(id: &str) -> Option<HWND> {
    id.parse::<isize>().ok().map(|v| HWND(v as *mut c_void))
}

/// Shell-side state layered over live Windows sources: Orbit assignments,
/// focus state, placement rules, and cached system readings.
struct Internal {
    orbits: Vec<OrbitSpace>,
    active_orbit: String,
    notifications: Vec<PulseNote>,
    focus: bool,
    wifi_on: bool,
    network_name: Option<String>,
    bluetooth_on: bool,
    brightness: Option<f32>,
    window_orbits: HashMap<isize, String>,
    parked_wells: HashMap<isize, String>,
    /// Windows a Show Desktop toggle minimized, so the next toggle can bring
    /// exactly that set back.
    show_desktop_stack: Vec<isize>,
    rules: Vec<WindowRule>,
    ruled_windows: HashSet<isize>,
    ignored_apps: HashSet<String>,
    /// Last foreground application HWND observed before a Gravity surface
    /// received focus. Horizon controls use this stable native target.
    last_foreground_window: Option<isize>,
    last_notification_poll: std::time::Instant,
}

pub struct WindowsPlatform {
    inner: Mutex<Internal>,
    window_manager: WindowManager,
}

impl WindowsPlatform {
    pub fn new() -> Self {
        let network_name = network::connected_network();
        let wifi_on = radio::wifi_state().unwrap_or(network_name.is_some());
        let bluetooth_on = radio::bluetooth_state().unwrap_or(false);
        let display_brightness = brightness::get().ok();
        let pulse_notes = notifications::read().unwrap_or_default();
        Self {
            inner: Mutex::new(Internal {
                orbits: vec![
                    OrbitSpace {
                        id: "o1".into(),
                        name: "Orbit 1".into(),
                    },
                    OrbitSpace {
                        id: "o2".into(),
                        name: "Orbit 2".into(),
                    },
                    OrbitSpace {
                        id: "o3".into(),
                        name: "Orbit 3".into(),
                    },
                ],
                active_orbit: "o1".into(),
                notifications: pulse_notes,
                focus: false,
                wifi_on,
                network_name,
                bluetooth_on,
                brightness: display_brightness,
                window_orbits: HashMap::new(),
                parked_wells: HashMap::new(),
                show_desktop_stack: Vec::new(),
                rules: Vec::new(),
                ruled_windows: HashSet::new(),
                ignored_apps: HashSet::new(),
                last_foreground_window: None,
                last_notification_poll: std::time::Instant::now(),
            }),
            window_manager: WindowManager::default(),
        }
    }

    fn ensure_not_ignored(&self, hwnd: HWND) -> Result<(), String> {
        let app_id = appindex::app_id_for_window(hwnd, "");
        if self.inner.lock().ignored_apps.contains(&app_id) {
            Err("Gravity is configured to ignore this application".into())
        } else {
            Ok(())
        }
    }
}

struct WindowScan<'a> {
    out: &'a mut Vec<WindowInfo>,
    mapping: &'a mut HashMap<isize, String>,
    active_orbit: &'a str,
    seen: &'a mut Vec<isize>,
    parked_wells: &'a HashMap<isize, String>,
    last_foreground_window: &'a mut Option<isize>,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let scan = &mut *(lparam.0 as *mut WindowScan<'_>);
    let key = hwnd.0 as isize;
    let visible = IsWindowVisible(hwnd).as_bool();
    if !visible && !scan.mapping.contains_key(&key) {
        return TRUE;
    }
    let mut process_id = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    if process_id == GetCurrentProcessId() {
        return TRUE;
    }
    // Skip tool windows (tray helpers, tooltips).
    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex & WS_EX_TOOLWINDOW.0 != 0 {
        return TRUE;
    }
    let mut class = vec![0u16; 128];
    let class_len = GetClassNameW(hwnd, &mut class);
    if class_len > 0
        && String::from_utf16_lossy(&class[..class_len as usize]) == "Windows.UI.Core.CoreWindow"
    {
        // UWP apps expose this implementation window alongside their real
        // ApplicationFrameWindow. Treating both as user windows causes Dock
        // clicks to focus the hidden CoreWindow instead of restoring the app.
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
    let orbit_id = scan
        .mapping
        .entry(key)
        .or_insert_with(|| scan.active_orbit.to_string())
        .clone();
    scan.seen.push(key);
    let focused = visible && hwnd == foreground;
    if focused {
        *scan.last_foreground_window = Some(key);
    }
    scan.out.push(WindowInfo {
        id: hwnd_to_id(hwnd),
        app_id: appindex::app_id_for_window(hwnd, &title),
        title,
        minimized: IsIconic(hwnd).as_bool(),
        maximized: IsZoomed(hwnd).as_bool(),
        focused,
        orbit_id,
        parked_well_id: scan.parked_wells.get(&key).cloned(),
    });
    TRUE
}

fn live_windows(inner: &mut Internal) -> Vec<WindowInfo> {
    let mut out: Vec<WindowInfo> = Vec::new();
    let mut seen = Vec::new();
    let mut scan = WindowScan {
        out: &mut out,
        mapping: &mut inner.window_orbits,
        active_orbit: &inner.active_orbit,
        seen: &mut seen,
        parked_wells: &inner.parked_wells,
        last_foreground_window: &mut inner.last_foreground_window,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut scan as *mut _ as isize));
    }
    inner
        .window_orbits
        .retain(|handle, _| seen.contains(handle));
    inner.parked_wells.retain(|handle, _| seen.contains(handle));
    if inner
        .last_foreground_window
        .is_some_and(|handle| !seen.contains(&handle))
    {
        inner.last_foreground_window = None;
    }
    out
}

fn active_control_window(inner: &mut Internal) -> Option<HWND> {
    let windows = live_windows(inner);
    let target = super::snap::last_foreign_foreground()
        .filter(|handle| {
            windows.iter().any(|window| {
                window.id == handle.to_string()
                    && window.orbit_id == inner.active_orbit
                    && !window.minimized
            })
        })
        .or_else(|| {
            inner.last_foreground_window.filter(|handle| {
                windows.iter().any(|window| {
                    window.id == handle.to_string()
                        && window.orbit_id == inner.active_orbit
                        && !window.minimized
                })
            })
        })
        .or_else(|| {
            windows
                .iter()
                .find(|window| window.orbit_id == inner.active_orbit && !window.minimized)
                .and_then(|window| window.id.parse::<isize>().ok())
        })?;
    Some(HWND(target as *mut c_void))
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

fn match_scene_windows(scene: &WindowScene, windows: &[WindowInfo]) -> Vec<(usize, usize)> {
    let mut used = Vec::new();
    let mut matches = Vec::new();
    for (saved_index, saved) in scene.windows.iter().enumerate() {
        let live = windows
            .iter()
            .enumerate()
            .filter(|(index, window)| !used.contains(index) && window.app_id == saved.app_id)
            .min_by_key(|(_, window)| if window.title == saved.title { 0 } else { 1 });
        if let Some((live_index, _)) = live {
            used.push(live_index);
            matches.push((saved_index, live_index));
        }
    }
    matches
}

impl ShellPlatform for WindowsPlatform {
    fn snapshot(&self) -> ShellState {
        let mut inner = self.inner.lock();
        if inner.last_notification_poll.elapsed() >= std::time::Duration::from_secs(5) {
            if let Ok(notes) = notifications::read() {
                inner.notifications = notes;
            }
            inner.last_notification_poll = std::time::Instant::now();
        }
        let mut status = SystemStatus {
            online: inner.wifi_on,
            network: if inner.wifi_on {
                inner.network_name.clone()
            } else {
                None
            },
            volume: audio::get_volume().unwrap_or(0.5),
            brightness: inner.brightness,
            focus: inner.focus,
            bluetooth: inner.bluetooth_on,
            trash_full: recycle_bin_full(),
            ..Default::default()
        };
        power_status(&mut status);
        let windows = live_windows(&mut inner);
        let active_orbit = inner.active_orbit.clone();
        let mut rule_actions = Vec::new();
        for window in &windows {
            if window.orbit_id != active_orbit {
                continue;
            }
            let Ok(handle) = window.id.parse::<isize>() else {
                continue;
            };
            let action = inner
                .rules
                .iter()
                .find(|rule| {
                    rule.enabled
                        && rule.app_id == window.app_id
                        && !inner.ignored_apps.contains(&window.app_id)
                })
                .map(|rule| rule.action.clone());
            if inner.ruled_windows.insert(handle) {
                if let Some(action) = action {
                    rule_actions.push((handle, action));
                }
            }
        }
        for (handle, action) in rule_actions {
            let _ = self
                .window_manager
                .execute_for(HWND(handle as *mut c_void), &action);
        }

        ShellState {
            apps: appindex::pinned_and_indexed(),
            windows,
            status,
            orbits: inner.orbits.clone(),
            active_orbit: inner.active_orbit.clone(),
            notifications: inner.notifications.clone(),
            appearance: AppearanceState::default(),
            windowing: WindowingState::default(),
            shell_mode: crate::shell::ShellMode::Gravity,
        }
    }

    fn focus_window(&self, id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(id).ok_or_else(|| "Invalid window identifier".to_string())?;
        if !unsafe { IsWindow(hwnd) }.as_bool() {
            return Err("That window is no longer available".into());
        }
        let orbit = {
            let mut inner = self.inner.lock();
            inner.parked_wells.remove(&(hwnd.0 as isize));
            inner.window_orbits.get(&(hwnd.0 as isize)).cloned()
        };
        if let Some(orbit) = orbit {
            self.switch_orbit(&orbit)?;
        }
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err("Windows did not allow Gravity to activate that window".into());
            }
        }
        Ok(())
    }

    fn minimize_window(&self, id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(id).ok_or_else(|| "Invalid window identifier".to_string())?;
        if !unsafe { IsWindow(hwnd) }.as_bool() {
            return Err("That window is no longer available".into());
        }
        self.inner.lock().parked_wells.remove(&(hwnd.0 as isize));
        unsafe {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        Ok(())
    }

    fn toggle_maximize_window(&self, id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(id).ok_or_else(|| "Invalid window identifier".to_string())?;
        if !unsafe { IsWindow(hwnd) }.as_bool() {
            return Err("That window is no longer available".into());
        }
        self.inner.lock().parked_wells.remove(&(hwnd.0 as isize));
        unsafe {
            let command = if IsZoomed(hwnd).as_bool() {
                SW_RESTORE
            } else {
                SW_MAXIMIZE
            };
            let _ = ShowWindow(hwnd, command);
            let _ = SetForegroundWindow(hwnd);
        }
        Ok(())
    }

    fn close_window(&self, id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(id).ok_or_else(|| "Invalid window identifier".to_string())?;
        if !unsafe { IsWindow(hwnd) }.as_bool() {
            return Err("That window is no longer available".into());
        }
        self.inner.lock().parked_wells.remove(&(hwnd.0 as isize));
        unsafe { PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0)) }
            .map_err(|error| error.to_string())
    }

    fn active_window_control(&self, kind: &str) -> Result<(), String> {
        if !matches!(kind, "close" | "minimize" | "zoom") {
            return Err("Unknown active-window control".into());
        }
        let hwnd = {
            let mut inner = self.inner.lock();
            let hwnd = active_control_window(&mut inner)
                .ok_or_else(|| "There is no active application window to control".to_string())?;
            inner.parked_wells.remove(&(hwnd.0 as isize));
            if matches!(kind, "close" | "minimize") {
                inner.last_foreground_window = None;
            }
            hwnd
        };
        self.ensure_not_ignored(hwnd)?;
        unsafe {
            match kind {
                "close" => PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0))
                    .map_err(|error| error.to_string()),
                "minimize" => {
                    let _ = ShowWindow(hwnd, SW_MINIMIZE);
                    Ok(())
                }
                "zoom" => {
                    let command = if IsZoomed(hwnd).as_bool() {
                        SW_RESTORE
                    } else {
                        SW_MAXIMIZE
                    };
                    let _ = ShowWindow(hwnd, command);
                    let _ = SetForegroundWindow(hwnd);
                    Ok(())
                }
                _ => unreachable!(),
            }
        }
    }

    fn window_action(&self, action: &str) -> Result<(), String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if !hwnd.0.is_null() {
            self.ensure_not_ignored(hwnd)?;
        }
        self.window_manager.execute(action)
    }

    fn window_action_for(&self, window_id: &str, action: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        self.ensure_not_ignored(hwnd)?;
        self.window_manager.execute_for(hwnd, action)
    }

    fn apply_grid_region(
        &self,
        window_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        self.ensure_not_ignored(hwnd)?;
        self.window_manager
            .place_unit(hwnd, UnitRect::new(x, y, width, height))
    }

    fn apply_grid_region_on_monitor(
        &self,
        window_id: &str,
        monitor: usize,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        self.ensure_not_ignored(hwnd)?;
        self.window_manager
            .place_unit_on_monitor(hwnd, UnitRect::new(x, y, width, height), monitor)
    }

    fn warp_window(&self, window_id: &str, operation: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        self.ensure_not_ignored(hwnd)?;
        self.window_manager.nudge(hwnd, operation)
    }

    fn park_window(&self, window_id: &str, well_id: &str) -> Result<(), String> {
        if well_id.is_empty()
            || well_id.len() > 64
            || !well_id
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        {
            return Err("That desktop shape has an invalid identifier".into());
        }
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        self.ensure_not_ignored(hwnd)?;
        if !unsafe { IsWindow(hwnd) }.as_bool() {
            return Err("That window is no longer available".into());
        }
        let mut inner = self.inner.lock();
        let _ = live_windows(&mut inner);
        let key = hwnd.0 as isize;
        if !inner.window_orbits.contains_key(&key) {
            return Err("Only normal application windows can be stored in a desktop shape".into());
        }
        inner.parked_wells.insert(key, well_id.to_string());
        drop(inner);
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        Ok(())
    }

    fn release_window(&self, window_id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        let removed = self.inner.lock().parked_wells.remove(&(hwnd.0 as isize));
        if removed.is_none() {
            return Err("That window is not stored in a desktop shape".into());
        }
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        Ok(())
    }

    fn release_all_parked_windows(&self) -> Result<(), String> {
        let handles: Vec<isize> = self
            .inner
            .lock()
            .parked_wells
            .drain()
            .map(|(handle, _)| handle)
            .collect();
        for handle in handles {
            unsafe {
                let _ = ShowWindow(HWND(handle as *mut c_void), SW_RESTORE);
            }
        }
        Ok(())
    }

    fn toggle_show_desktop(&self) -> Result<bool, String> {
        let windows = self.snapshot().windows;
        let minimized_now: HashSet<isize> = windows
            .iter()
            .filter(|window| window.minimized)
            .filter_map(|window| window.id.parse::<isize>().ok())
            .collect();
        let restorable: Vec<isize> = self
            .inner
            .lock()
            .show_desktop_stack
            .iter()
            .copied()
            .filter(|handle| minimized_now.contains(handle))
            .collect();
        if !restorable.is_empty() {
            for handle in &restorable {
                unsafe {
                    let _ = ShowWindow(HWND(*handle as *mut c_void), SW_RESTORE);
                }
            }
            self.inner.lock().show_desktop_stack.clear();
            return Ok(false);
        }
        let targets: Vec<isize> = windows
            .iter()
            .filter(|window| !window.minimized && window.parked_well_id.is_none())
            .filter_map(|window| window.id.parse::<isize>().ok())
            .collect();
        for handle in &targets {
            unsafe {
                let _ = ShowWindow(HWND(*handle as *mut c_void), SW_MINIMIZE);
            }
        }
        self.inner.lock().show_desktop_stack = targets;
        Ok(true)
    }

    fn configure_windowing(&self, gap: u32, cycling: bool) {
        self.window_manager.configure(gap, cycling);
    }

    fn configure_rules(&self, rules: &[WindowRule]) {
        let mut inner = self.inner.lock();
        inner.rules = rules.to_vec();
        inner.ruled_windows.clear();
    }

    fn configure_ignored(&self, app_ids: &[String]) {
        let mut inner = self.inner.lock();
        inner.ignored_apps = app_ids.iter().cloned().collect();
    }

    fn current_display_fingerprint(&self) -> String {
        self.window_manager.display_fingerprint()
    }

    fn capture_scene(&self, name: &str) -> Result<WindowScene, String> {
        let mut inner = self.inner.lock();
        let windows = live_windows(&mut inner);
        let active_orbit = inner.active_orbit.clone();
        drop(inner);
        let captured: Vec<SceneWindow> = windows
            .into_iter()
            .filter(|window| window.orbit_id == active_orbit && !window.minimized)
            .filter_map(|window| {
                let hwnd = id_to_hwnd(&window.id)?;
                let frame = self.window_manager.capture_frame(hwnd).ok()?;
                Some(SceneWindow {
                    app_id: window.app_id,
                    title: window.title,
                    frame,
                })
            })
            .collect();
        if captured.is_empty() {
            return Err("There are no visible application windows to capture".into());
        }
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        Ok(WindowScene {
            id: format!("scene-{created_at}-{}", captured.len()),
            name: name.to_string(),
            created_at,
            windows: captured,
            auto_restore: false,
            display_fingerprint: self.window_manager.display_fingerprint(),
        })
    }

    fn restore_scene(&self, scene: &WindowScene) -> Result<(), String> {
        let mut windows = {
            let mut inner = self.inner.lock();
            live_windows(&mut inner)
        };
        let mut required: HashMap<&str, usize> = HashMap::new();
        for saved in &scene.windows {
            *required.entry(&saved.app_id).or_default() += 1;
        }
        for (app_id, count) in required {
            let available = windows
                .iter()
                .filter(|window| window.app_id == app_id)
                .count();
            for _ in available..count {
                let _ = appindex::launch(app_id);
            }
        }

        for _ in 0..10 {
            windows = {
                let mut inner = self.inner.lock();
                live_windows(&mut inner)
            };
            let matched = match_scene_windows(scene, &windows);
            if matched.len() == scene.windows.len() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }

        let matched = match_scene_windows(scene, &windows);
        for (saved_index, live_index) in &matched {
            let hwnd = id_to_hwnd(&windows[*live_index].id)
                .ok_or_else(|| "A Scene window disappeared during restore".to_string())?;
            self.window_manager
                .restore_frame(hwnd, &scene.windows[*saved_index].frame)?;
        }
        if matched.len() != scene.windows.len() {
            return Err(format!(
                "Restored {} of {} windows; some applications did not create another window",
                matched.len(),
                scene.windows.len()
            ));
        }
        Ok(())
    }

    fn launch_app(&self, app_id: &str) -> Result<(), String> {
        appindex::launch(app_id)
    }

    fn launch_app_with_files(&self, app_id: &str, paths: &[String]) -> Result<(), String> {
        appindex::launch_with_files(app_id, paths)
    }

    fn set_volume(&self, value: f32) -> Result<(), String> {
        audio::set_volume(value.clamp(0.0, 1.0))
    }

    fn set_brightness(&self, value: f32) -> Result<(), String> {
        let value = value.clamp(0.0, 1.0);
        brightness::set(value)?;
        self.inner.lock().brightness = Some(value);
        Ok(())
    }

    fn toggle_setting(&self, key: &str) -> Result<(), String> {
        let mut inner = self.inner.lock();
        match key {
            "wifi" => {
                inner.wifi_on = radio::toggle_wifi()?;
                inner.network_name = if inner.wifi_on {
                    network::connected_network()
                } else {
                    None
                };
            }
            "bluetooth" => inner.bluetooth_on = radio::toggle_bluetooth()?,
            "focus" => inner.focus = !inner.focus,
            _ => return Err(format!("Unknown setting: {key}")),
        }
        Ok(())
    }

    fn empty_trash(&self) -> Result<(), String> {
        unsafe {
            SHEmptyRecycleBinW(
                HWND(std::ptr::null_mut()),
                PCWSTR::null(),
                SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
            )
        }
        .map_err(|error| error.to_string())
    }

    fn switch_orbit(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock();
        if !inner.orbits.iter().any(|orbit| orbit.id == id) {
            return Err("That Orbit does not exist".into());
        }
        if inner.active_orbit == id {
            return Ok(());
        }
        let windows = live_windows(&mut inner);
        let mut focus_target = None;
        for window in windows {
            let Some(hwnd) = id_to_hwnd(&window.id) else {
                continue;
            };
            if window.parked_well_id.is_some() {
                continue;
            }
            unsafe {
                if window.orbit_id == id {
                    let command = if window.minimized {
                        SW_SHOWMINNOACTIVE
                    } else {
                        SW_SHOWNOACTIVATE
                    };
                    let _ = ShowWindow(hwnd, command);
                    if focus_target.is_none() && !window.minimized {
                        focus_target = Some(hwnd);
                    }
                } else if window.orbit_id == inner.active_orbit {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
            }
        }
        inner.active_orbit = id.to_string();
        drop(inner);
        if let Some(hwnd) = focus_target {
            unsafe {
                let _ = SetForegroundWindow(hwnd);
            }
        }
        Ok(())
    }

    fn move_window_to_orbit(&self, window_id: &str, orbit_id: &str) -> Result<(), String> {
        let hwnd = id_to_hwnd(window_id).ok_or_else(|| "Invalid window identifier".to_string())?;
        let mut inner = self.inner.lock();
        if !inner.orbits.iter().any(|orbit| orbit.id == orbit_id) {
            return Err("That Orbit does not exist".into());
        }
        let _ = live_windows(&mut inner);
        let key = hwnd.0 as isize;
        if !inner.window_orbits.contains_key(&key) {
            return Err("That window is no longer available".into());
        }
        inner.window_orbits.insert(key, orbit_id.to_string());
        let active = inner.active_orbit == orbit_id && !inner.parked_wells.contains_key(&key);
        drop(inner);
        unsafe {
            let _ = ShowWindow(hwnd, if active { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
        Ok(())
    }

    fn dismiss_notification(&self, id: &str) -> Result<(), String> {
        notifications::dismiss(id)?;
        self.inner.lock().notifications.retain(|n| n.id != id);
        Ok(())
    }

    fn engage_shell(&self) {
        shell_control::hide_taskbar();
    }

    fn disengage_shell(&self) {
        let _ = self.release_all_parked_windows();
        shell_control::restore_taskbar();
    }
}
