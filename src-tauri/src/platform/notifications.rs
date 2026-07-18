//! Windows Action Center notification bridge for Gravity Pulse.

use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};

use crate::shell::PulseNote;

pub fn read() -> Result<Vec<PulseNote>, String> {
    let listener = UserNotificationListener::Current().map_err(|error| error.to_string())?;
    let mut access = listener
        .GetAccessStatus()
        .map_err(|error| error.to_string())?;
    if access == UserNotificationListenerAccessStatus::Unspecified {
        access = listener
            .RequestAccessAsync()
            .and_then(|operation| operation.get())
            .map_err(|error| error.to_string())?;
    }
    if access != UserNotificationListenerAccessStatus::Allowed {
        return Err("Windows notification access is disabled for Gravity OS".into());
    }
    let notifications = listener
        .GetNotificationsAsync(NotificationKinds::Toast)
        .and_then(|operation| operation.get())
        .map_err(|error| error.to_string())?;
    let binding_name =
        KnownNotificationBindings::ToastGeneric().map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    let size = notifications.Size().map_err(|error| error.to_string())?;
    // Keep enough Action Center entries for per-application Dock badge counts;
    // Pulse can still virtualize/present the same authoritative collection.
    for index in (0..size).rev().take(64) {
        let item = notifications
            .GetAt(index)
            .map_err(|error| error.to_string())?;
        let app_name = item
            .AppInfo()
            .and_then(|app| app.DisplayInfo())
            .and_then(|display| display.DisplayName())
            .map(|name| name.to_string())
            .unwrap_or_else(|_| "Windows".into());
        let texts = item
            .Notification()
            .and_then(|notification| notification.Visual())
            .and_then(|visual| visual.GetBinding(&binding_name))
            .and_then(|binding| binding.GetTextElements())
            .map_err(|error| error.to_string())?;
        let mut lines = Vec::new();
        for text_index in 0..texts.Size().map_err(|error| error.to_string())? {
            let line = texts
                .GetAt(text_index)
                .and_then(|text| text.Text())
                .map(|text| text.to_string())
                .unwrap_or_default();
            if !line.trim().is_empty() {
                lines.push(line);
            }
        }
        if lines.is_empty() {
            continue;
        }
        let title = lines.remove(0);
        let body = lines.join(" · ");
        result.push(PulseNote {
            id: item.Id().map_err(|error| error.to_string())?.to_string(),
            hue: hue(&app_name),
            app_name,
            title,
            body,
        });
    }
    Ok(result)
}

pub fn dismiss(id: &str) -> Result<(), String> {
    let id = id
        .parse::<u32>()
        .map_err(|_| "Invalid notification identifier".to_string())?;
    UserNotificationListener::Current()
        .and_then(|listener| listener.RemoveNotification(id))
        .map_err(|error| error.to_string())
}

fn hue(name: &str) -> u32 {
    name.bytes().fold(0u32, |value, byte| {
        value.wrapping_mul(31).wrapping_add(byte as u32)
    }) % 360
}
