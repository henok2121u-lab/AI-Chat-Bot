import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the dashboard calls /api on its own origin and Vite forwards
// it to the Express server, so the session cookie is same-site.
const API_URL = process.env.VITE_API_PROXY ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: API_URL, changeOrigin: true } },
  },
});
