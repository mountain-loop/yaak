-- An HTTPS connection passed through undecrypted, recorded with only its host and sizes.
ALTER TABLE flows ADD COLUMN tunnelled BOOLEAN NOT NULL DEFAULT FALSE;
