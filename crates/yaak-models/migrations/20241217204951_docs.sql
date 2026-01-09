ALTER TABLE http_requests
    ADD COLUMN description TEXT DEFAULT '' NOT NULL;

ALTER TABLE grpc_requests
    ADD COLUMN description TEXT DEFAULT '' NOT NULL;

ALTER TABLE folders
    ADD COLUMN description TEXT DEFAULT '' NOT NULL;
