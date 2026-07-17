//! Mock backend so the project builds and type-checks off-Windows (macOS dev).
//! Mirrors the TypeScript `MockShell` closely enough to smoke-test IPC.

use parking_lot::Mutex;

use super::ShellPlatform;
use crate::shell::{AppInfo, OrbitSpace, ShellState, SystemStatus, WindowInfo};

pub struct MockPlatform {
    state: Mutex<ShellState>,
}

impl MockPlatform {
    pub fn new() -> Self {
        let apps = vec![
            AppInfo::new("Files", None, true),
            AppInfo::new("Edge", None, true),
            AppInfo::new("Mail", None, true),
            AppInfo::new("Terminal", None, true),
            AppInfo::new("Code", None, true),
            AppInfo::new("Settings", None, true),
            AppInfo::new("Calculator", None, false),
        ];
        let windows = vec![
            WindowInfo {
                id: "w1".into(),
                app_id: "edge".into(),
                title: "Gravity OS".into(),
                minimized: false,
                focused: true,
                orbit_id: "o1".into(),
            },
            WindowInfo {
                id: "w2".into(),
                app_id: "code".into(),
                title: "orbit.tsx — Gravity-OS".into(),
                minimized: false,
                focused: false,
                orbit_id: "o1".into(),
            },
        ];
        let state = ShellState {
            apps,
            windows,
            status: SystemStatus {
                battery_percent: Some(87),
                online: true,
                network: Some("Deep Field 5G".into()),
                volume: 0.6,
                brightness: Some(0.8),
                bluetooth: true,
                trash_full: true,
                ..Default::default()
            },
            orbits: vec![
                OrbitSpace { id: "o1".into(), name: "Orbit 1".into() },
                OrbitSpace { id: "o2".into(), name: "Orbit 2".into() },
            ],
            active_orbit: "o1".into(),
            notifications: Vec::new(),
        };
        Self { state: Mutex::new(state) }
    }
}

impl ShellPlatform for MockPlatform {
    fn snapshot(&self) -> ShellState {
        self.state.lock().clone()
    }
    fn focus_window(&self, id: &str) {
        let mut s = self.state.lock();
        for w in &mut s.windows {
            w.focused = w.id == id;
            if w.id == id {
                w.minimized = false;
            }
        }
    }
    fn minimize_window(&self, id: &str) {
        let mut s = self.state.lock();
        for w in &mut s.windows {
            if w.id == id {
                w.minimized = true;
                w.focused = false;
            }
        }
    }
    fn close_window(&self, id: &str) {
        self.state.lock().windows.retain(|w| w.id != id);
    }
    fn launch_app(&self, _app_id: &str) {}
    fn set_volume(&self, value: f32) {
        self.state.lock().status.volume = value.clamp(0.0, 1.0);
    }
    fn set_brightness(&self, value: f32) {
        self.state.lock().status.brightness = Some(value.clamp(0.0, 1.0));
    }
    fn toggle_setting(&self, key: &str) {
        let mut s = self.state.lock();
        match key {
            "wifi" => s.status.online = !s.status.online,
            "bluetooth" => s.status.bluetooth = !s.status.bluetooth,
            "focus" => s.status.focus = !s.status.focus,
            _ => {}
        }
    }
    fn empty_trash(&self) {
        self.state.lock().status.trash_full = false;
    }
    fn switch_orbit(&self, id: &str) {
        self.state.lock().active_orbit = id.to_string();
    }
    fn dismiss_notification(&self, id: &str) {
        self.state.lock().notifications.retain(|n| n.id != id);
    }
    fn engage_shell(&self) {}
    fn disengage_shell(&self) {}
}
