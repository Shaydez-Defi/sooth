import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openSnapshotDb, seedDbIfMissing } from "./db.js";

function seedSnapshotCount(): number {
  const seed = new Database("data/seed-snapshots.db", { readonly: true });
  try {
    const row = seed.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number };
    return row.n;
  } finally {
    seed.close();
  }
}

function snapshotCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

describe("seedDbIfMissing - serverless cold-start seed", () => {
  it("copies the bundled seed when the target is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sooth-seed-"));
    const target = path.join(dir, "snapshots.db");
    const db = openSnapshotDb(target);
    db.close();
    expect(fs.existsSync(target)).toBe(true);
    expect(snapshotCount(target)).toBe(seedSnapshotCount());
    expect(seedSnapshotCount()).toBeGreaterThan(0);
  });

  it("never overwrites an existing DB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sooth-seed-"));
    const target = path.join(dir, "snapshots.db");
    const first = openSnapshotDb(target);
    first.close();
    const sizeBefore = fs.statSync(target).size;
    seedDbIfMissing(target);
    expect(fs.statSync(target).size).toBe(sizeBefore);
  });
});
