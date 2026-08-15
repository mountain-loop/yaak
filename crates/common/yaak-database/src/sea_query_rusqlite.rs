//! Binds sea-query statements to rusqlite parameters.
//!
//! Vendored from the `sea-query-rusqlite` crate (v0.7.0, MIT OR Apache-2.0)
//! with the unused value variants dropped. Upstream pairs each of its releases
//! with one sea-query major and one rusqlite major, and there is no release
//! pairing sea-query 0.32 with rusqlite ≥ 0.38 — the version that gained a
//! `wasm32-unknown-unknown` target. Carrying these 60 lines ourselves decouples
//! the rusqlite upgrade from a sea-query one.

use rusqlite::types::{Null, ToSqlOutput};
use rusqlite::{Result, ToSql};
use sea_query::query::*;
use sea_query::{QueryBuilder, Value};

#[derive(Clone, Debug, PartialEq)]
pub struct RusqliteValue(pub Value);

#[derive(Clone, Debug, PartialEq)]
pub struct RusqliteValues(pub Vec<RusqliteValue>);

impl RusqliteValues {
    pub fn as_params(&self) -> Vec<&dyn ToSql> {
        self.0.iter().map(|x| x as &dyn ToSql).collect()
    }
}

pub trait RusqliteBinder {
    fn build_rusqlite<T: QueryBuilder>(&self, query_builder: T) -> (String, RusqliteValues);
}

macro_rules! impl_rusqlite_binder {
    ($l:ident) => {
        impl RusqliteBinder for $l {
            fn build_rusqlite<T: QueryBuilder>(
                &self,
                query_builder: T,
            ) -> (String, RusqliteValues) {
                let (query, values) = self.build(query_builder);
                (query, RusqliteValues(values.into_iter().map(RusqliteValue).collect()))
            }
        }
    };
}

impl_rusqlite_binder!(SelectStatement);
impl_rusqlite_binder!(UpdateStatement);
impl_rusqlite_binder!(InsertStatement);
impl_rusqlite_binder!(DeleteStatement);
impl_rusqlite_binder!(WithQuery);

impl ToSql for RusqliteValue {
    fn to_sql(&self) -> Result<ToSqlOutput<'_>> {
        macro_rules! box_to_sql {
            ($v:expr) => {
                match $v {
                    Some(v) => v.as_ref().to_sql(),
                    None => Null.to_sql(),
                }
            };
        }

        match &self.0 {
            Value::Bool(v) => v.to_sql(),
            Value::TinyInt(v) => v.to_sql(),
            Value::SmallInt(v) => v.to_sql(),
            Value::Int(v) => v.to_sql(),
            Value::BigInt(v) => v.to_sql(),
            Value::TinyUnsigned(v) => v.to_sql(),
            Value::SmallUnsigned(v) => v.to_sql(),
            Value::Unsigned(v) => v.to_sql(),
            // SQLite has no unsigned 64-bit column; rusqlite ≥ 0.38 stopped
            // pretending otherwise. Refuse rather than wrap on overflow.
            Value::BigUnsigned(v) => match v {
                Some(v) => i64::try_from(*v)
                    .map(ToSqlOutput::from)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e))),
                None => Null.to_sql(),
            },
            Value::Float(v) => v.to_sql(),
            Value::Double(v) => v.to_sql(),
            Value::String(v) => box_to_sql!(v),
            Value::Char(v) => match v {
                Some(v) => Ok(ToSqlOutput::from(v.to_string())),
                None => Null.to_sql(),
            },
            Value::Bytes(v) => box_to_sql!(v),
            Value::ChronoDate(v) => box_to_sql!(v),
            Value::ChronoTime(v) => box_to_sql!(v),
            Value::ChronoDateTime(v) => box_to_sql!(v),
            Value::ChronoDateTimeUtc(v) => box_to_sql!(v),
            Value::ChronoDateTimeLocal(v) => box_to_sql!(v),
            Value::ChronoDateTimeWithTimeZone(v) => box_to_sql!(v),
        }
    }
}
