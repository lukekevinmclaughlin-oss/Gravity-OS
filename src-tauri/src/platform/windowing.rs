//! Native window management for Gravity OS.
//!
//! The layout mathematics live in `geometry`; this module is deliberately a
//! thin Win32 adapter so the same placement behaviour can be unit-tested
//! without touching real windows.

use parking_lot::Mutex;
use std::collections::HashMap;

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, HWND_TOP, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_RESTORE,
    WS_EX_TOOLWINDOW,
};

use crate::geometry::{self, FocusDirection, Placement, Rect, UnitRect};
use crate::shell::SceneFrame;

const HISTORY_DEPTH: usize = 10;

#[derive(Clone, Copy)]
struct WindowPreferences {
    gap: f64,
    cycling: bool,
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            gap: 10.0,
            cycling: true,
        }
    }
}

#[derive(Default)]
pub struct WindowManager {
    history: Mutex<HashMap<isize, Vec<Rect>>>,
    originals: Mutex<HashMap<isize, Rect>>,
    preferences: Mutex<WindowPreferences>,
}

impl WindowManager {
    pub fn configure(&self, gap: u32, cycling: bool) {
        *self.preferences.lock() = WindowPreferences {
            gap: gap.min(48) as f64,
            cycling,
        };
    }

    pub fn execute(&self, action: &str) -> Result<(), String> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0.is_null() {
            return Err("No active window".into());
        }

        if let Some(placement) = Placement::parse(action) {
            return self.place(foreground, placement);
        }

