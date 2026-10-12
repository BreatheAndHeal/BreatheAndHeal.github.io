const { neon } = require("@neondatabase/serverless");

// Defer creating the Neon client until the first real query. This lets safe
// API validation paths return normal 400/405 responses even when a staging
// deployment has not been configured with a database yet. No query is sent
// unless DATABASE_URL is explicitly configured at runtime.
let cachedConnectionString = "";
let cachedClient;

function getSqlClient() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("Database is not configured.");
  }

  if (!cachedClient || cachedConnectionString !== connectionString) {
    cachedConnectionString = connectionString;
    cachedClient = neon(connectionString);
  }

  return cachedClient;
}

function sql(strings, ...values) {
  return getSqlClient()(strings, ...values);
}

module.exports = { sql };
