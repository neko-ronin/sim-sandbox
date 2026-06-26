import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readdirSync, existsSync } from "node:fs";

/** Discover multi-page entry points under projects/ */
function discoverEntries() {
  const root = resolve(import.meta.dirname, "projects");
  const entries: Record<string, string> = {
    index: resolve(import.meta.dirname, "index.html"),
  };
  try {
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const html = resolve(root, dir.name, "index.html");
      if (existsSync(html)) {
        entries[dir.name] = html;
      }
    }
  } catch {
    // no projects dir yet
  }
  return entries;
}

export default defineConfig({
  root: import.meta.dirname,
  build: {
    rollupOptions: {
      input: discoverEntries(),
    },
  },
  server: {
    port: 3333,
    open: false,
  },
});
