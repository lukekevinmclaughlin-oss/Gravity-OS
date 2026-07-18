//! Persisted shell settings shared by every Gravity surface.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::shell::{
    AppInfo, AppearanceMode, AppearanceState, ResolvedAppearance, ShellState, WindowRule,
    WindowScene, WindowingState,
};

fn default_wallpaper() -> String {
    "deep-field".into()
}

const SHORTCUT_SCHEMA_VERSION: u32 = 2;
const SHORTCUT_SCHEMA_V2_ACTIONS: &[&str] = &[
    "open-window-studio",
    "minimize-active",
    "close-active",
    "toggle-appearance",
    "new-well",
    "store-well-1",
    "store-well-2",
    "store-well-3",
    "store-well-4",
    "store-well-5",
    "store-well-6",
    "store-well-7",
    "store-well-8",
    "store-well-9",
];

pub fn default_shortcuts() -> BTreeMap<String, String> {
    [
        ("left-half", "ctrl+alt+left"),
        ("right-half", "ctrl+alt+right"),
        ("top-half", "ctrl+alt+up"),
        ("bottom-half", "ctrl+alt+down"),
        ("top-left", "ctrl+alt+u"),
        ("top-right", "ctrl+alt+i"),
        ("bottom-left", "ctrl+alt+j"),
        ("bottom-right", "ctrl+alt+k"),
        ("first-third", "ctrl+alt+d"),
        ("center-third", "ctrl+alt+f"),
        // Ctrl+Alt+G is permanently reserved for the critical Windows handoff.
        ("last-third", "ctrl+alt+h"),
        ("first-two-thirds", "ctrl+alt+e"),
        ("last-two-thirds", "ctrl+alt+t"),
        ("maximize", "ctrl+alt+enter"),
        ("almost-maximize", "ctrl+alt+shift+enter"),
        ("center", "ctrl+alt+c"),
        ("restore", "ctrl+alt+r"),
        ("undo", "ctrl+alt+z"),
        ("previous-display", "ctrl+alt+super+left"),
        ("next-display", "ctrl+alt+super+right"),
        ("tile-app", "ctrl+alt+a"),
        ("gather-all", "ctrl+alt+m"),
        ("arrange-display", "ctrl+alt+shift+a"),
        ("pair-previous", "ctrl+alt+p"),
        ("cascade", "ctrl+alt+b"),
        ("grow", "ctrl+alt+pageup"),
        ("shrink", "ctrl+alt+pagedown"),
        ("focus-left", "ctrl+alt+shift+left"),
        ("focus-right", "ctrl+alt+shift+right"),
        ("focus-up", "ctrl+alt+shift+up"),
        ("focus-down", "ctrl+alt+shift+down"),
        ("grid-picker", "ctrl+alt+space"),
        ("warp-mode", "ctrl+alt+w"),
        ("save-scene", "ctrl+alt+shift+s"),
        ("restore-scene", "ctrl+alt+s"),
        // Windows reserves every Alt+Tab variant, so use the closest free chord.
        ("toggle-shapes", "ctrl+alt+o"),
        ("equalize-shapes", "ctrl+alt+shift+e"),
        ("release-parked-windows", "ctrl+alt+shift+o"),
        ("open-window-studio", "ctrl+alt+0"),
        ("minimize-active", "ctrl+alt+n"),
        ("close-active", "ctrl+alt+q"),
        ("toggle-appearance", "ctrl+alt+y"),
        ("new-well", "ctrl+alt+shift+n"),
        ("store-well-1", "ctrl+alt+1"),
        ("store-well-2", "ctrl+alt+2"),
        ("store-well-3", "ctrl+alt+3"),
        ("store-well-4", "ctrl+alt+4"),
        ("store-well-5", "ctrl+alt+5"),
        ("store-well-6", "ctrl+alt+6"),
        ("store-well-7", "ctrl+alt+7"),
        ("store-well-8", "ctrl+alt+8"),
        ("store-well-9", "ctrl+alt+9"),
    ]
    .into_iter()
    .map(|(action, binding)| (action.into(), binding.into()))
    .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct UserSettings {
    /// `None` preserves the curated catalog defaults until the first edit.
    pinned_app_ids: Option<Vec<String>>,
    appearance: AppearanceMode,
    wallpaper_id: String,
    window_gap: u32,
    cycling: bool,
    scenes: Vec<WindowScene>,
    rules: Vec<WindowRule>,
    ignored_app_ids: Vec<String>,
    launch_at_login: bool,
    scene_auto_restore: bool,
    shortcuts: BTreeMap<String, String>,
    shortcut_schema_version: u32,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            pinned_app_ids: None,
            appearance: AppearanceMode::System,
            wallpaper_id: default_wallpaper(),
            window_gap: 10,
            cycling: true,
            scenes: Vec::new(),
            rules: Vec::new(),
            ignored_app_ids: Vec::new(),
            launch_at_login: false,
            scene_auto_restore: true,
            shortcuts: default_shortcuts(),
            shortcut_schema_version: 0,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<UserSettings>,
}

impl SettingsStore {
    pub fn load() -> Self {
        let path = settings_path();
        let mut inner: UserSettings = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        if inner.shortcut_schema_version < SHORTCUT_SCHEMA_VERSION {
            let defaults = default_shortcuts();
            for action in SHORTCUT_SCHEMA_V2_ACTIONS {
                if let Some(binding) = defaults.get(*action) {
                    inner
                        .shortcuts
                        .entry((*action).to_string())
                        .or_insert_with(|| binding.clone());
                }
            }
            inner.shortcut_schema_version = SHORTCUT_SCHEMA_VERSION;
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(bytes) = serde_json::to_vec_pretty(&inner) {
                let _ = std::fs::write(&path, bytes);
            }
        }
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    pub fn apply_to_state(&self, state: &mut ShellState) {
        let settings = self.inner.lock().clone();
        apply_pins(&settings, &mut state.apps);
        state.appearance = appearance_state(&settings);
        state.windowing = WindowingState {
            gap: settings.window_gap,
            cycling: settings.cycling,
            scenes: settings.scenes,
            rules: settings.rules,
            ignored_app_ids: settings.ignored_app_ids,
            launch_at_login: settings.launch_at_login,
            scene_auto_restore: settings.scene_auto_restore,
            shortcuts: settings.shortcuts,
        };
    }

    pub fn set_app_pinned(
        &self,
        catalog: &[AppInfo],
        app_id: &str,
        pinned: bool,
    ) -> Result<(), String> {
        if !catalog.iter().any(|app| app.id == app_id) {
            return Err(format!("Application '{app_id}' is no longer installed."));
        }
        let mut settings = self.inner.lock();
        let mut ids = effective_pins(&settings, catalog);
        ids.retain(|id| id != app_id);
        if pinned {
            ids.push(app_id.to_string());
        }
        settings.pinned_app_ids = Some(ids);
        self.save_locked(&settings)
    }

    pub fn reorder_pinned(&self, catalog: &[AppInfo], ids: Vec<String>) -> Result<(), String> {
        let mut settings = self.inner.lock();
        let current = effective_pins(&settings, catalog);
        if ids.len() != current.len()
            || ids.iter().any(|id| !current.contains(id))
            || current.iter().any(|id| !ids.contains(id))
        {
            return Err("Dock order did not match the current pinned applications.".into());
        }
        settings.pinned_app_ids = Some(ids);
        self.save_locked(&settings)
    }

    pub fn set_appearance(&self, mode: AppearanceMode) -> Result<(), String> {
        let mut settings = self.inner.lock();
        settings.appearance = mode;
        self.save_locked(&settings)
    }

    pub fn set_wallpaper(&self, wallpaper_id: String) -> Result<(), String> {
        if wallpaper_id.trim().is_empty()
            || !wallpaper_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("Wallpaper id contains unsupported characters.".into());
        }
        let mut settings = self.inner.lock();
        settings.wallpaper_id = wallpaper_id;
        self.save_locked(&settings)
    }

    pub fn window_preferences(&self) -> (u32, bool) {
        let settings = self.inner.lock();
        (settings.window_gap, settings.cycling)
    }

    pub fn rules(&self) -> Vec<WindowRule> {
        self.inner.lock().rules.clone()
    }

    pub fn ignored_app_ids(&self) -> Vec<String> {
        self.inner.lock().ignored_app_ids.clone()
    }

    pub fn shortcuts(&self) -> BTreeMap<String, String> {
        self.inner.lock().shortcuts.clone()
    }

    pub fn replace_shortcuts(&self, shortcuts: BTreeMap<String, String>) -> Result<(), String> {
        let supported = default_shortcuts();
        if shortcuts
            .keys()
            .any(|action| !supported.contains_key(action))
        {
            return Err("Shortcut map contains an unsupported action".into());
        }
        let mut settings = self.inner.lock();
        settings.shortcuts = shortcuts;
        self.save_locked(&settings)
    }

    pub fn set_app_ignored(&self, app_id: &str, ignored: bool) -> Result<(), String> {
        let mut settings = self.inner.lock();
        settings.ignored_app_ids.retain(|id| id != app_id);
        if ignored {
            settings.ignored_app_ids.push(app_id.to_string());
            settings.ignored_app_ids.sort();
            settings.ignored_app_ids.dedup();
        }
        self.save_locked(&settings)
    }

    pub fn set_launch_at_login(&self, enabled: bool) -> Result<(), String> {
        let mut settings = self.inner.lock();
        settings.launch_at_login = enabled;
        self.save_locked(&settings)
    }

    pub fn upsert_rule(&self, rule: WindowRule) -> Result<(), String> {
        let mut settings = self.inner.lock();
        settings.rules.retain(|existing| existing.id != rule.id);
        settings.rules.push(rule);
        self.save_locked(&settings)
    }

    pub fn delete_rule(&self, id: &str) -> Result<(), String> {
        let mut settings = self.inner.lock();
        let before = settings.rules.len();
        settings.rules.retain(|rule| rule.id != id);
        if settings.rules.len() == before {
            return Err("That Rule no longer exists".into());
        }
        self.save_locked(&settings)
    }

    pub fn set_window_preferences(&self, gap: u32, cycling: bool) -> Result<(), String> {
        if gap > 48 {
            return Err("Window gap must be between 0 and 48 pixels".into());
        }
        let mut settings = self.inner.lock();
        settings.window_gap = gap;
        settings.cycling = cycling;
        self.save_locked(&settings)
    }

    pub fn add_scene(&self, scene: WindowScene) -> Result<(), String> {
        let mut settings = self.inner.lock();
        settings.scenes.retain(|existing| existing.id != scene.id);
        settings.scenes.push(scene);
        self.save_locked(&settings)
    }

    pub fn scene(&self, id: &str) -> Option<WindowScene> {
        self.inner
            .lock()
            .scenes
            .iter()
            .find(|scene| scene.id == id)
            .cloned()
    }

    pub fn latest_scene(&self) -> Option<WindowScene> {
        self.inner.lock().scenes.last().cloned()
    }

    pub fn set_scene_auto_restore(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut settings = self.inner.lock();
        let scene = settings
            .scenes
            .iter_mut()
            .find(|scene| scene.id == id)
            .ok_or_else(|| "That Scene no longer exists".to_string())?;
        scene.auto_restore = enabled;
        self.save_locked(&settings)
    }

    pub fn auto_restore_scene(&self, fingerprint: &str) -> Option<WindowScene> {
        let settings = self.inner.lock();
        if !settings.scene_auto_restore {
            return None;
        }
        settings
            .scenes
            .iter()
            .rev()
            .find(|scene| scene.auto_restore && scene.display_fingerprint == fingerprint)
            .cloned()
    }

    pub fn delete_scene(&self, id: &str) -> Result<(), String> {
        let mut settings = self.inner.lock();
        let before = settings.scenes.len();
        settings.scenes.retain(|scene| scene.id != id);
        if settings.scenes.len() == before {
            return Err("That Scene no longer exists".into());
        }
        self.save_locked(&settings)
    }

    fn save_locked(&self, settings: &UserSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, bytes).map_err(|e| e.to_string())
    }
}

