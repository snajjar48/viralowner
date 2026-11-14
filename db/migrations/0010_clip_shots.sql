-- A clip can now fill several shots (one long video split into shots): the shots it's on, and
-- whether a "start from scratch" clip should be cut into several shots. shot_index stays in step
-- with the first entry for older code.
ALTER TABLE clips ADD COLUMN IF NOT EXISTS shot_indexes INTEGER[] NOT NULL DEFAULT '{}';
UPDATE clips SET shot_indexes = ARRAY[shot_index] WHERE shot_index IS NOT NULL AND cardinality(shot_indexes) = 0;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS multi_use BOOLEAN NOT NULL DEFAULT false;
