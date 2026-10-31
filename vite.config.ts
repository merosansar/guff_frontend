import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // 5173 to 5175 are used by the other portfolio projects; Guff uses 5176.
    port: 5176,
    // Same-origin API and socket, so the httpOnly refresh cookie just works in development.
    proxy: {
      "/api": { target: "http://localhost:4100", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4100", ws: true, changeOrigin: true },
    },
  },
})