fn effective_pins(settings: &UserSettings, catalog: &[AppInfo]) -> Vec<String> {
    let configured = settings.pinned_app_ids.clone().unwrap_or_else(|| {
        catalog
            .iter()
            .filter(|app| app.pinned)
            .map(|app| app.id.clone())
            .collect()
    });
    configured
        .into_iter()
        .filter(|id| catalog.iter().any(|app| &app.id == id))
        .collect()
}

fn apply_pins(settings: &UserSettings, apps: &mut [AppInfo]) {
    let pins = effective_pins(settings, apps);
    for app in apps.iter_mut() {
        app.pinned = pins.contains(&app.id);
    }
    apps.sort_by_key(|app| {
        pins.iter()
            .position(|id| id == &app.id)
            .map(|index| (0usize, index))
            .unwrap_or((1usize, usize::MAX))
    });
}

fn appearance_state(settings: &UserSettings) -> AppearanceState {
    let resolved = match settings.appearance {
        AppearanceMode::Light => ResolvedAppearance::Light,
        AppearanceMode::Dark => ResolvedAppearance::Dark,
        AppearanceMode::System => system_appearance(),
    };
    AppearanceState {
        mode: settings.appearance,
        resolved,
        wallpaper_id: settings.wallpaper_id.clone(),
    }
}

