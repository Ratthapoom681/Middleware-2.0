ALTER TABLE defectdojo_viewer_sync_history
    ADD COLUMN IF NOT EXISTS severity_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
