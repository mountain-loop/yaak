-- Add a setting to disable in-app feature feedback prompts
ALTER TABLE settings
    ADD COLUMN hide_feedback_prompts BOOLEAN DEFAULT FALSE NOT NULL;
