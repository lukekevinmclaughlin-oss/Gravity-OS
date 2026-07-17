//! Locale-independent Wi-Fi connection information via Native Wifi.

use std::ffi::c_void;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::{
    wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle,
    WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle, WlanQueryInterface,
    WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST,
};

pub fn connected_network() -> Option<String> {
    unsafe {
        let mut negotiated = 0;
        let mut handle = HANDLE::default();
        if WlanOpenHandle(2, None, &mut negotiated, &mut handle) != 0 {
            return None;
        }
        let result = query(handle);
        let _ = WlanCloseHandle(handle, None);
        result
    }
}

unsafe fn query(handle: HANDLE) -> Option<String> {
    let mut raw_list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
    if WlanEnumInterfaces(handle, None, &mut raw_list) != 0 || raw_list.is_null() {
        return None;
    }
    let count = (*raw_list).dwNumberOfItems as usize;
    let interfaces: &[WLAN_INTERFACE_INFO] =
        std::slice::from_raw_parts((*raw_list).InterfaceInfo.as_ptr(), count);
    let mut result = None;
    for interface in interfaces {
        if interface.isState != wlan_interface_state_connected {
            continue;
        }
        let mut size = 0;
        let mut data: *mut c_void = std::ptr::null_mut();
        if WlanQueryInterface(
            handle,
            &interface.InterfaceGuid,
            wlan_intf_opcode_current_connection,
            None,
            &mut size,
            &mut data,
            None,
        ) == 0
            && !data.is_null()
        {
            let attributes = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
            let ssid = &attributes.wlanAssociationAttributes.dot11Ssid;
            let length = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
            let name = String::from_utf8_lossy(&ssid.ucSSID[..length]).trim().to_string();
            WlanFreeMemory(data);
            if !name.is_empty() {
                result = Some(name);
                break;
            }
        }
    }
    WlanFreeMemory(raw_list.cast());
    result
}
