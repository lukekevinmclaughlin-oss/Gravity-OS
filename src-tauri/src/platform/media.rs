//! Now Playing (NS-7.1): the system media transport session, read through
//! WinRT so Spotify, Edge, and every SMTC-aware player report the same way.
//! Session changes mark the event fabric dirty; intra-session track changes
//! reconcile through the fabric's window-title events and the slow sweep.

use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

use crate::shell::NowPlaying;

fn manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()
}

pub fn now_playing() -> Option<NowPlaying> {
    let session = manager()?.GetCurrentSession().ok()?;
    let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = properties
        .Title()
        .map(|t| t.to_string())
        .unwrap_or_default();
    if title.is_empty() {
        return None;
    }
    let artist = properties
        .Artist()
        .map(|a| a.to_string())
        .unwrap_or_default();
    let playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .map(|status| status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);
    let source_app = session
        .SourceAppUserModelId()
        .map(|id| id.to_string())
        .unwrap_or_default();
    Some(NowPlaying {
        title,
        artist,
        playing,
        source_app,
    })
}

pub fn control(kind: &str) -> Result<(), String> {
    let session = manager()
        .and_then(|manager| manager.GetCurrentSession().ok())
        .ok_or_else(|| "No application is playing media right now".to_string())?;
    let operation = match kind {
        "play-pause" => session.TryTogglePlayPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "previous" => session.TrySkipPreviousAsync(),
        _ => return Err("Unknown media control".into()),
    };
    let accepted = operation
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    if accepted {
        Ok(())
    } else {
        Err("The media session rejected that command".into())
    }
}

/// Fold media-session switches into the event fabric so Core updates without
/// polling. The manager reference is intentionally leaked: it is a single
/// process-lifetime service and dropping it would unregister the handler.
pub fn watch_changes() {
    if let Some(manager) = manager() {
        let registered = manager.CurrentSessionChanged(&TypedEventHandler::new(|_, _| {
            super::events::mark_dirty();
            Ok(())
        }));
        if registered.is_ok() {
            std::mem::forget(manager);
        }
    }
}
