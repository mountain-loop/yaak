ALTER TABLE http_requests
    ADD COLUMN url_parameters TEXT NOT NULL DEFAULT '[]';
