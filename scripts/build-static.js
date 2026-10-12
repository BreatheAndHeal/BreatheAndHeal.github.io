const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const excludedDirectories = new Set([
  ".git", ".github", ".vercel", ".wrangler", "node_modules", "dist",
  "api", "lib", "functions", "scripts", "tests", "coverage"
]);
const excludedFiles = new Set(["package.json", "package-lock.json", "schema.sql", "vercel.json", "wrangler.toml", "README.md", "BOOKING_SETUP.md", "CLOUDFLARE_MIGRATION.md", ".gitignore", ".nojekyll"]);
const publicExtensions = new Set([
  ".html", ".css", ".js", ".mjs", ".txt", ".xml",
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

    if (!excludedFiles.has(name) && (name === "_headers" || publicExtensions.has(path.extname(name).toLowerCase()))) {
      if (name.startsWith(".") && name !== ".well-known") continue;
      fs.copyFileSync(from, to);
    }
  }
}

function removeOutput() {
  fs.rmSync(output, { recursive: true, force: true });
}

function requirePublicOrigin() {
  const raw = String(process.env.PUBLIC_SITE_URL || "").trim();
  if (!raw) {
    throw new Error("PUBLIC_SITE_URL must be set to the final HTTPS site origin before building.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be a valid absolute HTTPS URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("PUBLIC_SITE_URL must be an HTTPS origin only, without a path, query, or fragment.");
  }

  return parsed.origin;
}

function rewriteLegacyOrigin(publicOrigin) {
  const allowedTextExtensions = new Set([".html", ".xml", ".txt", ".js", ".mjs"]);
  const oldOrigin = "https://breatheandheal.github.io";
  let updatedFiles = 0;

  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (!allowedTextExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const original = fs.readFileSync(fullPath, "utf8");
      const updated = original.replaceAll(oldOrigin, publicOrigin);
      if (updated !== original) {
        fs.writeFileSync(fullPath, updated);
        updatedFiles += 1;
      }
    }
  }

  visit(output);

  // Fail closed: do not publish HTML, metadata, or discovery files that still
  // canonicalize the site to the old GitHub Pages host.
  function validate(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        validate(fullPath);
        continue;
      }
      if (!allowedTextExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const contents = fs.readFileSync(fullPath, "utf8");
      if (contents.includes(oldOrigin)) {
        throw new Error("Old GitHub Pages origin remains in public file: " + path.relative(output, fullPath));
      }
    }
  }
  validate(output);

  return updatedFiles;
}

try {
  const publicOrigin = requirePublicOrigin();
  removeOutput();
  copyPublicTree(root, output);
  const rewrittenCount = rewriteLegacyOrigin(publicOrigin);

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

  // Staging builds stay non-indexable by default. Enabling search indexing is
  // an explicit launch step, after the live booking flow has been verified.
  const indexingEnabled = String(process.env.SITE_INDEXING_ENABLED || "false").trim().toLowerCase() === "true";
  const generatedHeaders = fs.readFileSync(headersPath, "utf8");
  const safeHeaders = indexingEnabled
    ? generatedHeaders.replace(/^\s*X-Robots-Tag:\s*noindex[^\n]*\n/gim, "")
    : /^\s*X-Robots-Tag:\s*noindex\b/im.test(generatedHeaders)
      ? generatedHeaders
      : generatedHeaders.replace(/^\/\*\s*\n/, "/*\n  X-Robots-Tag: noindex\n");
  fs.writeFileSync(headersPath, safeHeaders);

  console.log("Static site built to dist/; backend source and configuration were excluded.");
  console.log("Search indexing is " + (indexingEnabled ? "enabled" : "disabled by default") + ".");
  console.log("Public origin set to " + publicOrigin + "; updated " + rewrittenCount + " file(s).");
} catch (error) {
  console.error("Static build failed:", error.message);
  process.exitCode = 1;
}
