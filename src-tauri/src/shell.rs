//! Shared shell state — the Rust mirror of `src/shell/types.ts`.
//! Serialized to the frontend as camelCase JSON so the TypeScript
//! `ShellState` deserializes it directly.

use serde::{Deserialize, Serialize};

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
    pub focused: bool,
    pub orbit_id: String,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub apps: Vec<AppInfo>,
    pub windows: Vec<WindowInfo>,
    pub status: SystemStatus,
    pub orbits: Vec<OrbitSpace>,
    pub active_orbit: String,
    pub notifications: Vec<PulseNote>,
}
