//! Mock backend so the project builds and type-checks off-Windows (macOS dev).
//! Mirrors the TypeScript `MockShell` closely enough to smoke-test IPC.

use parking_lot::Mutex;

use super::ShellPlatform;
use crate::shell::{
    AppearanceState, AppInfo, OrbitSpace, SceneFrame, SceneWindow, ShellState, SystemStatus,
    WindowInfo, WindowRule, WindowScene, WindowingState,
};

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
            appearance: AppearanceState::default(),
            windowing: WindowingState::default(),
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
    fn window_action(&self, _action: &str) -> Result<(), String> {
        Ok(())
    }
    fn window_action_for(&self, _window_id: &str, _action: &str) -> Result<(), String> {
        Ok(())
    }
    fn configure_windowing(&self, _gap: u32, _cycling: bool) {}
    fn configure_rules(&self, _rules: &[WindowRule]) {}
    fn capture_scene(&self, name: &str) -> Result<WindowScene, String> {
        let state = self.state.lock();
        Ok(WindowScene {
            id: format!("scene-{}", state.windows.len()),
            name: name.to_string(),
            created_at: 0,
            windows: state
                .windows
                .iter()
                .map(|window| SceneWindow {
                    app_id: window.app_id.clone(),
                    title: window.title.clone(),
                    frame: SceneFrame {
                        x: 0.1,
                        y: 0.1,
                        width: 0.8,
                        height: 0.8,
                        monitor_index: 0,
                    },
                })
                .collect(),
        })
    }
    fn restore_scene(&self, _scene: &WindowScene) -> Result<(), String> {
        Ok(())
    }
    fn launch_app(&self, _app_id: &str) -> Result<(), String> {
        Ok(())
    }
    fn set_volume(&self, value: f32) {
        self.state.lock().status.volume = value.clamp(0.0, 1.0);
    }
    fn set_brightness(&self, value: f32) -> Result<(), String> {
        self.state.lock().status.brightness = Some(value.clamp(0.0, 1.0));
        Ok(())
    }
    fn toggle_setting(&self, key: &str) -> Result<(), String> {
        let mut s = self.state.lock();
        match key {
            "wifi" => s.status.online = !s.status.online,
            "bluetooth" => s.status.bluetooth = !s.status.bluetooth,
            "focus" => s.status.focus = !s.status.focus,
            _ => {}
        }
        Ok(())
    }
    fn empty_trash(&self) {
        self.state.lock().status.trash_full = false;
    }
    fn switch_orbit(&self, id: &str) {
        self.state.lock().active_orbit = id.to_string();
    }
    fn move_window_to_orbit(&self, window_id: &str, orbit_id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let window = state
            .windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| "That window is no longer available".to_string())?;
        window.orbit_id = orbit_id.to_string();
        Ok(())
    fn dismiss_notification(&self, id: &str) {
        self.state.lock().notifications.retain(|n| n.id != id);
    }
    fn engage_shell(&self) {}
    fn disengage_shell(&self) {}
}
