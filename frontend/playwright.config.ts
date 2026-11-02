import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const backendDirectory = fileURLToPath(new URL("../backend/", import.meta.url));
const pythonExecutable = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../backend/.venv/Scripts/python.exe"
      : "../backend/.venv/bin/python",
    import.meta.url,
  ),
);

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:5181", browserName: "chromium" },
  webServer: [
    {
      command: `"${pythonExecutable}" -m uvicorn tests.mock_server:app --host 127.0.0.1 --port 8011`,
      cwd: backendDirectory,
      url: "http://127.0.0.1:8011/api/health",
      reuseExistingServer: false,
    },
    {
      command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run dev -- --port 5181 --strictPort`,
      env: { API_PROXY_TARGET: "http://127.0.0.1:8011" },
      url: "http://127.0.0.1:5181",
      reuseExistingServer: false,
    },
  ],
});
