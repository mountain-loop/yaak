-- NOTE: SQLite does not support dropping foreign keys, so we need to create new
-- tables and copy data instead. To prevent cascade deletes from wrecking stuff,
-- we start with the leaf tables and finish with the parent tables (eg. folder).

----------------------------
-- Remove http request FK --
----------------------------

CREATE TABLE http_requests_dg_tmp
(
    id                  TEXT                               NOT NULL
        PRIMARY KEY,
    model               TEXT     DEFAULT 'http_request'    NOT NULL,
    workspace_id        TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at          DATETIME,
    name                TEXT                               NOT NULL,
    url                 TEXT                               NOT NULL,
    method              TEXT                               NOT NULL,
    headers             TEXT                               NOT NULL,
    body_type           TEXT,
    sort_priority       REAL     DEFAULT 0                 NOT NULL,
    authentication      TEXT     DEFAULT '{}'              NOT NULL,
    authentication_type TEXT,
    folder_id           TEXT,
    body                TEXT     DEFAULT '{}'              NOT NULL,
    url_parameters      TEXT     DEFAULT '[]'              NOT NULL,
    description         TEXT     DEFAULT ''                NOT NULL
);

INSERT INTO http_requests_dg_tmp(id, model, workspace_id, created_at, updated_at, deleted_at, name, url, method,
                                 headers, body_type, sort_priority, authentication, authentication_type, folder_id,
                                 body, url_parameters, description)
SELECT id,
       model,
       workspace_id,
       created_at,
       updated_at,
       deleted_at,
       name,
       url,
       method,
       headers,
       body_type,
       sort_priority,
       authentication,
       authentication_type,
       folder_id,
       body,
       url_parameters,
       description
FROM http_requests;

DROP TABLE http_requests;

ALTER TABLE http_requests_dg_tmp
    RENAME TO http_requests;

----------------------------
-- Remove grpc request FK --
----------------------------

CREATE TABLE grpc_requests_dg_tmp
(
    id                  TEXT                                                    NOT NULL
        PRIMARY KEY,
    model               TEXT     DEFAULT 'grpc_request'                         NOT NULL,
    workspace_id        TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id           TEXT,
    created_at          DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at          DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    name                TEXT                                                    NOT NULL,
    sort_priority       REAL                                                    NOT NULL,
    url                 TEXT                                                    NOT NULL,
    service             TEXT,
    method              TEXT,
    message             TEXT                                                    NOT NULL,
    authentication      TEXT     DEFAULT '{}'                                   NOT NULL,
    authentication_type TEXT,
    metadata            TEXT     DEFAULT '[]'                                   NOT NULL,
    description         TEXT     DEFAULT ''                                     NOT NULL
);

INSERT INTO grpc_requests_dg_tmp(id, model, workspace_id, folder_id, created_at, updated_at, name, sort_priority, url,
                                 service, method, message, authentication, authentication_type, metadata, description)
SELECT id,
       model,
       workspace_id,
       folder_id,
       created_at,
       updated_at,
       name,
       sort_priority,
       url,
       service,
       method,
       message,
       authentication,
       authentication_type,
       metadata,
       description
FROM grpc_requests;

DROP TABLE grpc_requests;

ALTER TABLE grpc_requests_dg_tmp
    RENAME TO grpc_requests;

---------------------------------
-- Remove websocket request FK --
---------------------------------

CREATE TABLE websocket_requests_dg_tmp
(
    id                  TEXT                                 NOT NULL
        PRIMARY KEY,
    model               TEXT     DEFAULT 'websocket_request' NOT NULL,
    workspace_id        TEXT                                 NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id           TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP   NOT NULL,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP   NOT NULL,
    deleted_at          DATETIME,
    authentication      TEXT     DEFAULT '{}'                NOT NULL,
    authentication_type TEXT,
    description         TEXT                                 NOT NULL,
    name                TEXT                                 NOT NULL,
    url                 TEXT                                 NOT NULL,
    headers             TEXT                                 NOT NULL,
    message             TEXT                                 NOT NULL,
    sort_priority       REAL                                 NOT NULL,
    url_parameters      TEXT     DEFAULT '[]'                NOT NULL
);

INSERT INTO websocket_requests_dg_tmp(id, model, workspace_id, folder_id, created_at, updated_at, deleted_at,
                                      authentication, authentication_type, description, name, url, headers, message,
                                      sort_priority, url_parameters)
SELECT id,
       model,
       workspace_id,
       folder_id,
       created_at,
       updated_at,
       deleted_at,
       authentication,
       authentication_type,
       description,
       name,
       url,
       headers,
       message,
       sort_priority,
       url_parameters
FROM websocket_requests;

DROP TABLE websocket_requests;

ALTER TABLE websocket_requests_dg_tmp
    RENAME TO websocket_requests;

---------------------------
-- Remove environment FK --
---------------------------

CREATE TABLE environments_dg_tmp
(
    id             TEXT                               NOT NULL
        PRIMARY KEY,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at     DATETIME,
    workspace_id   TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    name           TEXT                               NOT NULL,
    variables               DEFAULT '[]'              NOT NULL,
    model          TEXT     DEFAULT 'environment',
    environment_id TEXT
);

INSERT INTO environments_dg_tmp(id, created_at, updated_at, deleted_at, workspace_id, name, variables, model,
                                environment_id)
SELECT id,
       created_at,
       updated_at,
       deleted_at,
       workspace_id,
       name,
       variables,
       model,
       environment_id
FROM environments;

DROP TABLE environments;

ALTER TABLE environments_dg_tmp
    RENAME TO environments;

----------------------
-- Remove folder FK --
----------------------

CREATE TABLE folders_dg_tmp
(
    id            TEXT                               NOT NULL
        PRIMARY KEY,
    model         TEXT     DEFAULT 'folder'          NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at    DATETIME,
    workspace_id  TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id     TEXT,
    name          TEXT                               NOT NULL,
    sort_priority REAL     DEFAULT 0                 NOT NULL,
    description   TEXT     DEFAULT ''                NOT NULL
);

INSERT INTO folders_dg_tmp(id, model, created_at, updated_at, deleted_at, workspace_id, folder_id, name, sort_priority,
                           description)
SELECT id,
       model,
       created_at,
       updated_at,
       deleted_at,
       workspace_id,
       folder_id,
       name,
       sort_priority,
       description
FROM folders;

DROP TABLE folders;

ALTER TABLE folders_dg_tmp
    RENAME TO folders;
