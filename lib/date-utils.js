function normalizeDatabaseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  // PostgreSQL DATE values may arrive as strings from the database driver.
  // Accept the YYYY-MM-DD prefix, including timestamp-like strings.
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

module.exports = { normalizeDatabaseDate };
