-- A GraphQL request's operation name, read from its body or URL as it was captured: empty for an
-- anonymous operation, NULL for a flow that is not GraphQL.
ALTER TABLE flows ADD COLUMN graphql_operation TEXT;
