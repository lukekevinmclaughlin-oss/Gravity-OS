//! Event-driven state fabric (NS-3.1): out-of-context WinEvent hooks watch
//! window creation, destruction, visibility, title and minimize changes across
//! the desktop, and coalesce them into debounced `gravity://state-changed`
//! pushes. Surfaces subscribe instead of polling; a slow reconciliation sweep
//! in the frontend remains the only timer.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::Emitter;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetMessageW, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_NAMECHANGE, EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GA_ROOT, MSG,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

static DIRTY: AtomicBool = AtomicBool::new(false);
static SHELL_ACTIVE: AtomicBool = AtomicBool::new(true);

/// Other native sources (media sessions, listeners) can fold their change
/// signals into the same debounced push.
pub fn mark_dirty() {
    DIRTY.store(true, Ordering::Relaxed);
}

/// Pushes stop while Gravity is handed off to Windows 11 so hidden surfaces
/// do not refetch state on every foreign window churn.
pub fn set_shell_active(active: bool) {
    SHELL_ACTIVE.store(active, Ordering::Relaxed);
    if active {
        // Re-entering Gravity always resynchronizes immediately.
        DIRTY.store(true, Ordering::Relaxed);
    }
}

unsafe extern "system" fn win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object_id: i32,
    child_id: i32,
    _thread_id: u32,
    _time: u32,
) {
    // Top-level window changes only: OBJID_WINDOW / CHILDID_SELF on a root.
    if object_id != 0 || child_id != 0 || hwnd.0.is_null() {
        return;
    }
    if event == EVENT_OBJECT_DESTROY {
        // A destroyed root can no longer answer GetAncestor; prune first.
        super::thumbnails::on_window_destroyed(hwnd.0 as isize);
        DIRTY.store(true, Ordering::Relaxed);
        return;
    }
    if GetAncestor(hwnd, GA_ROOT) != hwnd {
        return;
    }
    DIRTY.store(true, Ordering::Relaxed);
}

pub fn start(app: tauri::AppHandle) {
    thread::spawn(move || {
        let hook_thread = thread::spawn(|| unsafe {
            // CREATE(0x8000)..HIDE(0x8003) covers create/destroy/show/hide in
            // one registration; NAMECHANGE and MINIMIZESTART/END are separate.
            let ranges = [
                (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
            ];
            for (from, to) in ranges {
                let hook = SetWinEventHook(
                    from,
                    to,
                    HMODULE::default(),
                    Some(win_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                );
                if hook.is_invalid() {
                    return;
                }
            }
            let mut message = MSG::default();
            while GetMessageW(&mut message, HWND::default(), 0, 0).as_bool() {}
        });

        // Coalescing notifier: many raw events become at most five pushes per
        // second, and none at all while the shell is handed off.
        loop {
            thread::sleep(Duration::from_millis(200));
            if hook_thread.is_finished() {
                return;
            }
            if SHELL_ACTIVE.load(Ordering::Relaxed) && DIRTY.swap(false, Ordering::Relaxed) {
                let _ = app.emit("gravity://state-changed", ());
            }
        }
    });
}
