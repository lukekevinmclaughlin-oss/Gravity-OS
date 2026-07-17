//! DDC/CI display brightness support for Core.

use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
    GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
};
use windows::Win32::Graphics::Gdi::{
    MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

fn active_monitor() -> HMONITOR {
    unsafe { MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY) }
}

fn physical_monitors() -> Result<Vec<PHYSICAL_MONITOR>, String> {
    let monitor = active_monitor();
    let mut count = 0;
    unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count) }
        .map_err(|error| error.to_string())?;
    if count == 0 {
        return Err("This display exposes no DDC/CI brightness control".into());
    }
    let mut physical = vec![PHYSICAL_MONITOR::default(); count as usize];
    unsafe { GetPhysicalMonitorsFromHMONITOR(monitor, &mut physical) }
        .map_err(|error| error.to_string())?;
    Ok(physical)
}

pub fn get() -> Result<f32, String> {
    let physical = physical_monitors()?;
    let mut result = None;
    for monitor in &physical {
        let (mut minimum, mut current, mut maximum) = (0, 0, 0);
        let success = unsafe {
            GetMonitorBrightness(
                monitor.hPhysicalMonitor,
                &mut minimum,
                &mut current,
                &mut maximum,
            )
        } != 0;
        if success && maximum > minimum {
            result = Some((current - minimum) as f32 / (maximum - minimum) as f32);
            break;
        }
    }
    unsafe {
        let _ = DestroyPhysicalMonitors(&physical);
    }
    result.ok_or_else(|| "This display does not support DDC/CI brightness".into())
}

pub fn set(value: f32) -> Result<(), String> {
    let physical = physical_monitors()?;
    let mut changed = false;
    for monitor in &physical {
        let (mut minimum, mut current, mut maximum) = (0, 0, 0);
        if unsafe {
            GetMonitorBrightness(
                monitor.hPhysicalMonitor,
                &mut minimum,
                &mut current,
                &mut maximum,
            )
        } != 0
            && maximum > minimum
        {
            let target =
                minimum + ((maximum - minimum) as f32 * value.clamp(0.0, 1.0)) as u32;
            changed |= unsafe { SetMonitorBrightness(monitor.hPhysicalMonitor, target) } != 0;
        }
    }
    unsafe {
        let _ = DestroyPhysicalMonitors(&physical);
    }
    changed
        .then_some(())
        .ok_or_else(|| "This display rejected the brightness change".into())
}
