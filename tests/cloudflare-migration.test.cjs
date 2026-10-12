const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

test("Cloudflare build publishes public pages but not backend source", () => {
  execFileSync(process.execPath, ["scripts/build-static.js"], {
    cwd: root,
    stdio: "pipe"
  });

  assert.ok(fs.existsSync(path.join(dist, "index.html")), "index.html should be published");
  assert.ok(fs.existsSync(path.join(dist, "whatsapp-widget.js")), "WhatsApp widget should be published");
  assert.ok(fs.existsSync(path.join(dist, "robots.txt")), "robots.txt should be published");
  assert.ok(fs.existsSync(path.join(dist, "sitemap.xml")), "sitemap.xml should be published");
  assert.ok(fs.existsSync(path.join(dist, "_headers")), "security headers should be published");

  for (const privatePath of [
    "api", "lib", "functions", "scripts", "tests",
    "schema.sql", "package.json", "vercel.json", "wrangler.toml",
    "BOOKING_SETUP.md", "CLOUDFLARE_MIGRATION.md"
  ]) {
    assert.equal(
      fs.existsSync(path.join(dist, privatePath)),
      false,
      privatePath + " must not be copied to public static assets"
    );
  }

  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  assert.match(html, /const API_BASE="";/, "frontend APIs must be same-origin");
});

test("adapter preserves query/body and converts legacy responses", async () => {
  const { runLegacyHandler } = await import("../functions/_shared/legacy-adapter.js");
  const request = new Request(
    "https://the-unsaid.pages.dev/api/test?date=2026-10-12",
    {
      method: "POST",
      headers: {
        "Origin": "https://the-unsaid.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ consentAccepted: true })
    }
  );

  const handler = async (req, res) => {
    res.status(201)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .end(JSON.stringify({ method: req.method, date: req.query.date, accepted: req.body.consentAccepted }));
  };

  const response = await runLegacyHandler(request, handler);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    method: "POST",
    date: "2026-10-12",
    accepted: true
  });
});

test("adapter rejects an unapproved cross-origin browser request", async () => {
  const { runLegacyHandler } = await import("../functions/_shared/legacy-adapter.js");
  const previous = process.env.ALLOWED_ORIGIN;
  process.env.ALLOWED_ORIGIN = "";
  try {
    const request = new Request("https://the-unsaid.pages.dev/api/create-order", {
      method: "POST",
      headers: {
        "Origin": "https://attacker.example",
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const response = await runLegacyHandler(request, async () => {
      throw new Error("Handler must not run for an unapproved origin");
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Origin not allowed." });
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previous;
  }
});

test("adapter rejects malformed JSON before invoking an API handler", async () => {
  const { runLegacyHandler } = await import("../functions/_shared/legacy-adapter.js");
  const request = new Request("https://the-unsaid.pages.dev/api/create-order", {
    method: "POST",
    headers: {
      "Origin": "https://the-unsaid.pages.dev",
      "Content-Type": "application/json"
    },
    body: "{"
  });
  const response = await runLegacyHandler(request, async () => {
    throw new Error("Handler must not run for malformed JSON");
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON request body." });
});

test("adapter preserves the raw webhook payload", async () => {
  const { runLegacyHandler } = await import("../functions/_shared/legacy-adapter.js");
  const raw = '{"event":"payment.captured","payload":{"id":"safe-test"}}';
  const request = new Request("https://the-unsaid.pages.dev/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw
  });
  const response = await runLegacyHandler(request, async (req, res) => {
    let received = "";
    for await (const chunk of req) received += chunk;
    res.status(200).json({ same: received === raw });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { same: true });
});
