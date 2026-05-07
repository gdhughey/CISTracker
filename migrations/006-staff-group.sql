-- Migration 006: Add 'staff' as a valid student_group value
-- SQLite has no DROP CONSTRAINT, so drop+re-add the column.
-- Existing values are preserved via a temp table.

CREATE TEMP TABLE _tmp_groups AS SELECT id, student_group FROM users;

ALTER TABLE users DROP COLUMN student_group;
ALTER TABLE users ADD COLUMN student_group TEXT NOT NULL DEFAULT 'none'
  CHECK(student_group IN ('am', 'pm', 'allday', 'staff', 'none'));

UPDATE users SET student_group = (
  SELECT student_group FROM _tmp_groups WHERE _tmp_groups.id = users.id
);

DROP TABLE _tmp_groups;
