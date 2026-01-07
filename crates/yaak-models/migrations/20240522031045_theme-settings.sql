ALTER TABLE settings
    ADD COLUMN theme_dark TEXT DEFAULT 'yaak-dark' NOT NULL;
ALTER TABLE settings
    ADD COLUMN theme_light TEXT DEFAULT 'yaak-light' NOT NULL;
