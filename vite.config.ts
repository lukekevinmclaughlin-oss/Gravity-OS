import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1420 is the Tauri convention; strictPort so the Rust side always finds us.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
