import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "dist/",
        "*.config.ts",
        "app.ts",
        "main.ts",
        "constants/**",
        "controllers/**",
        "interfaces/**",
        "types/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
      "@interfaces": path.resolve(__dirname, "./interfaces"),
      "@types": path.resolve(__dirname, "./types"),
      "@services": path.resolve(__dirname, "./services"),
      "@controllers": path.resolve(__dirname, "./controllers"),
      "@modules": path.resolve(__dirname, "./modules"),
      "@constants": path.resolve(__dirname, "./constants"),
    },
  },
});
