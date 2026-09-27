import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { migrateShotNumbers, shotNumber } from "../src/shot-numbers.js";

test("legacy shots and generations receive stable numbers without losing IDs or media links", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE ai_plans (id INTEGER PRIMARY KEY, project_id INTEGER, sequence_name TEXT, shot_code TEXT, sequence_number INTEGER, shot_number INTEGER);
      CREATE TABLE generations (id INTEGER PRIMARY KEY, plan_id INTEGER, sequence_number INTEGER, shot_number INTEGER);
      CREATE TABLE resources (id INTEGER PRIMARY KEY, plan_id INTEGER, storage_key TEXT);
      CREATE TABLE generation_resources (generation_id INTEGER, resource_id INTEGER);
      INSERT INTO ai_plans VALUES (10, 1, 'Sequence 05', 'SC01-SH011', NULL, NULL),
        (20, 1, '', 'SC02-SH007', NULL, NULL), (30, 1, 'Sequence 05', 'legacy', NULL, NULL),
        (40, 1, 'Sequence 05', 'unrecognized', NULL, NULL), (50, 1, 'Sequence 09', 'legacy', 9, 100);
      INSERT INTO generations VALUES (60, 10, NULL, NULL), (70, 30, NULL, NULL);
      INSERT INTO resources VALUES (80, 10, 'uploads/existing-output.mp4');
      INSERT INTO generation_resources VALUES (60, 80);
    `);
    migrateShotNumbers(db);
    const expected = [
      { id: 10, sequence_number: 5, shot_number: 11 },
      { id: 20, sequence_number: 2, shot_number: 7 },
      { id: 30, sequence_number: 5, shot_number: 1 },
      { id: 40, sequence_number: 5, shot_number: 2 },
      { id: 50, sequence_number: 9, shot_number: 100 }
    ];
    const rows = () => db.prepare("SELECT id, sequence_number, shot_number FROM ai_plans ORDER BY id").all();
    assert.deepEqual(rows(), expected);
    assert.deepEqual(db.prepare("SELECT * FROM generations ORDER BY id").all(), [
      { id: 60, plan_id: 10, sequence_number: 5, shot_number: 11 },
      { id: 70, plan_id: 30, sequence_number: 5, shot_number: 1 }
    ]);
    migrateShotNumbers(db);
    assert.deepEqual(rows(), expected, "migration is safe to run again");
    assert.deepEqual(db.prepare("SELECT * FROM resources").get(), { id: 80, plan_id: 10, storage_key: "uploads/existing-output.mp4" });
    assert.deepEqual(db.prepare("SELECT * FROM generation_resources").get(), { generation_id: 60, resource_id: 80 });

    assert.throws(() => db.exec("UPDATE ai_plans SET shot_number = 12 WHERE id = 10"), /locked/);
    assert.throws(() => db.exec("INSERT INTO ai_plans (id, project_id) VALUES (90, 1)"), /required/);
    assert.throws(() => db.exec("INSERT INTO ai_plans VALUES (90, 1, '', '', 1, 1.5)"), /integers/);
    assert.throws(() => db.exec("INSERT INTO generations VALUES (90, 10, 5, 12)"), /match/);
    assert.throws(() => db.exec("INSERT INTO generations (id, plan_id) VALUES (90, 10)"), /match/);
    assert.throws(() => db.exec("UPDATE generations SET plan_id = 20 WHERE id = 60"), /locked/);
    assert.throws(() => db.exec("UPDATE generations SET sequence_number = 6 WHERE id = 60"), /locked/);
    db.exec("INSERT INTO ai_plans VALUES (90, 1, 'Sequence 3', 'SQ03-SH004', 3, 4); INSERT INTO generations VALUES (100, 90, 3, 4)");
    assert.equal(db.prepare("SELECT shot_number FROM generations WHERE id = 100").get().shot_number, 4);
  } finally { db.close(); }
});

test("numbers accept only positive whole numbers within the supported range", () => {
  for (const value of [undefined, null, "", " ", true, [], {}, "1e2", "1.5", -1, 0, 1_000_001]) {
    assert.throws(() => shotNumber(value, "#Seq"), /#Seq/);
  }
  assert.equal(shotNumber("007", "#Shot"), 7);
  assert.equal(shotNumber(1_000_000, "#Shot"), 1_000_000);
});
