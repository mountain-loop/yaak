use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{GraphQlIntrospection, GraphQlIntrospectionIden};
use crate::util::UpdateSource;
use chrono::{Duration, Utc};
use sea_query::{Expr, Query, SqliteQueryBuilder};
use sea_query_rusqlite::RusqliteBinder;

impl<'a> DbContext<'a> {
    pub fn get_graphql_introspection(&self, request_id: &str) -> Option<GraphQlIntrospection> {
        self.find_optional(GraphQlIntrospectionIden::RequestId, request_id)
    }

    pub fn upsert_graphql_introspection(
        &self,
        workspace_id: &str,
        request_id: &str,
        content: Option<String>,
        source: &UpdateSource,
    ) -> Result<GraphQlIntrospection> {
        // Clean up old ones every time a new one is upserted
        self.delete_expired_graphql_introspections()?;

        match self.get_graphql_introspection(request_id) {
            None => self.upsert(
                &GraphQlIntrospection {
                    content,
                    request_id: request_id.to_string(),
                    workspace_id: workspace_id.to_string(),
                    ..Default::default()
                },
                source,
            ),
            Some(introspection) => self.upsert(
                &GraphQlIntrospection {
                    content,
                    ..introspection
                },
                source,
            ),
        }
    }

    pub fn delete_expired_graphql_introspections(&self) -> Result<()> {
        let cutoff = Utc::now().naive_utc() - Duration::days(7);
        let (sql, params) = Query::delete()
            .from_table(GraphQlIntrospectionIden::Table)
            .cond_where(Expr::col(GraphQlIntrospectionIden::UpdatedAt).lt(cutoff))
            .build_rusqlite(SqliteQueryBuilder);

        let mut stmt = self.conn.resolve().prepare(sql.as_str())?;
        stmt.execute(&*params.as_params())?;
        Ok(())
    }
}
