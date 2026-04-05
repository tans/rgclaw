import { openDb } from "../sqlite";

export type BackfillProgress = {
  id: string;
  source: string;
  lastBlock: number;
  completed: boolean;
  updatedAt: string;
};

function tableExists(): boolean {
  const db = openDb();
  try {
    const result = db.query(
      "select name from sqlite_master where type='table' and name='backfill_progress'"
    ).get() as { name: string } | null;
    return result !== null;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export function getBackfillProgress(source: string): BackfillProgress | null {
  if (!tableExists()) return null;
  
  const db = openDb();
  try {
    const row = db.query(
      "select id, source, last_block, completed, updated_at from backfill_progress where source = ?"
    ).get(source) as
      | { id: string; source: string; last_block: number; completed: number; updated_at: string }
      | null;

    if (!row) return null;

    return {
      id: row.id,
      source: row.source,
      lastBlock: row.last_block,
      completed: Boolean(row.completed),
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

export function updateBackfillProgress(
  source: string,
  lastBlock: number,
  completed: boolean
): void {
  if (!tableExists()) return;
  
  const db = openDb();
  try {
    const existing = db.query("select id from backfill_progress where source = ?").get(source) as
      | { id: string }
      | null;

    if (existing) {
      db.query(
        "update backfill_progress set last_block = ?, completed = ?, updated_at = ? where source = ?"
      ).run(lastBlock, completed ? 1 : 0, new Date().toISOString(), source);
    } else {
      db.query(
        "insert into backfill_progress (id, source, last_block, completed, updated_at) values (?, ?, ?, ?, ?)"
      ).run(
        crypto.randomUUID(),
        source,
        lastBlock,
        completed ? 1 : 0,
        new Date().toISOString()
      );
    }
  } finally {
    db.close();
  }
}

export function isBackfillComplete(source: string): boolean {
  const progress = getBackfillProgress(source);
  return progress?.completed ?? false;
}
