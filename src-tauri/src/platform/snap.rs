//! Global move/resize tracking and Tahoe-style magnetic edge previews.

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
    GetCursorPos, GetMessageW, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, MSG,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::commands::AppState;

static EVENT_SENDER: OnceLock<Sender<HookEvent>> = OnceLock::new();
static WELL_TARGETS: OnceLock<RwLock<Vec<WellTarget>>> = OnceLock::new();

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WellTarget {
    pub id: String,
    pub monitor: usize,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
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
        })
        .take(64)
        .collect();
    *WELL_TARGETS
        .get_or_init(|| RwLock::new(Vec::new()))
        .write()
        .unwrap() = valid;
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
        let mut message = MSG::default();
        while GetMessageW(&mut message, HWND::default(), 0, 0).as_bool() {}
    });

    thread::spawn(move || preview_loop(app, receiver));
}

fn preview_loop(app: tauri::AppHandle, receiver: Receiver<HookEvent>) {
    let mut moving = None;
    let mut shown: Option<SnapTarget> = None;
    let mut shown_well: Option<(usize, String)> = None;
    loop {
        match receiver.try_recv() {
            Ok(HookEvent::Started(hwnd)) => moving = Some(hwnd),
            Ok(HookEvent::Ended(hwnd)) => {
                let well = well_target(&app);
                let target = if well.is_none() {
                    snap_target(&app)
                } else {
                    None
                };
                hide_previews(&app);
                show_well_hover(&app, None);
                shown = None;
                shown_well = None;
                moving = None;
                let state = app.state::<AppState>();
                if let Some(well) = well {
                    let _ = state.platform.park_window(&hwnd.to_string(), &well.id);
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
                .map(|target| (target.monitor, target.id.clone()));
            if next_well != shown_well {
                show_well_hover(&app, next_well.as_ref());
                shown_well = next_well;
            }
            let target = if well.is_none() {
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

fn show_well_hover(app: &tauri::AppHandle, target: Option<&(usize, String)>) {
    for (label, _) in app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("deepfield-"))
    {
        let well_id = target
            .filter(|(monitor, _)| label == format!("deepfield-{monitor}"))
            .map(|(_, id)| id.as_str());
        let _ = app.emit_to(
            label,
            "gravity://well-hover",
            serde_json::json!({ "wellId": well_id }),
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
