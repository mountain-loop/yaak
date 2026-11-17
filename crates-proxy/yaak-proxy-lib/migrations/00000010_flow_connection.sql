-- The client's address, when the request was sent and the upstream connection made, and the
-- TLS it negotiated, for the flow's timeline and details.
ALTER TABLE flows ADD COLUMN client_addr TEXT;
ALTER TABLE flows ADD COLUMN elapsed_connect_ms INTEGER;
ALTER TABLE flows ADD COLUMN elapsed_tls_ms INTEGER;
ALTER TABLE flows ADD COLUMN elapsed_request_ms INTEGER;
ALTER TABLE flows ADD COLUMN upstream_tls_version TEXT;
ALTER TABLE flows ADD COLUMN upstream_tls_cipher TEXT;
