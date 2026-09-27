#!/usr/bin/env node
// Same esbuild config as the host's plugins/build-plugin.mjs, run directly
// from this repo's own package.json "build" script.
import * as esbuild from "esbuild";
import path from "node:path";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: [path.join(import.meta.dirname, "index.tsx")],
  outfile: path.join(import.meta.dirname, "dist", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: ["react", "react-dom", "react-dom/*", "react/*", "@tauri-apps/api/*"],
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".gif": "dataurl" },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("build.mjs: watching");
} else {
  await esbuild.build(buildOptions);
}
