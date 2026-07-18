//! System volume via the Core Audio endpoint (COM).
//! `#[cfg(windows)]` only.

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};

/// Run `f` with the default render device's endpoint volume interface.
/// COM is initialized per-call (cheap, apartment-threaded) and tolerated if
/// already initialized on this thread.
unsafe fn with_endpoint<T>(f: impl FnOnce(&IAudioEndpointVolume) -> T) -> Option<T> {
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eMultimedia)
        .ok()?;
    let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
    Some(f(&endpoint))
}

pub fn get_volume() -> Option<f32> {
    unsafe { with_endpoint(|e| e.GetMasterVolumeLevelScalar().unwrap_or(0.5)) }
}

pub fn set_volume(value: f32) -> Result<(), String> {
    unsafe {
        with_endpoint(|endpoint| {
            endpoint
                .SetMasterVolumeLevelScalar(value, std::ptr::null())
                .map_err(|error| error.to_string())
        })
        .ok_or_else(|| "No default audio output device is available".to_string())?
    }
}
