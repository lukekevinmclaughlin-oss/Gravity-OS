//! Mock backend so the project builds and type-checks without native Windows APIs.
//! Mirrors the TypeScript `MockShell` closely enough to smoke-test IPC.

use parking_lot::Mutex;

use super::ShellPlatform;
use crate::shell::{
    AppInfo, AppearanceState, NowPlaying, OrbitSpace, SceneFrame, SceneWindow, ShellMode,
    ShellState, SystemStatus, WindowInfo, WindowRule, WindowScene, WindowingState,
};

pub struct MockPlatform {
    state: Mutex<ShellState>,
    show_desktop_stack: Mutex<Vec<String>>,
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
                maximized: false,
                focused: true,
                orbit_id: "o1".into(),
                parked_well_id: None,
            },
            WindowInfo {
                id: "w2".into(),
                app_id: "code".into(),
                title: "orbit.tsx — Gravity-OS".into(),
                minimized: false,
                maximized: false,
                focused: false,
                orbit_id: "o1".into(),
                parked_well_id: None,
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
                now_playing: Some(NowPlaying {
                    title: "Deep Field Radio".into(),
                    artist: "Gravity".into(),
                    playing: true,
                    source_app: "music".into(),
                }),
                ..Default::default()
            },
            orbits: vec![
                OrbitSpace {
                    id: "o1".into(),
                    name: "Orbit 1".into(),
                },
                OrbitSpace {
                    id: "o2".into(),
                    name: "Orbit 2".into(),
                },
            ],
            active_orbit: "o1".into(),
            notifications: Vec::new(),
            appearance: AppearanceState::default(),
            windowing: WindowingState::default(),
            shell_mode: crate::shell::ShellMode::Gravity,
        };
        Self {
            state: Mutex::new(state),
            show_desktop_stack: Mutex::new(Vec::new()),
        }
    }
}

