//! Shared shell state — the Rust mirror of `src/shell/types.ts`.
//! Serialized to the frontend as camelCase JSON so the TypeScript
//! `ShellState` deserializes it directly.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResolvedAppearance {
    Light,
    #[default]
    Dark,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceState {
    pub mode: AppearanceMode,
    pub resolved: ResolvedAppearance,
    pub wallpaper_id: String,
}

impl Default for AppearanceState {
    fn default() -> Self {
        Self {
            mode: AppearanceMode::System,
            resolved: ResolvedAppearance::Dark,
            wallpaper_id: "deep-field".into(),
        }
    }
}

fn hue_of(name: &str) -> u32 {
    let mut h: u32 = 0;
    for b in name.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    h % 360
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exe: Option<String>,
    pub pinned: bool,
    pub hue: u32,
}

impl AppInfo {
    pub fn new(name: &str, exe: Option<String>, pinned: bool) -> Self {
        Self {
            id: name.to_lowercase().replace(' ', "-"),
            name: name.to_string(),
            exe,
            pinned,
            hue: hue_of(name),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: String,
    pub app_id: String,
    pub title: String,
    pub minimized: bool,
    pub maximized: bool,
    pub focused: bool,
    pub orbit_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parked_well_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub battery_percent: Option<u32>,
    pub charging: bool,
    pub online: bool,
    pub network: Option<String>,
    pub volume: f32,
    pub brightness: Option<f32>,
    pub focus: bool,
    pub bluetooth: bool,
    pub trash_full: bool,
}

impl Default for SystemStatus {
    fn default() -> Self {
        Self {
            battery_percent: None,
            charging: false,
            online: true,
            network: None,
            volume: 0.5,
            brightness: None,
            focus: false,
            bluetooth: false,
            trash_full: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitSpace {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PulseNote {
    pub id: String,
    pub app_name: String,
    pub hue: u32,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub monitor_index: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneWindow {
    pub app_id: String,
    pub title: String,
    pub frame: SceneFrame,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowScene {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub windows: Vec<SceneWindow>,
    #[serde(default)]
    pub auto_restore: bool,
    #[serde(default)]
    pub display_fingerprint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRule {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub action: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowingState {
    pub gap: u32,
    pub cycling: bool,
    pub scenes: Vec<WindowScene>,
    pub rules: Vec<WindowRule>,
    pub ignored_app_ids: Vec<String>,
    pub launch_at_login: bool,
    pub scene_auto_restore: bool,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for WindowingState {
    fn default() -> Self {
        Self {
            gap: 10,
            cycling: true,
            scenes: Vec::new(),
            rules: Vec::new(),
            ignored_app_ids: Vec::new(),
            launch_at_login: false,
            scene_auto_restore: true,
            shortcuts: crate::settings::default_shortcuts(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShellMode {
    Windows,
    EnteringGravity,
    #[default]
    Gravity,
    LeavingGravity,
    Faulted,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellTransitionResult {
    pub mode: ShellMode,
    pub active: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub apps: Vec<AppInfo>,
    pub windows: Vec<WindowInfo>,
    pub status: SystemStatus,
    pub orbits: Vec<OrbitSpace>,
    pub active_orbit: String,
    pub notifications: Vec<PulseNote>,
    pub appearance: AppearanceState,
    pub windowing: WindowingState,
    pub shell_mode: ShellMode,
}
