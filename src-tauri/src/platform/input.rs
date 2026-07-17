//! Synthesized input: the Horizon Edit menu drives the focused foreign
//! window by sending the standard Ctrl chords (spec §3).
//! `#[cfg(windows)]` only.

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_A, VK_C, VK_CONTROL, VK_V, VK_X, VK_Y, VK_Z,
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
    unsafe {
        SendInput(&seq, std::mem::size_of::<INPUT>() as i32);
    }
    Ok(())
}
