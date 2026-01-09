ALTER TABLE environments DROP COLUMN data;
ALTER TABLE environments ADD COLUMN variables DEFAULT '[]' NOT NULL;