        match action {
            "undo" => self.undo(foreground),
            "restore" => self.restore(foreground),
            "next-display" => self.move_display(foreground, 1),
            "previous-display" => self.move_display(foreground, -1),
            "grow" => self.scale(foreground, 1.1),
            "shrink" => self.scale(foreground, 0.9),
            "arrange-display" => self.arrange_display(foreground),
            "cascade" => self.cascade(foreground),
            "tile-app" => self.tile_application(foreground),
            "gather-all" => self.gather_all(foreground),
            "pair-previous" => self.pair_previous(foreground),
            "focus-left" => self.focus(foreground, FocusDirection::Left),
            "focus-right" => self.focus(foreground, FocusDirection::Right),
            "focus-up" => self.focus(foreground, FocusDirection::Up),
            "focus-down" => self.focus(foreground, FocusDirection::Down),
            _ => Err(format!("Unknown window action: {action}")),
        }
    }

    pub fn execute_for(&self, hwnd: HWND, action: &str) -> Result<(), String> {
        if let Some(placement) = Placement::parse(action) {
            return self.place(hwnd, placement);
        }
        match action {
            "undo" => self.undo(hwnd),
            "restore" => self.restore(hwnd),
            "next-display" => self.move_display(hwnd, 1),
            "previous-display" => self.move_display(hwnd, -1),
            "grow" => self.scale(hwnd, 1.1),
            "shrink" => self.scale(hwnd, 0.9),
            "arrange-display" => self.arrange_display(hwnd),
            "cascade" => self.cascade(hwnd),
            "tile-app" => self.tile_application(hwnd),
            "gather-all" => self.gather_all(hwnd),
            "pair-previous" => self.pair_previous(hwnd),
            "focus-left" => self.focus(hwnd, FocusDirection::Left),
            "focus-right" => self.focus(hwnd, FocusDirection::Right),
            "focus-up" => self.focus(hwnd, FocusDirection::Up),
            "focus-down" => self.focus(hwnd, FocusDirection::Down),
            _ => Err(format!("Unknown window action: {action}")),
        }
    }

    pub fn capture_frame(&self, hwnd: HWND) -> Result<SceneFrame, String> {
        let current = window_rect(hwnd)?;
        let area = work_area(hwnd)?;
        let monitors = monitor_work_areas();
        let monitor_index = monitors
            .iter()
            .position(|monitor| monitor.approximately(area, 2.0))
            .unwrap_or(0);
        let unit = UnitRect::from_rect(current, area);
        Ok(SceneFrame {
            x: unit.x,
            y: unit.y,
            width: unit.width,
            height: unit.height,
            monitor_index,
        })
    }

    pub fn restore_frame(&self, hwnd: HWND, frame: &SceneFrame) -> Result<(), String> {
        let monitors = monitor_work_areas();
        let visible = monitors
            .get(frame.monitor_index)
            .copied()
            .or_else(|| monitors.first().copied())
            .ok_or_else(|| "No display is available".to_string())?;
        let current = window_rect(hwnd)?;
        self.remember(hwnd, current);
        move_window(
            hwnd,
            UnitRect::new(frame.x, frame.y, frame.width, frame.height).resolve(visible, 0.0),
        )
    }

    fn place(&self, hwnd: HWND, placement: Placement) -> Result<(), String> {
        let current = window_rect(hwnd)?;
        let visible = work_area(hwnd)?;
        let preferences = *self.preferences.lock();
        self.remember(hwnd, current);
        let next = geometry::target(
            placement,
            current,
            visible,
            preferences.gap,
            preferences.cycling,
        );
        move_window(hwnd, next)
    }

    fn undo(&self, hwnd: HWND) -> Result<(), String> {
        let key = hwnd.0 as isize;
        let frame = self
            .history
            .lock()
            .get_mut(&key)
            .and_then(Vec::pop)
            .ok_or_else(|| "No previous Gravity layout for this window".to_string())?;
        move_window(hwnd, frame)
    }

    fn restore(&self, hwnd: HWND) -> Result<(), String> {
        let key = hwnd.0 as isize;
        let frame = self
            .originals
            .lock()
            .remove(&key)
            .ok_or_else(|| "No original window frame has been recorded".to_string())?;
        self.remember(hwnd, window_rect(hwnd)?);
        move_window(hwnd, frame)
    }

    fn scale(&self, hwnd: HWND, factor: f64) -> Result<(), String> {
        let current = window_rect(hwnd)?;
        self.remember(hwnd, current);
        move_window(hwnd, geometry::scaled(current, factor, work_area(hwnd)?))
    }

    fn move_display(&self, hwnd: HWND, delta: isize) -> Result<(), String> {
        let monitors = monitor_work_areas();
        if monitors.len() < 2 {
            return Err("Only one display is available".into());
        }
        let current_frame = window_rect(hwnd)?;
        let current_area = work_area(hwnd)?;
        let current = monitors
            .iter()
            .position(|area| area.approximately(current_area, 2.0))
            .unwrap_or(0);
        let next = (current as isize + delta).rem_euclid(monitors.len() as isize) as usize;
        self.remember(hwnd, current_frame);
        move_window(hwnd, geometry::transpose(current_frame, current_area, monitors[next]))
    }

    fn arrange_display(&self, foreground: HWND) -> Result<(), String> {
        let area = work_area(foreground)?;
        let windows: Vec<_> = eligible_windows()
            .into_iter()
            .filter(|hwnd| work_area(*hwnd).is_ok_and(|candidate| candidate.approximately(area, 2.0)))
            .collect();
        let gap = self.preferences.lock().gap;
        self.apply_frames(&windows, geometry::grid_frames(windows.len(), area, gap))
    }

    fn cascade(&self, foreground: HWND) -> Result<(), String> {
        let area = work_area(foreground)?;
        let windows: Vec<_> = eligible_windows()
            .into_iter()
            .filter(|hwnd| work_area(*hwnd).is_ok_and(|candidate| candidate.approximately(area, 2.0)))
            .collect();
        self.apply_frames(&windows, geometry::cascade_frames(windows.len(), area))
    }

    fn tile_application(&self, foreground: HWND) -> Result<(), String> {
        let pid = process_id(foreground);
        let area = work_area(foreground)?;
        let windows: Vec<_> = eligible_windows()
            .into_iter()
            .filter(|hwnd| process_id(*hwnd) == pid)
            .collect();
        let gap = self.preferences.lock().gap;
        self.apply_frames(&windows, geometry::grid_frames(windows.len(), area, gap))
    }

    fn gather_all(&self, foreground: HWND) -> Result<(), String> {
        let destination = work_area(foreground)?;
        for hwnd in eligible_windows() {
            let current = window_rect(hwnd)?;
            let source = work_area(hwnd)?;
            if !source.approximately(destination, 2.0) {
                self.remember(hwnd, current);
                move_window(hwnd, geometry::transpose(current, source, destination))?;
            }
        }
        Ok(())
    }

    fn pair_previous(&self, foreground: HWND) -> Result<(), String> {
        let partner = eligible_windows()
            .into_iter()
            .find(|candidate| *candidate != foreground)
            .ok_or_else(|| "No second window is available".to_string())?;
        let area = work_area(foreground)?;
        let gap = self.preferences.lock().gap;
        let left = geometry::target(Placement::LeftHalf, window_rect(foreground)?, area, gap, false);
        let right = geometry::target(Placement::RightHalf, window_rect(partner)?, area, gap, false);
        self.remember(foreground, window_rect(foreground)?);
        self.remember(partner, window_rect(partner)?);
        move_window(foreground, left)?;
        move_window(partner, right)?;
        unsafe {
            let _ = SetForegroundWindow(foreground);
        }
        Ok(())
    }

    fn focus(&self, foreground: HWND, direction: FocusDirection) -> Result<(), String> {
        let candidates: Vec<_> = eligible_windows()
            .into_iter()
            .filter(|candidate| *candidate != foreground)
            .collect();
        let frames: Vec<_> = candidates
            .iter()
            .filter_map(|hwnd| window_rect(*hwnd).ok())
            .collect();
        let index = geometry::nearest(window_rect(foreground)?, &frames, direction)
            .ok_or_else(|| "No window exists in that direction".to_string())?;
        unsafe {
            let _ = ShowWindow(candidates[index], SW_RESTORE);
            let _ = SetForegroundWindow(candidates[index]);
        }
        Ok(())
    }

    fn apply_frames(&self, windows: &[HWND], frames: Vec<Rect>) -> Result<(), String> {
        if windows.is_empty() {
            return Err("No manageable windows were found".into());
        }
        for (hwnd, frame) in windows.iter().zip(frames) {
            self.remember(*hwnd, window_rect(*hwnd)?);
            move_window(*hwnd, frame)?;
        }
        Ok(())
    }

    fn remember(&self, hwnd: HWND, frame: Rect) {
        let key = hwnd.0 as isize;
        self.originals.lock().entry(key).or_insert(frame);
        let mut histories = self.history.lock();
        let history = histories.entry(key).or_default();
        if history
            .last()
            .map_or(true, |last| !last.approximately(frame, 2.0))
        {
            history.push(frame);
            if history.len() > HISTORY_DEPTH {
                history.remove(0);
            }
        }
    }
}