#[cfg(windows)]
fn system_appearance() -> ResolvedAppearance {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()
        .and_then(|key| key.get_value::<u32, _>("AppsUseLightTheme").ok())
        .map(|light| {
            if light == 0 {
                ResolvedAppearance::Dark
            } else {
                ResolvedAppearance::Light
            }
        })
        .unwrap_or(ResolvedAppearance::Dark)
}

#[cfg(not(windows))]
fn system_appearance() -> ResolvedAppearance {
    ResolvedAppearance::Dark
}

fn settings_path() -> PathBuf {
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        return Path::new(&base).join("Gravity OS").join("settings.json");
    }
    if let Ok(home) = std::env::var("HOME") {
        return Path::new(&home)
            .join(".config")
            .join("gravity-os")
            .join("settings.json");
    }
    PathBuf::from("gravity-os-settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn configured_pin_order_is_applied_and_missing_apps_are_ignored() {
        let mut apps = vec![
            AppInfo::new("Files", None, true),
            AppInfo::new("Calculator", None, false),
            AppInfo::new("Settings", None, true),
        ];
        let settings = UserSettings {
            pinned_app_ids: Some(vec!["calculator".into(), "missing".into(), "files".into()]),
            ..Default::default()
        };
        apply_pins(&settings, &mut apps);
        assert_eq!(apps[0].id, "calculator");
        assert_eq!(apps[1].id, "files");
        assert!(apps[0].pinned);
        assert!(apps[1].pinned);
        assert!(!apps[2].pinned);
    }

    #[test]
    fn shortcut_defaults_are_unique_and_preserve_the_shell_handoff() {
        let shortcuts = default_shortcuts();
        let bindings = shortcuts.values().collect::<HashSet<_>>();
        assert_eq!(bindings.len(), shortcuts.len());
        assert!(!shortcuts.values().any(|binding| binding == "ctrl+alt+g"));
        assert_eq!(
            shortcuts.get("last-third").map(String::as_str),
            Some("ctrl+alt+h")
        );
    }
}
