import { execSync } from "node:child_process";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

let commitHash = "unknown";
try {
	commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}

export default defineConfig({
	plugins: [react(), tailwindcss()],
	define: {
		__COMMIT_HASH__: JSON.stringify(commitHash),
	},
	build: {
		chunkSizeWarningLimit: 1000,
	},
	resolve: {
		alias: { "@": path.resolve(__dirname, "./src") },
	},
	server: {
		proxy: {
			"/api": "http://localhost:8787",
			"/auth": "http://localhost:8787",
		},
	},
});
