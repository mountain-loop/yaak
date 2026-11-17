-- Why an HTTPS connection was passed through undecrypted: `not_listed`, `excluded` (with the
-- exclusion that kept it out, and whether that one is built in) or `rejected` (with the flow of
-- the refused handshake that started passing its address through, when that was recorded).
ALTER TABLE flows ADD COLUMN tunnel_reason TEXT;
ALTER TABLE flows ADD COLUMN tunnel_excluded_by TEXT;
ALTER TABLE flows ADD COLUMN tunnel_excluded_built_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE flows ADD COLUMN tunnel_rejected_by TEXT;

-- A tunnel the proxy closed on request so its client reconnects.
ALTER TABLE flows ADD COLUMN reconnect_requested BOOLEAN NOT NULL DEFAULT FALSE;

-- A client's refused TLS handshake with the proxy, recorded once as its address is passed
-- through: the client's alert (`unknown_ca`, `bad_certificate`, ...) or `hang_up`.
ALTER TABLE flows ADD COLUMN tls_rejected TEXT;
