// Weekly backups: every table as SQL "INSERT OR REPLACE" statements, so a backup restores with one
// `wrangler d1 execute --file` after the migrations have created the tables.

export type TableDump = { name: string; rows: Record<string, unknown>[] };
export const BACKUPS_KEPT = 12;
export const BACKUP_PREFIX = "backup:";

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function dumpSql(tables: TableDump[], createdAt: string): string {
  const lines = [`-- Arif Gym Tracker backup, ${createdAt}`, "-- Restore: npx wrangler d1 execute gym-tracker --remote --file <this file>", ""];
  for (const t of tables) {
    lines.push(`-- ${t.name}: ${t.rows.length} rows`);
    for (const row of t.rows) {
      const cols = Object.keys(row);
      lines.push(`INSERT OR REPLACE INTO ${ident(t.name)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(", ")});`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Backup keys to delete so only the newest `keep` remain (keys sort by date). */
export function backupsToPrune(keys: string[], keep = BACKUPS_KEPT): string[] {
  return [...keys].sort().slice(0, Math.max(0, keys.length - keep));
}
