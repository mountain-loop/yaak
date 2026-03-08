use crate::error::Result;
use crate::models::{AnyModel, UpsertModelInfo};
use crate::util::{ModelChangeEvent, ModelPayload, UpdateSource};
use rusqlite::params;
use sea_query::{IntoColumnRef, IntoIden, SimpleExpr};
use std::fmt::Debug;
use std::sync::mpsc;
use yaak_database::DbContext;

pub struct ClientDb<'a> {
    pub(crate) ctx: DbContext<'a>,
    pub(crate) events_tx: mpsc::Sender<ModelPayload>,
}

impl<'a> ClientDb<'a> {
    pub fn new(ctx: DbContext<'a>, events_tx: mpsc::Sender<ModelPayload>) -> Self {
        Self { ctx, events_tx }
    }

    /// Access the underlying connection for custom queries.
    pub(crate) fn conn(&self) -> &yaak_database::ConnectionOrTx<'a> {
        self.ctx.conn()
    }

    // --- Read delegates (thin wrappers over DbContext) ---

    pub(crate) fn find_one<M>(
        &self,
        col: impl IntoColumnRef + IntoIden + Clone,
        value: impl Into<SimpleExpr> + Debug,
    ) -> Result<M>
    where
        M: UpsertModelInfo,
    {
        Ok(self.ctx.find_one(col, value)?)
    }

    pub(crate) fn find_optional<M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
    ) -> Option<M>
    where
        M: UpsertModelInfo,
    {
        self.ctx.find_optional(col, value)
    }

    pub(crate) fn find_all<M>(&self) -> Result<Vec<M>>
    where
        M: UpsertModelInfo,
    {
        Ok(self.ctx.find_all()?)
    }

    pub(crate) fn find_many<M>(
        &self,
        col: impl IntoColumnRef,
        value: impl Into<SimpleExpr>,
        limit: Option<u64>,
    ) -> Result<Vec<M>>
    where
        M: UpsertModelInfo,
    {
        Ok(self.ctx.find_many(col, value, limit)?)
    }

    // --- Write operations (with event recording) ---

    pub(crate) fn upsert<M>(&self, model: &M, source: &UpdateSource) -> Result<M>
    where
        M: Into<AnyModel> + UpsertModelInfo + Clone,
    {
        let (m, created) = self.ctx.upsert(model, &source.to_db())?;

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Upsert { created },
        };

        self.record_model_change(&payload)?;
        let _ = self.events_tx.send(payload);

        Ok(m)
    }

    pub(crate) fn delete<M>(&self, m: &M, source: &UpdateSource) -> Result<M>
    where
        M: Into<AnyModel> + Clone + UpsertModelInfo,
    {
        self.ctx.delete(m)?;

        let payload = ModelPayload {
            model: m.clone().into(),
            update_source: source.clone(),
            change: ModelChangeEvent::Delete,
        };

        self.record_model_change(&payload)?;
        let _ = self.events_tx.send(payload);

        Ok(m.clone())
    }

    fn record_model_change(&self, payload: &ModelPayload) -> Result<()> {
        let payload_json = serde_json::to_string(payload)?;
        let source_json = serde_json::to_string(&payload.update_source)?;
        let change_json = serde_json::to_string(&payload.change)?;

        self.ctx.conn().resolve().execute(
            r#"
                INSERT INTO model_changes (model, model_id, change, update_source, payload)
                VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                payload.model.model(),
                payload.model.id(),
                change_json,
                source_json,
                payload_json,
            ],
        )?;

        Ok(())
    }
}
