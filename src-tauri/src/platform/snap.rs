//! Global move/resize tracking and Tahoe-style magnetic edge previews.

use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use windows::Win32::Foundation::{HMODULE, HWND, POINT};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetMessageW, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, MSG,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::commands::AppState;

static EVENT_SENDER: OnceLock<Sender<HookEvent>> = OnceLock::new();

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
    loop {
        match receiver.try_recv() {
            Ok(HookEvent::Started(hwnd)) => moving = Some(hwnd),
            Ok(HookEvent::Ended(hwnd)) => {
                let target = snap_target(&app);
                hide_previews(&app);
                shown = None;
                moving = None;
                if let Some(target) = target {
                    let state = app.state::<AppState>();
                    let _ = state
                        .platform
                        .window_action_for(&hwnd.to_string(), target.action);
                }
            }
            Err(TryRecvError::Disconnected) => break,
            Err(TryRecvError::Empty) => {}
        }

        if moving.is_some() {
            let target = snap_target(&app);
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
    let action = match (left, right, top, bottom) {
        (true, _, true, _) => "top-left",
        (_, true, true, _) => "top-right",
        (true, _, _, true) => "bottom-left",
        (_, true, _, true) => "bottom-right",
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
