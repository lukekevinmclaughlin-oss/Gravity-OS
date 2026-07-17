/**
 * The JavaScript side of Tauri command arguments is camelCase even when the
 * Rust parameter is snake_case. Keep contracts here so they can be unit
 * tested without booting WebView2 or the Rust runtime.
 */

export interface IpcCall {
  command: string;
  args?: Record<string, unknown>;
}

export const ipc = {
  launchApp(appId: string): IpcCall {
    return { command: "launch_app", args: { appId } };
  },
};
