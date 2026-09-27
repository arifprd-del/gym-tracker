import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { backupsToPrune, dumpSql, sqlLiteral } from "./backup";

test("SQL literals", () => {
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(82.5), "82.5");
  assert.equal(sqlLiteral("farmer's carry"), "'farmer''s carry'");
  assert.equal(sqlLiteral(Number.NaN), "NULL");
});

test("a dump restores the same rows into a fresh database", () => {
  const schema = `CREATE TABLE sets (id INTEGER PRIMARY KEY, performed_at TEXT, exercise TEXT, weight_kg REAL, reps INTEGER, note TEXT);
    CREATE TABLE "odd name" ("key" TEXT PRIMARY KEY, value TEXT);`;
  const source = new DatabaseSync(":memory:");
  source.exec(schema);
  source.exec(`INSERT INTO sets VALUES (1, '2026-09-27T10:00:00Z', 'farmer''s carry', 24.5, 60, NULL),
    (2, '2026-09-27T10:05:00Z', 'bench press', 80, 5, 'said "hi"; -- not a comment');
    INSERT INTO "odd name" VALUES ('a', 'line1
line2');`);
  const tables = ["sets", "odd name"].map((name) => ({ name, rows: source.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[] }));
  const sql = dumpSql(tables, "2026-09-27T03:17:00Z");

  const restored = new DatabaseSync(":memory:");
  restored.exec(schema);
  restored.exec(sql);
  restored.exec(sql); // running it twice is harmless (INSERT OR REPLACE)
  for (const t of tables) assert.deepEqual(restored.prepare(`SELECT * FROM "${t.name}"`).all(), t.rows);
});

test("keeps the newest 12 backups", () => {
  const keys = Array.from({ length: 14 }, (_, i) => `backup:2026-${String(i + 1).padStart(2, "0")}-01`).reverse();
  assert.deepEqual(backupsToPrune(keys), ["backup:2026-01-01", "backup:2026-02-01"]);
  assert.deepEqual(backupsToPrune(keys.slice(0, 3)), []);
});
