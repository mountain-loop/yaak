use chrono::NaiveDateTime;
use rusqlite::Row;
use sea_query::{IntoColumnRef, IntoIden, IntoTableRef, Order, SimpleExpr, enum_def};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::{ModelChangeEvent, Result as DbResult, UpdateSource, UpsertModelInfo, generate_prefixed_id, upsert_date};

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ProxyHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "http_exchanges")]
pub struct HttpExchange {
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub url: String,
    pub method: String,
    pub req_headers: Vec<ProxyHeader>,
    pub req_body: Option<Vec<u8>>,
    pub res_status: Option<i32>,
    pub res_headers: Vec<ProxyHeader>,
    pub res_body: Option<Vec<u8>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ModelPayload {
    pub model: HttpExchange,
    pub change: ModelChangeEvent,
}

impl UpsertModelInfo for HttpExchange {
    fn table_name() -> impl IntoTableRef + IntoIden {
        HttpExchangeIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        HttpExchangeIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("he")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (HttpExchangeIden::CreatedAt, Order::Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> DbResult<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use HttpExchangeIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (Url, self.url.into()),
            (Method, self.method.into()),
            (ReqHeaders, serde_json::to_string(&self.req_headers)?.into()),
            (ReqBody, self.req_body.into()),
            (ResStatus, self.res_status.into()),
            (ResHeaders, serde_json::to_string(&self.res_headers)?.into()),
            (ResBody, self.res_body.into()),
            (Error, self.error.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            HttpExchangeIden::UpdatedAt,
            HttpExchangeIden::Url,
            HttpExchangeIden::Method,
            HttpExchangeIden::ReqHeaders,
            HttpExchangeIden::ReqBody,
            HttpExchangeIden::ResStatus,
            HttpExchangeIden::ResHeaders,
            HttpExchangeIden::ResBody,
            HttpExchangeIden::Error,
        ]
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let req_headers: String = r.get("req_headers")?;
        let res_headers: String = r.get("res_headers")?;
        Ok(Self {
            id: r.get("id")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            url: r.get("url")?,
            method: r.get("method")?,
            req_headers: serde_json::from_str(&req_headers).unwrap_or_default(),
            req_body: r.get("req_body")?,
            res_status: r.get("res_status")?,
            res_headers: serde_json::from_str(&res_headers).unwrap_or_default(),
            res_body: r.get("res_body")?,
            error: r.get("error")?,
        })
    }
}
