//! DWM live thumbnails (NS-1.2): real, GPU-composited pixels of other apps'
//! windows drawn into Gravity overlay surfaces. The registry owns every
//! HTHUMBNAIL and guarantees cleanup on re-layout, overlay clear, source
//! destruction (via the event fabric) — leak-free is the acceptance bar.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use parking_lot::Mutex;
use windows::Win32::Foundation::{BOOL, HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_VISIBLE,
};

pub struct Placement {
    pub source: isize,
    /// Destination rect in physical pixels, relative to the overlay client area.
    pub rect: (i32, i32, i32, i32),
}

/// dest hwnd -> source hwnd -> live HTHUMBNAIL.
fn registry() -> &'static Mutex<HashMap<isize, HashMap<isize, isize>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<isize, HashMap<isize, isize>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn unregister(handle: isize) {
    unsafe {
        let _ = DwmUnregisterThumbnail(handle);
    }
}

/// Reconcile one overlay's thumbnails against the requested placements:
/// register the new, retarget the kept, unregister the dropped.
pub fn set_thumbnails(dest: isize, placements: &[Placement]) -> Result<(), String> {
    let mut map = registry().lock();
    let entry = map.entry(dest).or_default();
    let wanted: HashSet<isize> = placements.iter().map(|p| p.source).collect();
    entry.retain(|source, handle| {
        let keep = wanted.contains(source);
        if !keep {
            unregister(*handle);
        }
        keep
    });
    for placement in placements {
        let handle = match entry.get(&placement.source) {
            Some(existing) => *existing,
            None => {
                let result = unsafe {
                    DwmRegisterThumbnail(
                        HWND(dest as *mut core::ffi::c_void),
                        HWND(placement.source as *mut core::ffi::c_void),
                    )
                };
                match result {
                    Ok(handle) => {
                        entry.insert(placement.source, handle);
                        handle
                    }
                    // Source window may have died between enumeration and now.
                    Err(_) => continue,
                }
            }
        };
        let (left, top, right, bottom) = placement.rect;
        let properties = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE,
            rcDestination: RECT {
                left,
                top,
                right,
                bottom,
            },
            fVisible: BOOL(1),
            ..Default::default()
        };
        unsafe {
            let _ = DwmUpdateThumbnailProperties(handle, &properties);
        }
    }
    Ok(())
}

/// Drop every thumbnail an overlay owns (overlay hidden or surface torn down).
pub fn clear_destination(dest: isize) {
    if let Some(entry) = registry().lock().remove(&dest) {
        for handle in entry.into_values() {
            unregister(handle);
        }
    }
}

/// Called from the event fabric when any top-level window dies.
pub fn on_window_destroyed(source: isize) {
    let mut map = registry().lock();
    for entry in map.values_mut() {
        if let Some(handle) = entry.remove(&source) {
            unregister(handle);
        }
    }
}

/// Live handle count surfaced in About and consumed by leak-soak checks.
pub fn active_count() -> usize {
    registry().lock().values().map(HashMap::len).sum()
}
