-- The client gave up on the flow, by resetting its HTTP/2 stream or closing the connection.
ALTER TABLE flows ADD COLUMN cancelled BOOLEAN NOT NULL DEFAULT FALSE;
