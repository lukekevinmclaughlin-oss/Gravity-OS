param(
  [int]$Cycles = 12,
  [int]$ProcessId = 0
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class GravityShellAudit {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public struct WindowInfo { public long Handle; public int Left, Top, Width, Height; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lparam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint parameter, out RECT value, uint flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  public static List<WindowInfo> WindowsForProcess(uint targetProcessId) {
    var result = new List<WindowInfo>();
    EnumWindows((hwnd, unused) => {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner == targetProcessId && IsWindowVisible(hwnd)) {
        var className = new StringBuilder(128);
        GetClassName(hwnd, className, className.Capacity);
        if (className.ToString() == "Tauri Window") {
          RECT rect;
          GetWindowRect(hwnd, out rect);
          result.Add(new WindowInfo {
            Handle = hwnd.ToInt64(), Left = rect.Left, Top = rect.Top,
            Width = rect.Right - rect.Left, Height = rect.Bottom - rect.Top
          });
        }
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@

function Send-GravityToggle {
  $up = 0x0002
  [GravityShellAudit]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [GravityShellAudit]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [GravityShellAudit]::keybd_event(0x47, 0, 0, [UIntPtr]::Zero)
  [GravityShellAudit]::keybd_event(0x47, 0, $up, [UIntPtr]::Zero)
  [GravityShellAudit]::keybd_event(0x12, 0, $up, [UIntPtr]::Zero)
  [GravityShellAudit]::keybd_event(0x11, 0, $up, [UIntPtr]::Zero)
}

function Get-TaskbarVisible {
  $tray = [GravityShellAudit]::FindWindow("Shell_TrayWnd", $null)
  return $tray -ne [IntPtr]::Zero -and [GravityShellAudit]::IsWindowVisible($tray)
}

function Get-GravityWindows([int]$TargetProcessId) {
  return [GravityShellAudit]::WindowsForProcess([uint32]$TargetProcessId)
}

function Get-WorkArea {
  $rect = New-Object GravityShellAudit+RECT
  if (-not [GravityShellAudit]::SystemParametersInfo(0x0030, 0, [ref]$rect, 0)) {
    throw "SPI_GETWORKAREA failed."
  }
  return [pscustomobject]@{ Left=$rect.Left; Top=$rect.Top; Right=$rect.Right; Bottom=$rect.Bottom }
}

function Wait-GravityMode([int]$TargetProcessId, [int]$TimeoutMs = 2500) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $stableSamples = 0
  $screenBottom = [GravityShellAudit]::GetSystemMetrics(1)
  do {
    $visible = @(Get-GravityWindows $TargetProcessId)
    if (-not (Get-TaskbarVisible) -and
        ($visible | Where-Object { $_.Height -eq 34 -and $_.Top -eq 0 }) -and
        ($visible | Where-Object { $_.Height -eq 170 -and ($_.Top + $_.Height) -eq $screenBottom })) {
      $stableSamples++
      if ($stableSamples -ge 3) { return $true }
    } else { $stableSamples = 0 }
    Start-Sleep -Milliseconds 75
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Wait-WindowsMode([int]$TargetProcessId, [int]$TimeoutMs = 2500) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $stableSamples = 0
  do {
    $visible = @(Get-GravityWindows $TargetProcessId | Where-Object { $_.Width -gt 10 -or $_.Height -gt 10 })
    if ((Get-TaskbarVisible) -and $visible.Count -eq 0) {
      $stableSamples++
      if ($stableSamples -ge 3) { return $true }
    } else { $stableSamples = 0 }
    Start-Sleep -Milliseconds 75
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

if ($ProcessId -eq 0) {
  $ProcessId = Get-Process gravity-os -ErrorAction Stop |
    Sort-Object StartTime -Descending |
    Select-Object -First 1 -ExpandProperty Id
}

if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
  throw "Gravity OS process $ProcessId is not running."
}

if (Get-TaskbarVisible) {
  Send-GravityToggle
  if (-not (Wait-GravityMode $ProcessId)) { throw "Gravity OS did not enter Gravity mode before the test." }
}

$failures = [System.Collections.Generic.List[string]]::new()
$windowsWorkArea = $null
$gravityWorkArea = $null

for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
  Send-GravityToggle
  $windowsReady = Wait-WindowsMode $ProcessId
  $windowsWorkArea = Get-WorkArea
  if (-not $windowsReady) { $failures.Add("Cycle ${cycle}: Windows mode did not settle within 2.5 seconds.") }
  if (-not (Get-TaskbarVisible)) { $failures.Add("Cycle ${cycle}: Explorer taskbar did not return.") }
  $visibleInWindows = @(Get-GravityWindows $ProcessId | Where-Object { $_.Width -gt 10 -or $_.Height -gt 10 })
  if ($visibleInWindows.Count -ne 0) { $failures.Add("Cycle ${cycle}: Gravity surfaces remained visible in Windows mode.") }

  Send-GravityToggle
  $gravityReady = Wait-GravityMode $ProcessId
  $gravityWorkArea = Get-WorkArea
  if (-not $gravityReady) { $failures.Add("Cycle ${cycle}: Gravity mode did not settle within 2.5 seconds.") }
  if (Get-TaskbarVisible) { $failures.Add("Cycle ${cycle}: Explorer taskbar remained visible in Gravity mode.") }
  $visible = @(Get-GravityWindows $ProcessId)
  if (-not ($visible | Where-Object Height -eq 34)) { $failures.Add("Cycle ${cycle}: Horizon did not restore to its 34 px hit region.") }
  if (-not ($visible | Where-Object Height -eq 170)) { $failures.Add("Cycle ${cycle}: Orbit did not restore to its 170 px hit region.") }
}

$result = [pscustomobject]@{
  ProcessId = $ProcessId
  Cycles = $Cycles
  Passed = $failures.Count -eq 0
  FailureCount = $failures.Count
  Failures = @($failures)
  WindowsWorkArea = $windowsWorkArea
  GravityWorkArea = $gravityWorkArea
  FinalVisibleSurfaces = @(Get-GravityWindows $ProcessId)
}

$result | ConvertTo-Json -Depth 5
if (-not $result.Passed) { exit 1 }
