use crate::error::Result;
use crate::update_source::UpdateSource;
use chrono::{NaiveDateTime, Utc};
use rusqlite::Row;
use sea_query::{IntoColumnRef, IntoIden, IntoTableRef, Order, SimpleExpr};

pub trait UpsertModelInfo {
    fn table_name() -> impl IntoTableRef + IntoIden;
    fn id_column() -> impl IntoIden + Eq + Clone;
    fn generate_id() -> String;
    fn order_by() -> (impl IntoColumnRef, Order);
    fn get_id(&self) -> String;
    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>>;
    fn update_columns() -> Vec<impl IntoIden>;
    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized;
}

/// Generate timestamps for upsert operations.
/// Sync and import operations preserve existing timestamps; other sources use current time.
pub fn upsert_date(update_source: &UpdateSource, dt: NaiveDateTime) -> SimpleExpr {
    match update_source {
        UpdateSource::Sync | UpdateSource::Import => {
            if dt.and_utc().timestamp() == 0 {
                Utc::now().naive_utc().into()
            } else {
                dt.into()
            }
        }
        _ => Utc::now().naive_utc().into(),
    }
}
