//! Global move/resize tracking and Gravity magnetic edge previews.

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{OnceLock, RwLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use windows::Win32::Foundation::{HMODULE, HWND, POINT};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetMessageW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MOVESIZEEND,
    EVENT_SYSTEM_MOVESIZESTART, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::commands::AppState;

static EVENT_SENDER: OnceLock<Sender<HookEvent>> = OnceLock::new();
static WELL_TARGETS: OnceLock<RwLock<Vec<WellTarget>>> = OnceLock::new();
static DOCK_TARGETS: OnceLock<RwLock<Vec<DockHitTarget>>> = OnceLock::new();
static DOCK_TRASH_TARGETS: OnceLock<RwLock<Vec<DockHitTarget>>> = OnceLock::new();
static LAST_FOREIGN_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WellTarget {
    pub id: String,
    pub monitor: usize,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub capacity: usize,
    pub occupied: usize,
}

impl WellTarget {
    pub fn accepting(&self) -> bool {
        self.occupied < self.capacity
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DockHitTarget {
    monitor: usize,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPointerLocation {
    pub monitor: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug)]
struct MonitorBounds {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

pub fn set_well_targets(targets: Vec<WellTarget>) {
    let valid = targets
        .into_iter()
        .filter(|target| {
            !target.id.is_empty()
                && target.id.len() <= 64
                && target
                    .id
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
                && target.x.is_finite()
                && (0.0..=1.0).contains(&target.x)
                && target.y.is_finite()
                && (0.0..=1.0).contains(&target.y)
                && target.radius.is_finite()
                && (24.0..=240.0).contains(&target.radius)
                && (1..=32).contains(&target.capacity)
                && target.occupied <= 64
        })
        .take(64)
        .collect();
    *WELL_TARGETS
        .get_or_init(|| RwLock::new(Vec::new()))
        .write()
        .unwrap() = valid;
}

pub fn well_capacity(well_id: &str) -> Option<usize> {
    WELL_TARGETS
        .get()?
        .read()
        .ok()?
        .iter()
        .find(|target| target.id == well_id)
        .map(|target| target.capacity)
}

pub fn well_targets_snapshot() -> Vec<WellTarget> {
    WELL_TARGETS
        .get()
        .and_then(|targets| targets.read().ok().map(|targets| targets.clone()))
        .unwrap_or_default()
}

/// Orbit publishes its rendered Trash hit box in physical desktop pixels.
/// Keeping one target per monitor lets any Deep Field surface use the exact
/// Dock geometry instead of guessing from the bottom edge of its WebView.
pub fn set_dock_trash_target(
    monitor: usize,
    target: Option<(f64, f64, f64, f64)>,
) -> Result<(), String> {
    set_registered_target(&DOCK_TRASH_TARGETS, monitor, target, 512.0, "Trash")
}

/// Orbit's complete rendered shelf. Native windows released over this exact
/// rectangle minimize into Orbit instead of falling through to edge snapping.
pub fn set_dock_target(monitor: usize, target: Option<(f64, f64, f64, f64)>) -> Result<(), String> {
    set_registered_target(&DOCK_TARGETS, monitor, target, 8_192.0, "Dock")
}

fn set_registered_target(
    registry: &'static OnceLock<RwLock<Vec<DockHitTarget>>>,
    monitor: usize,
    target: Option<(f64, f64, f64, f64)>,
    max_width: f64,
    name: &str,
) -> Result<(), String> {
    let mut targets = registry
        .get_or_init(|| RwLock::new(Vec::new()))
        .write()
        .map_err(|_| "The Dock target registry is unavailable".to_string())?;
    targets.retain(|item| item.monitor != monitor);
    let Some((left, top, width, height)) = target else {
        return Ok(());
    };
    if !left.is_finite()
        || !top.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || !(8.0..=max_width).contains(&width)
        || !(8.0..=512.0).contains(&height)
    {
        return Err(format!("Orbit reported an invalid {name} hit target"));
    }
    targets.push(DockHitTarget {
        monitor,
        left,
        top,
        right: left + width,
        bottom: top + height,
    });
    Ok(())
}

pub fn cursor_over_dock_trash() -> bool {
    cursor_registered_target(&DOCK_TRASH_TARGETS).is_some()
}

fn cursor_dock_target(app: &tauri::AppHandle) -> Option<usize> {
    if let Some(monitor) = cursor_registered_target(&DOCK_TARGETS) {
        return Some(monitor);
    }
    // WebView/Win32 coordinate virtualization can briefly disagree during a
    // mixed-DPI native move. Keep the exact shelf rectangle as the primary
    // target, then provide a pressure zone over the lower central display only
    // when that monitor has a live registered Orbit shelf.
    let point = cursor_point()?;
    let registered = DOCK_TARGETS.get()?.read().ok()?;
    let mut monitors = app.available_monitors().ok()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    monitors.iter().enumerate().find_map(|(monitor, display)| {
        if !registered.iter().any(|target| target.monitor == monitor) {
            return None;
        }
        let position = display.position();
        let size = display.size();
        let x = (point.x - position.x) as f64 / size.width.max(1) as f64;
        let y = (point.y - position.y) as f64 / size.height.max(1) as f64;
        ((0.18..=0.82).contains(&x) && (0.82..=1.01).contains(&y)).then_some(monitor)
    })
}

fn cursor_registered_target(
    registry: &'static OnceLock<RwLock<Vec<DockHitTarget>>>,
) -> Option<usize> {
    let point = cursor_point()?;
    registry.get()?.read().ok()?.iter().find_map(|target| {
        (point.x as f64 >= target.left
            && point.x as f64 <= target.right
            && point.y as f64 >= target.top
            && point.y as f64 <= target.bottom)
            .then_some(target.monitor)
    })
}

pub fn desktop_pointer_location(app: &tauri::AppHandle) -> Option<DesktopPointerLocation> {
    let point = cursor_point()?;
    let mut monitors = app.available_monitors().ok()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    let bounds = monitors
        .iter()
        .map(|monitor| MonitorBounds {
            left: monitor.position().x,
            top: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect::<Vec<_>>();
    locate_desktop_point(point.x, point.y, &bounds)
}

fn cursor_point() -> Option<POINT> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some(point)
}

fn locate_desktop_point(
    point_x: i32,
    point_y: i32,
    monitors: &[MonitorBounds],
) -> Option<DesktopPointerLocation> {
    let (monitor, display) = monitors.iter().enumerate().find(|(_, display)| {
        point_x >= display.left
            && (point_x as i64) < display.left as i64 + display.width as i64
            && point_y >= display.top
            && (point_y as i64) < display.top as i64 + display.height as i64
    })?;
    Some(DesktopPointerLocation {
        monitor,
        x: ((point_x - display.left) as f64 / display.width.max(1) as f64).clamp(0.0, 1.0),
        y: ((point_y - display.top) as f64 / display.height.max(1) as f64).clamp(0.0, 1.0),
    })
}

#[derive(Clone, Copy, Debug)]
enum HookEvent {
    Started(isize),
    Ended(isize),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SnapTarget {
    monitor: usize,
    action: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewPayload {
    action: &'static str,
}

unsafe extern "system" fn win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object_id: i32,
    _child_id: i32,
    _thread_id: u32,
    _time: u32,
) {
    if object_id != 0 || hwnd.0.is_null() {
        return;
    }
    if event == EVENT_SYSTEM_FOREGROUND {
        LAST_FOREIGN_FOREGROUND.store(hwnd.0 as isize, Ordering::Relaxed);
        return;
    }
    let event = match event {
        EVENT_SYSTEM_MOVESIZESTART => HookEvent::Started(hwnd.0 as isize),
        EVENT_SYSTEM_MOVESIZEEND => HookEvent::Ended(hwnd.0 as isize),
        _ => return,
    };
    if let Some(sender) = EVENT_SENDER.get() {
        let _ = sender.send(event);
    }
}

pub fn start(app: tauri::AppHandle) {
    let (sender, receiver) = mpsc::channel();
    if EVENT_SENDER.set(sender).is_err() {
        return;
    }

    thread::spawn(move || unsafe {
        let hook = SetWinEventHook(
            EVENT_SYSTEM_MOVESIZESTART,
            EVENT_SYSTEM_MOVESIZEEND,
            HMODULE::default(),
            Some(win_event),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.is_invalid() {
            return;
        }
        let foreground_hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            HMODULE::default(),
            Some(win_event),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if foreground_hook.is_invalid() {
            return;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, HWND::default(), 0, 0).as_bool() {}
    });

    thread::spawn(move || preview_loop(app, receiver));
}

/// The foreground HWND observed immediately before a Gravity-owned surface
/// gained focus. The foreground WinEvent hook is out-of-process only, so a
/// Horizon click cannot overwrite this target.
pub fn last_foreign_foreground() -> Option<isize> {
    let handle = LAST_FOREIGN_FOREGROUND.load(Ordering::Relaxed);
    (handle != 0).then_some(handle)
}

fn preview_loop(app: tauri::AppHandle, receiver: Receiver<HookEvent>) {
    let mut moving = None;
    let mut shown: Option<SnapTarget> = None;
    let mut shown_well: Option<(usize, String, bool)> = None;
    let mut shown_dock: Option<usize> = None;
    loop {
        match receiver.try_recv() {
            Ok(HookEvent::Started(hwnd)) => moving = Some(hwnd),
            Ok(HookEvent::Ended(hwnd)) => {
                let well = well_target(&app);
                let dock = if well.is_none() {
                    cursor_dock_target(&app)
                } else {
                    None
                };
                let target = if well.is_none() && dock.is_none() {
                    snap_target(&app)
                } else {
                    None
                };
                hide_previews(&app);
                show_well_hover(&app, None);
                show_dock_hover(&app, None);
                shown = None;
                shown_well = None;
                shown_dock = None;
                moving = None;
                let state = app.state::<AppState>();
                if let Some(well) = well {
                    let occupied = state
                        .platform
                        .snapshot()
                        .windows
                        .iter()
                        .filter(|window| window.parked_well_id.as_deref() == Some(well.id.as_str()))
                        .count();
                    if occupied < well.capacity {
                        let _ = state.platform.park_window(&hwnd.to_string(), &well.id);
                        let _ = app.emit("gravity://state-changed", ());
                    }
                } else if dock.is_some() {
                    let _ = state.platform.minimize_window(&hwnd.to_string());
                    let _ = app.emit("gravity://state-changed", ());
                } else if let Some(target) = target {
                    let _ = state
                        .platform
                        .window_action_for(&hwnd.to_string(), target.action);
                }
            }
            Err(TryRecvError::Disconnected) => break,
            Err(TryRecvError::Empty) => {}
        }

        if moving.is_some() {
            let well = well_target(&app);
            let next_well = well
                .as_ref()
                .map(|target| (target.monitor, target.id.clone(), target.accepting()));
            if next_well != shown_well {
                show_well_hover(&app, next_well.as_ref());
                shown_well = next_well;
            }
            let dock = if well.is_none() {
                cursor_dock_target(&app)
            } else {
                None
            };
            if dock != shown_dock {
                show_dock_hover(&app, dock);
                shown_dock = dock;
            }
            let target = if well.is_none() && dock.is_none() {
                snap_target(&app)
            } else {
                None
            };
            if target != shown {
                hide_previews(&app);
                if let Some(target) = &target {
                    show_preview(&app, target);
                }
                shown = target;
            }
        }
        thread::sleep(Duration::from_millis(32));
    }
}

fn show_dock_hover(app: &tauri::AppHandle, monitor: Option<usize>) {
    for (label, _) in app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("orbit-"))
    {
        let active = monitor
            .map(|index| label == format!("orbit-{index}"))
            .unwrap_or(false);
        let _ = app.emit_to(
            label,
            "gravity://dock-window-hover",
            serde_json::json!({ "active": active }),
        );
    }
}

fn well_target(app: &tauri::AppHandle) -> Option<WellTarget> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    let mut monitors = app.available_monitors().ok()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    let targets = WELL_TARGETS.get()?.read().ok()?;
    targets
        .iter()
        .find(|target| {
            let Some(display) = monitors.get(target.monitor) else {
                return false;
            };
            let position = display.position();
            let size = display.size();
            let center_x = position.x as f64 + target.x * size.width as f64;
            let center_y = position.y as f64 + target.y * size.height as f64;
            let radius = target.radius * display.scale_factor();
            (point.x as f64 - center_x).hypot(point.y as f64 - center_y) <= radius
        })
        .cloned()
}

pub fn cursor_well_target(app: &tauri::AppHandle) -> Option<WellTarget> {
    well_target(app)
}

fn show_well_hover(app: &tauri::AppHandle, target: Option<&(usize, String, bool)>) {
    for (label, _) in app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("wells-"))
    {
        let well_id = target
            .filter(|(monitor, _, _)| label == format!("wells-{monitor}"))
            .map(|(_, id, _)| id.as_str());
        let accepting = target
            .filter(|(monitor, _, _)| label == format!("wells-{monitor}"))
            .map(|(_, _, accepting)| *accepting)
            .unwrap_or(false);
        let _ = app.emit_to(
            label,
            "gravity://well-hover",
            serde_json::json!({ "wellId": well_id, "accepting": accepting }),
        );
    }
}

fn snap_target(app: &tauri::AppHandle) -> Option<SnapTarget> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    let mut monitors = app.available_monitors().ok()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    let (monitor, display) = monitors.iter().enumerate().find(|(_, monitor)| {
        let position = monitor.position();
        let size = monitor.size();
        point.x >= position.x
            && point.x < position.x + size.width as i32
            && point.y >= position.y
            && point.y < position.y + size.height as i32
    })?;

    let position = display.position();
    let size = display.size();
    let scale = display.scale_factor();
    let threshold = (30.0 * scale).round() as i32;
    let horizon = (34.0 * scale).round() as i32;
    let orbit = (170.0 * scale).round() as i32;
    let left = point.x <= position.x + threshold;
    let right = point.x >= position.x + size.width as i32 - threshold;
    let top = point.y <= position.y + horizon + threshold;
    let bottom = point.y >= position.y + size.height as i32 - orbit - threshold;
    let modifier_layer = unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } < 0;
    let action = match (left, right, top, bottom) {
        (true, _, true, _) => "top-left",
        (_, true, true, _) => "top-right",
        (true, _, _, true) => "bottom-left",
        (_, true, _, true) => "bottom-right",
        (true, _, _, _) if modifier_layer => "first-two-thirds",
        (_, true, _, _) if modifier_layer => "last-two-thirds",
        (true, _, _, _) => "left-half",
        (_, true, _, _) => "right-half",
        (_, _, true, _) => "maximize",
        (_, _, _, true) => "bottom-half",
        _ => return None,
    };
    Some(SnapTarget { monitor, action })
}

fn hide_previews(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("snap-") {
            let _ = window.hide();
        }
    }
}

fn show_preview(app: &tauri::AppHandle, target: &SnapTarget) {
    let label = format!("snap-{}", target.monitor);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = app.emit_to(
            label,
            "gravity://snap-preview",
            PreviewPayload {
                action: target.action,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_point_resolves_negative_origin_and_monitor_index() {
        let monitors = [
            MonitorBounds {
                left: -2560,
                top: 160,
                width: 2560,
                height: 1440,
            },
            MonitorBounds {
                left: 0,
                top: 0,
                width: 3840,
                height: 2160,
            },
        ];
        let point = locate_desktop_point(-1280, 880, &monitors).unwrap();
        assert_eq!(point.monitor, 0);
        assert!((point.x - 0.5).abs() < f64::EPSILON);
        assert!((point.y - 0.5).abs() < f64::EPSILON);

        let point = locate_desktop_point(2880, 540, &monitors).unwrap();
        assert_eq!(point.monitor, 1);
        assert!((point.x - 0.75).abs() < f64::EPSILON);
        assert!((point.y - 0.25).abs() < f64::EPSILON);
    }

    #[test]
    fn desktop_point_excludes_outer_edges_and_gaps() {
        let monitors = [
            MonitorBounds {
                left: 0,
                top: 0,
                width: 1920,
                height: 1080,
            },
            MonitorBounds {
                left: 1920,
                top: 200,
                width: 1280,
                height: 1024,
            },
        ];
        assert!(locate_desktop_point(2000, 100, &monitors).is_none());
        assert!(locate_desktop_point(3200, 500, &monitors).is_none());
        assert_eq!(
            locate_desktop_point(1920, 200, &monitors).unwrap().monitor,
            1
        );
    }

    #[test]
    fn full_well_is_a_visible_but_blocked_drop_target() {
        let target = WellTarget {
            id: "well-full".into(),
            monitor: 0,
            x: 0.5,
            y: 0.5,
            radius: 78.0,
            capacity: 6,
            occupied: 6,
        };
        assert!(!target.accepting());
    }
}
