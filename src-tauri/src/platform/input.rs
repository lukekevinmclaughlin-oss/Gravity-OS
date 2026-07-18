//! Synthesized input: the Horizon Edit menu drives the focused foreign
//! window by sending the standard Ctrl chords (spec §3).
//! `#[cfg(windows)]` only.

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_V, VK_X, VK_Y, VK_Z,
};
use windows::Win32::UI::WindowsAndMessaging::{
    IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

fn key(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Send Ctrl+<letter> for a Horizon Edit-menu verb. The strips are
/// non-activating, so the previously focused app still owns the keyboard.
pub fn edit_chord(kind: &str) -> Result<(), String> {
    let vk = match kind {
        "cut" => VK_X,
        "copy" => VK_C,
        "paste" => VK_V,
        "select-all" => VK_A,
        "undo" => VK_Z,
        "redo" => VK_Y,
        _ => return Err(format!("unknown edit action: {kind}")),
    };
    let seq = [
        key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        key(vk, KEYBD_EVENT_FLAGS(0)),
        key(vk, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&seq, std::mem::size_of::<INPUT>() as i32) };
    if sent != seq.len() as u32 {
        return Err(format!(
            "Windows accepted only {sent} of {} input events",
            seq.len()
        ));
    }
    Ok(())
}

/// Restore and target a specific foreign window before sending the chord.
/// Horizon becomes interactive while a menu is open, so relying on the
/// ambient foreground window would otherwise send Edit commands to Gravity.
pub fn edit_chord_for(window_id: &str, kind: &str) -> Result<(), String> {
    let raw = window_id
        .parse::<isize>()
        .map_err(|_| "Invalid window identifier".to_string())?;
    let hwnd = HWND(raw as *mut std::ffi::c_void);
    if !unsafe { IsWindow(hwnd) }.as_bool() {
        return Err("That application window is no longer available".into());
    }
    unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
        if !SetForegroundWindow(hwnd).as_bool() {
            return Err(
                "Windows did not allow Gravity to reactivate the target application".into(),
            );
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(35));
    edit_chord(kind)
}
