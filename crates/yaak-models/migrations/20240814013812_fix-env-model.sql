ALTER TABLE environments DROP COLUMN model;
ALTER TABLE environments ADD COLUMN model TEXT DEFAULT 'environment';
