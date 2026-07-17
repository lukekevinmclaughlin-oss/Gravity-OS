//! Real Windows radio control for Horizon/Core quick settings.

use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

fn radio(kind: RadioKind) -> Result<Radio, String> {
    let access = Radio::RequestAccessAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| error.to_string())?;
    if access != RadioAccessStatus::Allowed {
        return Err("Windows denied access to radio controls".into());
    }
    let radios = Radio::GetRadiosAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| error.to_string())?;
    for index in 0..radios.Size().map_err(|error| error.to_string())? {
        let candidate = radios.GetAt(index).map_err(|error| error.to_string())?;
        if candidate.Kind().map_err(|error| error.to_string())? == kind {
            return Ok(candidate);
        }
    }
    Err("This PC does not expose that radio".into())
}

pub fn state(kind: RadioKind) -> Option<bool> {
    radio(kind)
        .and_then(|device| device.State().map_err(|error| error.to_string()))
        .ok()
        .map(|state| state == RadioState::On)
}

pub fn toggle(kind: RadioKind) -> Result<bool, String> {
    let device = radio(kind)?;
    let current = device.State().map_err(|error| error.to_string())?;
    let target = if current == RadioState::On {
        RadioState::Off
    } else {
        RadioState::On
    };
    let result = device
        .SetStateAsync(target)
        .and_then(|operation| operation.get())
        .map_err(|error| error.to_string())?;
    if result != RadioAccessStatus::Allowed {
        return Err("Windows rejected the radio state change".into());
    }
    Ok(target == RadioState::On)
}

pub fn wifi_state() -> Option<bool> {
    state(RadioKind::WiFi)
}

pub fn bluetooth_state() -> Option<bool> {
    state(RadioKind::Bluetooth)
}

pub fn toggle_wifi() -> Result<bool, String> {
    toggle(RadioKind::WiFi)
}

pub fn toggle_bluetooth() -> Result<bool, String> {
    toggle(RadioKind::Bluetooth)
}
