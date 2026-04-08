import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  minify: true,
  treeshake: true,
  target: "es2020",
  external: ["rrweb"],
});
