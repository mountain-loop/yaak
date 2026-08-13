-- Add a setting to enable in-app feature feedback prompts
ALTER TABLE settings
    ADD COLUMN prompt_feedback BOOLEAN DEFAULT TRUE NOT NULL;
