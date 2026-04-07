import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";

const commitHash = execSync("git rev-parse --short HEAD").toString().trim();

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
		},
	},
});
