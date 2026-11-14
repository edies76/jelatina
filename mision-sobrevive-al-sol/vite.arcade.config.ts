import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-arcade",
    rollupOptions: {
      input: ["index.html", "arcade.html"],
    },
  },
});
