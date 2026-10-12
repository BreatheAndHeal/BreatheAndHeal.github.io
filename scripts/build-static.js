const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const excludedDirectories = new Set([
  ".git", ".github", ".vercel", ".wrangler", "node_modules", "dist",
  "api", "lib", "functions", "scripts", "tests", "coverage"
]);
const publicExtensions = new Set([
  ".html", ".css", ".js", ".mjs", ".txt", ".xml", ".json",
  ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ico",
  ".webmanifest", ".woff", ".woff2", ".ttf", ".pdf", ".mp4", ".webm"
]);

function copyPublicTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const name = entry.name;
    const from = path.join(source, name);
    const to = path.join(destination, name);

    if (entry.isDirectory()) {
      if (excludedDirectories.has(name)) continue;
      if (name.startsWith(".") && name !== ".well-known") continue;
      copyPublicTree(from, to);
      continue;
    }

    if (name === "_headers" || publicExtensions.has(path.extname(name).toLowerCase())) {
      if (name.startsWith(".") && name !== ".well-known") continue;
      fs.copyFileSync(from, to);
    }
  }
}

function removeOutput() {
  fs.rmSync(output, { recursive: true, force: true });
}

try {
  removeOutput();
  copyPublicTree(root, output);

  const headersPath = path.join(output, "_headers");
  if (!fs.existsSync(headersPath)) {
    fs.writeFileSync(headersPath, [
      "/*",
      "  X-Content-Type-Options: nosniff",
      "  X-Frame-Options: DENY",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
      "  Strict-Transport-Security: max-age=31536000",
      "",
      "/",
      "  Cache-Control: no-cache",
      "",
      "/*.html",
      "  Cache-Control: no-cache",
      ""
    ].join("\n"));
  }

  if (!fs.existsSync(path.join(output, "index.html"))) {
    throw new Error("Build output is missing index.html.");
  }

  console.log("Static site built to dist/; backend source and configuration were excluded.");
} catch (error) {
  console.error("Static build failed:", error.message);
  process.exitCode = 1;
}