impl ShellPlatform for MockPlatform {
    fn snapshot(&self) -> ShellState {
        self.state.lock().clone()
    }
    fn focus_window(&self, id: &str) -> Result<(), String> {
        let mut s = self.state.lock();
        if !s.windows.iter().any(|window| window.id == id) {
            return Err("That window is no longer available".into());
        }
        for w in &mut s.windows {
            w.focused = w.id == id;
            if w.id == id {
                w.minimized = false;
                w.parked_well_id = None;
            }
        }
        Ok(())
    }
    fn minimize_window(&self, id: &str) -> Result<(), String> {
        let mut s = self.state.lock();
        if !s.windows.iter().any(|window| window.id == id) {
            return Err("That window is no longer available".into());
        }
        for w in &mut s.windows {
            if w.id == id {
                w.minimized = true;
                w.focused = false;
            }
        }
        Ok(())
    }
    fn toggle_maximize_window(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        if !state.windows.iter().any(|window| window.id == id) {
            return Err("That window is no longer available".into());
        }
        for window in &mut state.windows {
            if window.id == id {
                window.maximized = !window.maximized;
                window.minimized = false;
                window.focused = true;
            } else {
                window.focused = false;
            }
        }
        Ok(())
    }
    fn close_window(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let before = state.windows.len();
        state.windows.retain(|window| window.id != id);
        if state.windows.len() == before {
            return Err("That window is no longer available".into());
        }
        Ok(())
    }
    fn active_window_control(&self, kind: &str) -> Result<(), String> {
        let target = {
            let state = self.state.lock();
            state
                .windows
                .iter()
                .find(|window| window.focused && !window.minimized)
                .or_else(|| state.windows.iter().find(|window| !window.minimized))
                .map(|window| window.id.clone())
        }
        .ok_or_else(|| "There is no active application window to control".to_string())?;
        match kind {
            "close" => self.close_window(&target),
            "minimize" => self.minimize_window(&target),
            "zoom" => self.toggle_maximize_window(&target),
            _ => Err("Unknown active-window control".into()),
        }
    }
    fn window_action(&self, action: &str) -> Result<(), String> {
        let focused = self
            .state
            .lock()
            .windows
            .iter()
            .find(|window| window.focused && !window.minimized)
            .map(|window| window.id.clone())
            .ok_or_else(|| "There is no active window to arrange".to_string())?;
        self.window_action_for(&focused, action)
    }
    fn window_action_for(&self, window_id: &str, action: &str) -> Result<(), String> {
        if crate::geometry::Placement::parse(action).is_none() {
            return Err(format!("Unknown window placement: {action}"));
        }
        self.focus_window(window_id)?;
        if let Some(window) = self
            .state
            .lock()
            .windows
            .iter_mut()
            .find(|window| window.id == window_id)
        {
            window.maximized = false;
        }
        Ok(())
    }
    fn apply_grid_region(
        &self,
        window_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        if x < 0.0
            || y < 0.0
            || width <= 0.0
            || height <= 0.0
            || x + width > 1.0
            || y + height > 1.0
        {
            return Err("Grid regions must stay inside the visible display".into());
        }
        self.focus_window(window_id)
    }
    fn apply_grid_region_on_monitor(
        &self,
        window_id: &str,
        _monitor: usize,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        self.apply_grid_region(window_id, x, y, width, height)
    }
    fn warp_window(&self, window_id: &str, operation: &str) -> Result<(), String> {
        if !matches!(
            operation,
            "move-left"
                | "move-right"
                | "move-up"
                | "move-down"
                | "shrink-width"
                | "grow-width"
                | "shrink-height"
                | "grow-height"
        ) {
            return Err(format!("Unknown Warp operation: {operation}"));
        }
        self.focus_window(window_id)
    }
    fn park_window(&self, window_id: &str, well_id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let window = state
            .windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| "That window is no longer available".to_string())?;
        window.parked_well_id = Some(well_id.to_string());
        window.focused = false;
        Ok(())
    }
    fn release_window(&self, window_id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let window = state
            .windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| "That window is no longer available".to_string())?;
        if window.parked_well_id.take().is_none() {
            return Err("That window is not stored in a desktop shape".into());
        }
        window.focused = true;
        Ok(())
    }
    fn release_all_parked_windows(&self) -> Result<(), String> {
        for window in &mut self.state.lock().windows {
            window.parked_well_id = None;
        }
        Ok(())
    }
    fn open_trash(&self) -> Result<(), String> {
        Ok(())
    }
    fn media_control(&self, kind: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        match state.status.now_playing.as_mut() {
            Some(now_playing) => match kind {
                "play-pause" => {
                    now_playing.playing = !now_playing.playing;
                    Ok(())
                }
                "next" | "previous" => Ok(()),
                _ => Err("Unknown media control".into()),
            },
            None => Err("No application is playing media right now".into()),
        }
    }
    fn toggle_show_desktop(&self) -> Result<bool, String> {
        let mut state = self.state.lock();
        let mut stack = self.show_desktop_stack.lock();
        let restorable: Vec<String> = stack
            .iter()
            .filter(|id| {
                state
                    .windows
                    .iter()
                    .any(|window| &window.id == *id && window.minimized)
            })
            .cloned()
            .collect();
        if !restorable.is_empty() {
            for window in &mut state.windows {
                if restorable.contains(&window.id) {
                    window.minimized = false;
                }
            }
            stack.clear();
            return Ok(false);
        }
        *stack = state
            .windows
            .iter()
            .filter(|window| !window.minimized && window.parked_well_id.is_none())
            .map(|window| window.id.clone())
            .collect();
        let targets = stack.clone();
        for window in &mut state.windows {
            if targets.contains(&window.id) {
                window.minimized = true;
                window.focused = false;
            }
        }
        Ok(true)
    }
    fn configure_windowing(&self, gap: u32, cycling: bool) {
        let mut state = self.state.lock();
        state.windowing.gap = gap;
        state.windowing.cycling = cycling;
    }
    fn configure_rules(&self, rules: &[WindowRule]) {
        self.state.lock().windowing.rules = rules.to_vec();
    }
    fn configure_ignored(&self, app_ids: &[String]) {
        self.state.lock().windowing.ignored_app_ids = app_ids.to_vec();
    }
    fn current_display_fingerprint(&self) -> String {
        "mock-display".into()
    }
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
            auto_restore: false,
            display_fingerprint: "mock-display".into(),
        })
    }
    fn restore_scene(&self, scene: &WindowScene) -> Result<(), String> {
        let mut state = self.state.lock();
        let orbit_id = state.active_orbit.clone();
        let app_ids = state
            .apps
            .iter()
            .map(|app| app.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let mut restored = Vec::new();
        for (index, scene_window) in scene.windows.iter().enumerate() {
            if app_ids.contains(&scene_window.app_id) {
                restored.push(WindowInfo {
                    id: format!("mock-scene-{}-{index}", scene.id),
                    app_id: scene_window.app_id.clone(),
                    title: scene_window.title.clone(),
                    minimized: false,
                    maximized: false,
                    focused: index == 0,
                    orbit_id: orbit_id.clone(),
                    parked_well_id: None,
                });
            }
        }
        if restored.is_empty() {
            return Err("None of the applications in this Scene are installed".into());
        }
        for window in &mut state.windows {
            window.focused = false;
        }
        state.windows.extend(restored);
        Ok(())
    }
    fn launch_app(&self, app_id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let app = state
            .apps
            .iter()
            .find(|app| app.id == app_id)
            .cloned()
            .ok_or_else(|| "That application is no longer installed".to_string())?;
        for window in &mut state.windows {
            window.focused = false;
        }
        let id = format!("mock-{}-{}", app_id, state.windows.len() + 1);
        let orbit_id = state.active_orbit.clone();
        state.windows.push(WindowInfo {
            id,
            app_id: app.id,
            title: app.name,
            minimized: false,
            maximized: false,
            focused: true,
            orbit_id,
            parked_well_id: None,
        });
        Ok(())
    }
    fn launch_app_with_files(&self, app_id: &str, paths: &[String]) -> Result<(), String> {
        if paths.is_empty() {
            return Err("Drop at least one file onto an application".into());
        }
        self.launch_app(app_id)
    }
    fn set_volume(&self, value: f32) -> Result<(), String> {
        self.state.lock().status.volume = value.clamp(0.0, 1.0);
        Ok(())
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
            _ => return Err(format!("Unknown setting: {key}")),
        }
        Ok(())
    }
    fn empty_trash(&self) -> Result<(), String> {
        self.state.lock().status.trash_full = false;
        Ok(())
    }
    fn switch_orbit(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        if !state.orbits.iter().any(|orbit| orbit.id == id) {
            return Err("That Orbit does not exist".into());
        }
        let target = state
            .windows
            .iter()
            .find(|window| window.orbit_id == id && !window.minimized)
            .map(|window| window.id.clone());
        state.active_orbit = id.to_string();
        for window in &mut state.windows {
            window.focused = target.as_deref() == Some(window.id.as_str());
        }
        Ok(())
    }
    fn move_window_to_orbit(&self, window_id: &str, orbit_id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        if !state.orbits.iter().any(|orbit| orbit.id == orbit_id) {
            return Err("That Orbit does not exist".into());
        }
        let window = state
            .windows
            .iter_mut()
            .find(|window| window.id == window_id)
            .ok_or_else(|| "That window is no longer available".to_string())?;
        window.orbit_id = orbit_id.to_string();
        Ok(())
    }
    fn dismiss_notification(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock();
        let before = state.notifications.len();
        state
            .notifications
            .retain(|notification| notification.id != id);
        if state.notifications.len() == before {
            return Err("That notification is no longer available".into());
        }
        Ok(())
    }
    fn engage_shell(&self) {
        self.state.lock().shell_mode = ShellMode::Gravity;
    }
    fn disengage_shell(&self) {
        self.state.lock().shell_mode = ShellMode::Windows;
    }
}