fn process_id(hwnd: HWND) -> u32 {
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

fn window_rect(hwnd: HWND) -> Result<Rect, String> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|error| error.to_string())?;
    Ok(Rect::new(
        rect.left as f64,
        rect.top as f64,
        (rect.right - rect.left) as f64,
        (rect.bottom - rect.top) as f64,
    ))
}

fn work_area(hwnd: HWND) -> Result<Rect, String> {
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    monitor_info(monitor)
}

fn monitor_info(monitor: HMONITOR) -> Result<Rect, String> {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err("Could not read monitor work area".into());
    }
    let rect = info.rcWork;
    Ok(Rect::new(
        rect.left as f64,
        rect.top as f64,
        (rect.right - rect.left) as f64,
        (rect.bottom - rect.top) as f64,
    ))
}

unsafe extern "system" fn enum_monitor(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let monitors = &mut *(data.0 as *mut Vec<Rect>);
    if let Ok(area) = monitor_info(monitor) {
        monitors.push(area);
    }
    TRUE
}

fn monitor_work_areas() -> Vec<Rect> {
    let mut monitors: Vec<Rect> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_monitor),
            LPARAM(&mut monitors as *mut _ as isize),
        );
    }
    monitors.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    monitors
}

unsafe extern "system" fn enum_window(hwnd: HWND, data: LPARAM) -> BOOL {
    let windows = &mut *(data.0 as *mut Vec<HWND>);
    if !IsWindowVisible(hwnd).as_bool()
        || IsIconic(hwnd).as_bool()
        || GetWindowTextLengthW(hwnd) == 0
        || GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0
        || process_id(hwnd) == GetCurrentProcessId()
    {
        return TRUE;
    }
    windows.push(hwnd);
    TRUE
}

fn eligible_windows() -> Vec<HWND> {
    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_window), LPARAM(&mut windows as *mut _ as isize));
    }
    windows
}

fn move_window(hwnd: HWND, frame: Rect) -> Result<(), String> {
    unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
        SetWindowPos(
            hwnd,
            HWND_TOP,
            frame.x.round() as i32,
            frame.y.round() as i32,
            frame.width.round() as i32,
            frame.height.round() as i32,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    }
    .map_err(|error| error.to_string())
}
