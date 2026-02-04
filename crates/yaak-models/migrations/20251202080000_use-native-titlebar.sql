-- Add a setting to force native window title bar / controls
ALTER TABLE settings
    ADD COLUMN use_native_titlebar BOOLEAN DEFAULT FALSE NOT NULL;
