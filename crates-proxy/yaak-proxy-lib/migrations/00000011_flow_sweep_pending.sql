-- Flows the keep-traffic sweep deleted whose bodies in `blobs.sqlite` may not be deleted yet:
-- written with the rows' deletion and removed once their bodies are, so a sweep that fails
-- between the two finishes the bodies next time.
CREATE TABLE flow_sweep_pending
(
    flow_id TEXT NOT NULL PRIMARY KEY
);
