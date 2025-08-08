use crate::error::Result;
use crate::models::HttpRequestIden::{
    Authentication, AuthenticationType, Body, BodyType, CreatedAt, Description, FolderId, Headers,
    Method, Name, SortPriority, UpdatedAt, Url, UrlParameters, WorkspaceId,
};
use crate::util::{UpdateSource, generate_prefixed_id};
use chrono::{NaiveDateTime, Utc};
use rusqlite::Row;
use sea_query::Order::Desc;
use sea_query::{IntoColumnRef, IntoIden, IntoTableRef, Order, SimpleExpr, enum_def};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::{Debug, Display};
use std::str::FromStr;
use ts_rs::TS;

#[macro_export]
macro_rules! impl_model {
    ($t:ty, $variant:ident) => {
        impl $crate::Model for $t {
            fn into_any(self) -> $crate::AnyModel {
                $crate::AnyModel::$variant(self)
            }
        }
    };
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum ProxySetting {
    Enabled {
        http: String,
        https: String,
        auth: Option<ProxySettingAuth>,

        // These were added later, so give them defaults
        #[serde(default)]
        bypass: String,
        #[serde(default)]
        disabled: bool,
    },
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ProxySettingAuth {
    pub user: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum EditorKeymap {
    Default,
    Vim,
    Vscode,
    Emacs,
}

impl FromStr for EditorKeymap {
    type Err = crate::error::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "default" => Ok(Self::Default),
            "vscode" => Ok(Self::Vscode),
            "vim" => Ok(Self::Vim),
            "emacs" => Ok(Self::Emacs),
            _ => Ok(Self::default()),
        }
    }
}

impl Display for EditorKeymap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            EditorKeymap::Default => "default".to_string(),
            EditorKeymap::Vscode => "vscode".to_string(),
            EditorKeymap::Vim => "vim".to_string(),
            EditorKeymap::Emacs => "emacs".to_string(),
        };
        write!(f, "{}", str)
    }
}

impl Default for EditorKeymap {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "settings")]
pub struct Settings {
    #[ts(type = "\"settings\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    pub appearance: String,
    pub colored_methods: bool,
    pub editor_font: Option<String>,
    pub editor_font_size: i32,
    pub editor_keymap: EditorKeymap,
    pub editor_soft_wrap: bool,
    pub hide_window_controls: bool,
    pub interface_font: Option<String>,
    pub interface_font_size: i32,
    pub interface_scale: f32,
    pub open_workspace_new_window: Option<bool>,
    pub proxy: Option<ProxySetting>,
    pub theme_dark: String,
    pub theme_light: String,
    pub update_channel: String,
    pub autoupdate: bool,
}

impl UpsertModelInfo for Settings {
    fn table_name() -> impl IntoTableRef + IntoIden {
        SettingsIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        SettingsIden::Id
    }

    fn generate_id() -> String {
        panic!("Settings does not have unique IDs")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (SettingsIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use SettingsIden::*;
        let proxy = match self.proxy {
            None => None,
            Some(p) => Some(serde_json::to_string(&p)?),
        };
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (Appearance, self.appearance.as_str().into()),
            (EditorFontSize, self.editor_font_size.into()),
            (EditorKeymap, self.editor_keymap.to_string().into()),
            (EditorSoftWrap, self.editor_soft_wrap.into()),
            (EditorFont, self.editor_font.into()),
            (InterfaceFont, self.interface_font.into()),
            (InterfaceFontSize, self.interface_font_size.into()),
            (InterfaceScale, self.interface_scale.into()),
            (HideWindowControls, self.hide_window_controls.into()),
            (OpenWorkspaceNewWindow, self.open_workspace_new_window.into()),
            (ThemeDark, self.theme_dark.as_str().into()),
            (ThemeLight, self.theme_light.as_str().into()),
            (UpdateChannel, self.update_channel.into()),
            (Autoupdate, self.autoupdate.into()),
            (ColoredMethods, self.colored_methods.into()),
            (Proxy, proxy.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            SettingsIden::UpdatedAt,
            SettingsIden::Appearance,
            SettingsIden::EditorFontSize,
            SettingsIden::EditorKeymap,
            SettingsIden::EditorSoftWrap,
            SettingsIden::EditorFont,
            SettingsIden::InterfaceFontSize,
            SettingsIden::InterfaceScale,
            SettingsIden::InterfaceFont,
            SettingsIden::HideWindowControls,
            SettingsIden::OpenWorkspaceNewWindow,
            SettingsIden::Proxy,
            SettingsIden::ThemeDark,
            SettingsIden::ThemeLight,
            SettingsIden::UpdateChannel,
            SettingsIden::Autoupdate,
            SettingsIden::ColoredMethods,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let proxy: Option<String> = row.get("proxy")?;
        let editor_keymap: String = row.get("editor_keymap")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            appearance: row.get("appearance")?,
            editor_font_size: row.get("editor_font_size")?,
            editor_font: row.get("editor_font")?,
            editor_keymap: EditorKeymap::from_str(editor_keymap.as_str()).unwrap(),
            editor_soft_wrap: row.get("editor_soft_wrap")?,
            interface_font_size: row.get("interface_font_size")?,
            interface_scale: row.get("interface_scale")?,
            interface_font: row.get("interface_font")?,
            open_workspace_new_window: row.get("open_workspace_new_window")?,
            proxy: proxy.map(|p| -> ProxySetting { serde_json::from_str(p.as_str()).unwrap() }),
            theme_dark: row.get("theme_dark")?,
            theme_light: row.get("theme_light")?,
            hide_window_controls: row.get("hide_window_controls")?,
            update_channel: row.get("update_channel")?,
            autoupdate: row.get("autoupdate")?,
            colored_methods: row.get("colored_methods")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "workspaces")]
pub struct Workspace {
    #[ts(type = "\"workspace\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
    pub description: String,
    pub headers: Vec<HttpRequestHeader>,
    pub name: String,
    pub encryption_key_challenge: Option<String>,

    // Settings
    #[serde(default = "default_true")]
    pub setting_validate_certificates: bool,
    #[serde(default = "default_true")]
    pub setting_follow_redirects: bool,
    pub setting_request_timeout: i32,
}

impl UpsertModelInfo for Workspace {
    fn table_name() -> impl IntoTableRef + IntoIden {
        WorkspaceIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        WorkspaceIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("wk")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (WorkspaceIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use WorkspaceIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (Name, self.name.trim().into()),
            (Authentication, serde_json::to_string(&self.authentication)?.into()),
            (AuthenticationType, self.authentication_type.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (Description, self.description.into()),
            (EncryptionKeyChallenge, self.encryption_key_challenge.into()),
            (SettingFollowRedirects, self.setting_follow_redirects.into()),
            (SettingRequestTimeout, self.setting_request_timeout.into()),
            (SettingValidateCertificates, self.setting_validate_certificates.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            WorkspaceIden::UpdatedAt,
            WorkspaceIden::Name,
            WorkspaceIden::Authentication,
            WorkspaceIden::AuthenticationType,
            WorkspaceIden::Headers,
            WorkspaceIden::Description,
            WorkspaceIden::EncryptionKeyChallenge,
            WorkspaceIden::SettingRequestTimeout,
            WorkspaceIden::SettingFollowRedirects,
            WorkspaceIden::SettingRequestTimeout,
            WorkspaceIden::SettingValidateCertificates,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let headers: String = row.get("headers")?;
        let authentication: String = row.get("authentication")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            name: row.get("name")?,
            description: row.get("description")?,
            encryption_key_challenge: row.get("encryption_key_challenge")?,
            headers: serde_json::from_str(&headers).unwrap_or_default(),
            authentication: serde_json::from_str(&authentication).unwrap_or_default(),
            authentication_type: row.get("authentication_type")?,
            setting_follow_redirects: row.get("setting_follow_redirects")?,
            setting_request_timeout: row.get("setting_request_timeout")?,
            setting_validate_certificates: row.get("setting_validate_certificates")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct EncryptedKey {
    pub encrypted_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "workspace_metas")]
pub struct WorkspaceMeta {
    #[ts(type = "\"workspace_meta\"")]
    pub model: String,
    pub id: String,
    pub workspace_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub encryption_key: Option<EncryptedKey>,
    pub setting_sync_dir: Option<String>,
}

impl UpsertModelInfo for WorkspaceMeta {
    fn table_name() -> impl IntoTableRef + IntoIden {
        WorkspaceMetaIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        WorkspaceMetaIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("wm")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (WorkspaceMetaIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use WorkspaceMetaIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (EncryptionKey, self.encryption_key.map(|e| serde_json::to_string(&e).unwrap()).into()),
            (SettingSyncDir, self.setting_sync_dir.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            WorkspaceMetaIden::UpdatedAt,
            WorkspaceMetaIden::EncryptionKey,
            WorkspaceMetaIden::SettingSyncDir,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let encryption_key: Option<String> = row.get("encryption_key")?;
        Ok(Self {
            id: row.get("id")?,
            workspace_id: row.get("workspace_id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            encryption_key: encryption_key.map(|e| serde_json::from_str(&e).unwrap()),
            setting_sync_dir: row.get("setting_sync_dir")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_models.ts")]
pub enum CookieDomain {
    HostOnly(String),
    Suffix(String),
    NotPresent,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_models.ts")]
pub enum CookieExpires {
    AtUtc(String),
    SessionEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_models.ts")]
pub struct Cookie {
    pub raw_cookie: String,
    pub domain: CookieDomain,
    pub expires: CookieExpires,
    pub path: (String, bool),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "cookie_jars")]
pub struct CookieJar {
    #[ts(type = "\"cookie_jar\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,

    pub cookies: Vec<Cookie>,
    pub name: String,
}

impl UpsertModelInfo for CookieJar {
    fn table_name() -> impl IntoTableRef + IntoIden {
        CookieJarIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        CookieJarIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("cj")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (CookieJarIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use CookieJarIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (Name, self.name.trim().into()),
            (Cookies, serde_json::to_string(&self.cookies)?.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            CookieJarIden::UpdatedAt,
            CookieJarIden::Name,
            CookieJarIden::Cookies,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let cookies: String = row.get("cookies")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            name: row.get("name")?,
            cookies: serde_json::from_str(cookies.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "environments")]
pub struct Environment {
    #[ts(type = "\"environment\"")]
    pub model: String,
    pub id: String,
    pub workspace_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    pub name: String,
    pub public: bool,
    pub base: bool,
    pub variables: Vec<EnvironmentVariable>,
    pub color: Option<String>,
}

impl UpsertModelInfo for Environment {
    fn table_name() -> impl IntoTableRef + IntoIden {
        EnvironmentIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        EnvironmentIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("ev")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (EnvironmentIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use EnvironmentIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (Base, self.base.into()),
            (Color, self.color.into()),
            (Name, self.name.trim().into()),
            (Public, self.public.into()),
            (Variables, serde_json::to_string(&self.variables)?.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            EnvironmentIden::UpdatedAt,
            EnvironmentIden::Base,
            EnvironmentIden::Color,
            EnvironmentIden::Name,
            EnvironmentIden::Public,
            EnvironmentIden::Variables,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let variables: String = row.get("variables")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            base: row.get("base")?,
            color: row.get("color")?,
            name: row.get("name")?,
            public: row.get("public")?,
            variables: serde_json::from_str(variables.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct EnvironmentVariable {
    #[serde(default = "default_true")]
    #[ts(optional, as = "Option<bool>")]
    pub enabled: bool,
    pub name: String,
    pub value: String,
    #[ts(optional, as = "Option<String>")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ParentAuthentication {
    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ParentHeaders {
    pub headers: Vec<HttpRequestHeader>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "folders")]
pub struct Folder {
    #[ts(type = "\"folder\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub folder_id: Option<String>,

    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
    pub description: String,
    pub headers: Vec<HttpRequestHeader>,
    pub name: String,
    pub sort_priority: f32,
}

impl UpsertModelInfo for Folder {
    fn table_name() -> impl IntoTableRef + IntoIden {
        FolderIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        FolderIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("fl")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (FolderIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use FolderIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (FolderId, self.folder_id.into()),
            (Authentication, serde_json::to_string(&self.authentication)?.into()),
            (AuthenticationType, self.authentication_type.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (Description, self.description.into()),
            (Name, self.name.trim().into()),
            (SortPriority, self.sort_priority.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            FolderIden::UpdatedAt,
            FolderIden::Name,
            FolderIden::Authentication,
            FolderIden::AuthenticationType,
            FolderIden::Headers,
            FolderIden::Description,
            FolderIden::FolderId,
            FolderIden::SortPriority,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let headers: String = row.get("headers")?;
        let authentication: String = row.get("authentication")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            sort_priority: row.get("sort_priority")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            folder_id: row.get("folder_id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            headers: serde_json::from_str(&headers).unwrap_or_default(),
            authentication_type: row.get("authentication_type")?,
            authentication: serde_json::from_str(&authentication).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct HttpRequestHeader {
    #[serde(default = "default_true")]
    #[ts(optional, as = "Option<bool>")]
    pub enabled: bool,
    pub name: String,
    pub value: String,
    #[ts(optional, as = "Option<String>")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct HttpUrlParameter {
    #[serde(default = "default_true")]
    #[ts(optional, as = "Option<bool>")]
    pub enabled: bool,
    pub name: String,
    pub value: String,
    #[ts(optional, as = "Option<String>")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "http_requests")]
pub struct HttpRequest {
    #[ts(type = "\"http_request\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub folder_id: Option<String>,

    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
    #[ts(type = "Record<string, any>")]
    pub body: BTreeMap<String, Value>,
    pub body_type: Option<String>,
    pub description: String,
    pub headers: Vec<HttpRequestHeader>,
    #[serde(default = "default_http_method")]
    pub method: String,
    pub name: String,
    pub sort_priority: f64,
    pub url: String,
    pub url_parameters: Vec<HttpUrlParameter>,
}

impl UpsertModelInfo for HttpRequest {
    fn table_name() -> impl IntoTableRef + IntoIden {
        HttpRequestIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        HttpRequestIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("rq")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (HttpResponseIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.to_string()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (FolderId, self.folder_id.into()),
            (Name, self.name.trim().into()),
            (Description, self.description.into()),
            (Url, self.url.into()),
            (UrlParameters, serde_json::to_string(&self.url_parameters)?.into()),
            (Method, self.method.into()),
            (Body, serde_json::to_string(&self.body)?.into()),
            (BodyType, self.body_type.into()),
            (Authentication, serde_json::to_string(&self.authentication)?.into()),
            (AuthenticationType, self.authentication_type.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (SortPriority, self.sort_priority.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            UpdatedAt,
            WorkspaceId,
            Name,
            Description,
            FolderId,
            Method,
            Headers,
            Body,
            BodyType,
            Authentication,
            AuthenticationType,
            Url,
            UrlParameters,
            SortPriority,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        let url_parameters: String = row.get("url_parameters")?;
        let body: String = row.get("body")?;
        let authentication: String = row.get("authentication")?;
        let headers: String = row.get("headers")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            authentication: serde_json::from_str(authentication.as_str()).unwrap_or_default(),
            authentication_type: row.get("authentication_type")?,
            body: serde_json::from_str(body.as_str()).unwrap_or_default(),
            body_type: row.get("body_type")?,
            description: row.get("description")?,
            folder_id: row.get("folder_id")?,
            headers: serde_json::from_str(headers.as_str()).unwrap_or_default(),
            method: row.get("method")?,
            name: row.get("name")?,
            sort_priority: row.get("sort_priority")?,
            url: row.get("url")?,
            url_parameters: serde_json::from_str(url_parameters.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum WebsocketConnectionState {
    Initialized,
    Connected,
    Closing,
    Closed,
}

impl Default for WebsocketConnectionState {
    fn default() -> Self {
        Self::Initialized
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "websocket_connections")]
pub struct WebsocketConnection {
    #[ts(type = "\"websocket_connection\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,

    pub elapsed: i32,
    pub error: Option<String>,
    pub headers: Vec<HttpResponseHeader>,
    pub state: WebsocketConnectionState,
    pub status: i32,
    pub url: String,
}

impl UpsertModelInfo for WebsocketConnection {
    fn table_name() -> impl IntoTableRef + IntoIden {
        WebsocketConnectionIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        WebsocketConnectionIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("wc")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (WebsocketConnectionIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use WebsocketConnectionIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (RequestId, self.request_id.into()),
            (Elapsed, self.elapsed.into()),
            (Error, self.error.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (State, serde_json::to_value(&self.state)?.as_str().into()),
            (Status, self.status.into()),
            (Url, self.url.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            WebsocketConnectionIden::UpdatedAt,
            WebsocketConnectionIden::Elapsed,
            WebsocketConnectionIden::Error,
            WebsocketConnectionIden::Headers,
            WebsocketConnectionIden::State,
            WebsocketConnectionIden::Status,
            WebsocketConnectionIden::Url,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let headers: String = row.get("headers")?;
        let state: String = row.get("state")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            request_id: row.get("request_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            url: row.get("url")?,
            headers: serde_json::from_str(headers.as_str()).unwrap_or_default(),
            elapsed: row.get("elapsed")?,
            error: row.get("error")?,
            state: serde_json::from_str(format!(r#""{state}""#).as_str()).unwrap(),
            status: row.get("status")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum WebsocketMessageType {
    Text,
    Binary,
}

impl Default for WebsocketMessageType {
    fn default() -> Self {
        Self::Text
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "websocket_requests")]
pub struct WebsocketRequest {
    #[ts(type = "\"websocket_request\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub folder_id: Option<String>,

    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub authentication_type: Option<String>,
    pub description: String,
    pub headers: Vec<HttpRequestHeader>,
    pub message: String,
    pub name: String,
    pub sort_priority: f32,
    pub url: String,
    pub url_parameters: Vec<HttpUrlParameter>,
}

impl UpsertModelInfo for WebsocketRequest {
    fn table_name() -> impl IntoTableRef + IntoIden {
        WebsocketRequestIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        WebsocketRequestIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("wr")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (WebsocketRequestIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use WebsocketRequestIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (FolderId, self.folder_id.as_ref().map(|s| s.as_str()).into()),
            (Authentication, serde_json::to_string(&self.authentication)?.into()),
            (AuthenticationType, self.authentication_type.into()),
            (Description, self.description.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (Message, self.message.into()),
            (Name, self.name.trim().into()),
            (SortPriority, self.sort_priority.into()),
            (Url, self.url.into()),
            (UrlParameters, serde_json::to_string(&self.url_parameters)?.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            WebsocketRequestIden::UpdatedAt,
            WebsocketRequestIden::WorkspaceId,
            WebsocketRequestIden::FolderId,
            WebsocketRequestIden::Authentication,
            WebsocketRequestIden::AuthenticationType,
            WebsocketRequestIden::Description,
            WebsocketRequestIden::Headers,
            WebsocketRequestIden::Message,
            WebsocketRequestIden::Name,
            WebsocketRequestIden::SortPriority,
            WebsocketRequestIden::Url,
            WebsocketRequestIden::UrlParameters,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let url_parameters: String = row.get("url_parameters")?;
        let authentication: String = row.get("authentication")?;
        let headers: String = row.get("headers")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            sort_priority: row.get("sort_priority")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            url: row.get("url")?,
            url_parameters: serde_json::from_str(url_parameters.as_str()).unwrap_or_default(),
            message: row.get("message")?,
            description: row.get("description")?,
            authentication: serde_json::from_str(authentication.as_str()).unwrap_or_default(),
            authentication_type: row.get("authentication_type")?,
            headers: serde_json::from_str(headers.as_str()).unwrap_or_default(),
            folder_id: row.get("folder_id")?,
            name: row.get("name")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum WebsocketEventType {
    Binary,
    Close,
    Frame,
    Open,
    Ping,
    Pong,
    Text,
}

impl Default for WebsocketEventType {
    fn default() -> Self {
        Self::Text
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "websocket_events")]
pub struct WebsocketEvent {
    #[ts(type = "\"websocket_event\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,
    pub connection_id: String,
    pub is_server: bool,

    pub message: Vec<u8>,
    pub message_type: WebsocketEventType,
}

impl UpsertModelInfo for WebsocketEvent {
    fn table_name() -> impl IntoTableRef + IntoIden {
        WebsocketEventIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        WebsocketEventIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("we")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (WebsocketEventIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use WebsocketEventIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (ConnectionId, self.connection_id.into()),
            (RequestId, self.request_id.into()),
            (MessageType, serde_json::to_string(&self.message_type)?.into()),
            (IsServer, self.is_server.into()),
            (Message, self.message.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            WebsocketEventIden::UpdatedAt,
            WebsocketEventIden::MessageType,
            WebsocketEventIden::IsServer,
            WebsocketEventIden::Message,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let message_type: String = row.get("message_type")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            request_id: row.get("request_id")?,
            connection_id: row.get("connection_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            message: row.get("message")?,
            is_server: row.get("is_server")?,
            message_type: serde_json::from_str(message_type.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct HttpResponseHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum HttpResponseState {
    Initialized,
    Connected,
    Closed,
}

impl Default for HttpResponseState {
    fn default() -> Self {
        Self::Initialized
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "http_responses")]
pub struct HttpResponse {
    #[ts(type = "\"http_response\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,

    pub body_path: Option<String>,
    pub content_length: Option<i32>,
    pub elapsed: i32,
    pub elapsed_headers: i32,
    pub error: Option<String>,
    pub headers: Vec<HttpResponseHeader>,
    pub remote_addr: Option<String>,
    pub status: i32,
    pub status_reason: Option<String>,
    pub state: HttpResponseState,
    pub url: String,
    pub version: Option<String>,
}

impl UpsertModelInfo for HttpResponse {
    fn table_name() -> impl IntoTableRef + IntoIden {
        HttpResponseIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        HttpResponseIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("rs")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (HttpResponseIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use HttpResponseIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (RequestId, self.request_id.into()),
            (WorkspaceId, self.workspace_id.into()),
            (BodyPath, self.body_path.into()),
            (ContentLength, self.content_length.into()),
            (Elapsed, self.elapsed.into()),
            (ElapsedHeaders, self.elapsed_headers.into()),
            (Error, self.error.into()),
            (Headers, serde_json::to_string(&self.headers)?.into()),
            (RemoteAddr, self.remote_addr.into()),
            (State, serde_json::to_value(self.state)?.as_str().into()),
            (Status, self.status.into()),
            (StatusReason, self.status_reason.into()),
            (Url, self.url.into()),
            (Version, self.version.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            HttpResponseIden::UpdatedAt,
            HttpResponseIden::BodyPath,
            HttpResponseIden::ContentLength,
            HttpResponseIden::Elapsed,
            HttpResponseIden::ElapsedHeaders,
            HttpResponseIden::Error,
            HttpResponseIden::Headers,
            HttpResponseIden::RemoteAddr,
            HttpResponseIden::State,
            HttpResponseIden::Status,
            HttpResponseIden::StatusReason,
            HttpResponseIden::Url,
            HttpResponseIden::Version,
        ]
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let headers: String = r.get("headers")?;
        let state: String = r.get("state")?;
        Ok(Self {
            id: r.get("id")?,
            model: r.get("model")?,
            workspace_id: r.get("workspace_id")?,
            request_id: r.get("request_id")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            error: r.get("error")?,
            url: r.get("url")?,
            content_length: r.get("content_length")?,
            version: r.get("version")?,
            elapsed: r.get("elapsed")?,
            elapsed_headers: r.get("elapsed_headers")?,
            remote_addr: r.get("remote_addr")?,
            status: r.get("status")?,
            status_reason: r.get("status_reason")?,
            state: serde_json::from_str(format!(r#""{state}""#).as_str()).unwrap(),
            body_path: r.get("body_path")?,
            headers: serde_json::from_str(headers.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "graphql_introspections")]
pub struct GraphQlIntrospection {
    #[ts(type = "\"graphql_introspection\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,
    pub content: Option<String>,
}

impl UpsertModelInfo for GraphQlIntrospection {
    fn table_name() -> impl IntoTableRef + IntoIden {
        GraphQlIntrospectionIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        GraphQlIntrospectionIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("gi")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (GraphQlIntrospectionIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use GraphQlIntrospectionIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (RequestId, self.request_id.into()),
            (Content, self.content.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            GraphQlIntrospectionIden::UpdatedAt,
            GraphQlIntrospectionIden::Content,
        ]
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        Ok(Self {
            id: r.get("id")?,
            model: r.get("model")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            workspace_id: r.get("workspace_id")?,
            request_id: r.get("request_id")?,
            content: r.get("content")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "grpc_requests")]
pub struct GrpcRequest {
    #[ts(type = "\"grpc_request\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub folder_id: Option<String>,

    pub authentication_type: Option<String>,
    #[ts(type = "Record<string, any>")]
    pub authentication: BTreeMap<String, Value>,
    pub description: String,
    pub message: String,
    pub metadata: Vec<HttpRequestHeader>,
    pub method: Option<String>,
    pub name: String,
    pub service: Option<String>,
    pub sort_priority: f32,
    pub url: String,
}

impl UpsertModelInfo for GrpcRequest {
    fn table_name() -> impl IntoTableRef + IntoIden {
        GrpcRequestIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        GrpcRequestIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("gr")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (GrpcRequestIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use GrpcRequestIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (Name, self.name.trim().into()),
            (Description, self.description.into()),
            (WorkspaceId, self.workspace_id.into()),
            (FolderId, self.folder_id.into()),
            (SortPriority, self.sort_priority.into()),
            (Url, self.url.into()),
            (Service, self.service.into()),
            (Method, self.method.into()),
            (Message, self.message.into()),
            (AuthenticationType, self.authentication_type.into()),
            (Authentication, serde_json::to_string(&self.authentication)?.into()),
            (Metadata, serde_json::to_string(&self.metadata)?.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            GrpcRequestIden::UpdatedAt,
            GrpcRequestIden::WorkspaceId,
            GrpcRequestIden::Name,
            GrpcRequestIden::Description,
            GrpcRequestIden::FolderId,
            GrpcRequestIden::SortPriority,
            GrpcRequestIden::Url,
            GrpcRequestIden::Service,
            GrpcRequestIden::Method,
            GrpcRequestIden::Message,
            GrpcRequestIden::AuthenticationType,
            GrpcRequestIden::Authentication,
            GrpcRequestIden::Metadata,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let authentication: String = row.get("authentication")?;
        let metadata: String = row.get("metadata")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            folder_id: row.get("folder_id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            service: row.get("service")?,
            method: row.get("method")?,
            message: row.get("message")?,
            authentication_type: row.get("authentication_type")?,
            authentication: serde_json::from_str(authentication.as_str()).unwrap_or_default(),
            url: row.get("url")?,
            sort_priority: row.get("sort_priority")?,
            metadata: serde_json::from_str(metadata.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum GrpcConnectionState {
    Initialized,
    Connected,
    Closed,
}

impl Default for GrpcConnectionState {
    fn default() -> Self {
        Self::Initialized
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "grpc_connections")]
pub struct GrpcConnection {
    #[ts(type = "\"grpc_connection\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,

    pub elapsed: i32,
    pub error: Option<String>,
    pub method: String,
    pub service: String,
    pub status: i32,
    pub state: GrpcConnectionState,
    pub trailers: BTreeMap<String, String>,
    pub url: String,
}

impl UpsertModelInfo for GrpcConnection {
    fn table_name() -> impl IntoTableRef + IntoIden {
        GrpcConnectionIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        GrpcConnectionIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("gc")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (GrpcConnectionIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use GrpcConnectionIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (RequestId, self.request_id.into()),
            (Service, self.service.into()),
            (Method, self.method.into()),
            (Elapsed, self.elapsed.into()),
            (State, serde_json::to_value(&self.state)?.as_str().into()),
            (Status, self.status.into()),
            (Error, self.error.as_ref().map(|s| s.as_str()).into()),
            (Trailers, serde_json::to_string(&self.trailers)?.into()),
            (Url, self.url.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            GrpcConnectionIden::UpdatedAt,
            GrpcConnectionIden::Service,
            GrpcConnectionIden::Method,
            GrpcConnectionIden::Elapsed,
            GrpcConnectionIden::Status,
            GrpcConnectionIden::State,
            GrpcConnectionIden::Error,
            GrpcConnectionIden::Trailers,
            GrpcConnectionIden::Url,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let trailers: String = row.get("trailers")?;
        let state: String = row.get("state")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            request_id: row.get("request_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            service: row.get("service")?,
            method: row.get("method")?,
            elapsed: row.get("elapsed")?,
            state: serde_json::from_str(format!(r#""{state}""#).as_str()).unwrap(),
            status: row.get("status")?,
            url: row.get("url")?,
            error: row.get("error")?,
            trailers: serde_json::from_str(trailers.as_str()).unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum GrpcEventType {
    Info,
    Error,
    ClientMessage,
    ServerMessage,
    ConnectionStart,
    ConnectionEnd,
}

impl Default for GrpcEventType {
    fn default() -> Self {
        GrpcEventType::Info
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "grpc_events")]
pub struct GrpcEvent {
    #[ts(type = "\"grpc_event\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub workspace_id: String,
    pub request_id: String,
    pub connection_id: String,

    pub content: String,
    pub error: Option<String>,
    pub event_type: GrpcEventType,
    pub metadata: BTreeMap<String, String>,
    pub status: Option<i32>,
}

impl UpsertModelInfo for GrpcEvent {
    fn table_name() -> impl IntoTableRef + IntoIden {
        GrpcEventIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        GrpcEventIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("ge")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (GrpcEventIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use GrpcEventIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (RequestId, self.request_id.into()),
            (ConnectionId, self.connection_id.into()),
            (Content, self.content.into()),
            (EventType, serde_json::to_string(&self.event_type)?.into()),
            (Metadata, serde_json::to_string(&self.metadata)?.into()),
            (Status, self.status.into()),
            (Error, self.error.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            GrpcEventIden::UpdatedAt,
            GrpcEventIden::Content,
            GrpcEventIden::EventType,
            GrpcEventIden::Metadata,
            GrpcEventIden::Status,
            GrpcEventIden::Error,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        let event_type: String = row.get("event_type")?;
        let metadata: String = row.get("metadata")?;
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            workspace_id: row.get("workspace_id")?,
            request_id: row.get("request_id")?,
            connection_id: row.get("connection_id")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            content: row.get("content")?,
            event_type: serde_json::from_str(event_type.as_str()).unwrap_or_default(),
            metadata: serde_json::from_str(metadata.as_str()).unwrap_or_default(),
            status: row.get("status")?,
            error: row.get("error")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "plugins")]
pub struct Plugin {
    #[ts(type = "\"plugin\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    pub checked_at: Option<NaiveDateTime>,
    pub directory: String,
    pub enabled: bool,
    pub url: Option<String>,
}

impl UpsertModelInfo for Plugin {
    fn table_name() -> impl IntoTableRef + IntoIden {
        PluginIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        PluginIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("pg")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (PluginIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use PluginIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (CheckedAt, self.checked_at.into()),
            (Directory, self.directory.into()),
            (Url, self.url.into()),
            (Enabled, self.enabled.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            PluginIden::UpdatedAt,
            PluginIden::CheckedAt,
            PluginIden::Directory,
            PluginIden::Url,
            PluginIden::Enabled,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            checked_at: row.get("checked_at")?,
            url: row.get("url")?,
            directory: row.get("directory")?,
            enabled: row.get("enabled")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "sync_states")]
pub struct SyncState {
    #[ts(type = "\"sync_state\"")]
    pub model: String,
    pub id: String,
    pub workspace_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub flushed_at: NaiveDateTime,

    pub model_id: String,
    pub checksum: String,
    pub rel_path: String,
    pub sync_dir: String,
}

impl UpsertModelInfo for SyncState {
    fn table_name() -> impl IntoTableRef + IntoIden {
        SyncStateIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        SyncStateIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("ss")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (SyncStateIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use SyncStateIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (WorkspaceId, self.workspace_id.into()),
            (FlushedAt, self.flushed_at.into()),
            (Checksum, self.checksum.into()),
            (ModelId, self.model_id.into()),
            (RelPath, self.rel_path.into()),
            (SyncDir, self.sync_dir.into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![
            SyncStateIden::UpdatedAt,
            SyncStateIden::FlushedAt,
            SyncStateIden::Checksum,
            SyncStateIden::RelPath,
            SyncStateIden::SyncDir,
        ]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        Ok(Self {
            id: row.get("id")?,
            workspace_id: row.get("workspace_id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            flushed_at: row.get("flushed_at")?,
            checksum: row.get("checksum")?,
            model_id: row.get("model_id")?,
            sync_dir: row.get("sync_dir")?,
            rel_path: row.get("rel_path")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "key_values")]
pub struct KeyValue {
    #[ts(type = "\"key_value\"")]
    pub model: String,
    pub id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    pub key: String,
    pub namespace: String,
    pub value: String,
}

impl UpsertModelInfo for KeyValue {
    fn table_name() -> impl IntoTableRef + IntoIden {
        KeyValueIden::Table
    }

    fn id_column() -> impl IntoIden + Eq + Clone {
        KeyValueIden::Id
    }

    fn generate_id() -> String {
        generate_prefixed_id("kv")
    }

    fn order_by() -> (impl IntoColumnRef, Order) {
        (KeyValueIden::CreatedAt, Desc)
    }

    fn get_id(&self) -> String {
        self.id.clone()
    }

    fn insert_values(
        self,
        source: &UpdateSource,
    ) -> Result<Vec<(impl IntoIden + Eq, impl Into<SimpleExpr>)>> {
        use KeyValueIden::*;
        Ok(vec![
            (CreatedAt, upsert_date(source, self.created_at)),
            (UpdatedAt, upsert_date(source, self.updated_at)),
            (Namespace, self.namespace.clone().into()),
            (Key, self.key.clone().into()),
            (Value, self.value.clone().into()),
        ])
    }

    fn update_columns() -> Vec<impl IntoIden> {
        vec![KeyValueIden::UpdatedAt, KeyValueIden::Value]
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self>
    where
        Self: Sized,
    {
        Ok(Self {
            id: row.get("id")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            namespace: row.get("namespace")?,
            key: row.get("key")?,
            value: row.get("value")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
#[enum_def(table_name = "plugin_key_values")]
pub struct PluginKeyValue {
    #[ts(type = "\"plugin_key_value\"")]
    pub model: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,

    pub plugin_name: String,
    pub key: String,
    pub value: String,
}

impl<'s> TryFrom<&Row<'s>> for PluginKeyValue {
    type Error = rusqlite::Error;

    fn try_from(r: &Row<'s>) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            model: r.get("model")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            plugin_name: r.get("plugin_name")?,
            key: r.get("key")?,
            value: r.get("value")?,
        })
    }
}

fn default_true() -> bool {
    true
}

fn default_http_method() -> String {
    "GET".to_string()
}

#[macro_export]
macro_rules! define_any_model {
    ($($type:ident),* $(,)?) => {
        #[derive(Debug, Clone, Serialize, TS)]
        #[serde(rename_all = "camelCase", untagged)]
        #[ts(export, export_to = "gen_models.ts")]
        pub enum AnyModel {
            $(
                $type($type),
            )*
        }

        $(
            impl From<$type> for AnyModel {
                fn from(value: $type) -> Self {
                    AnyModel::$type(value)
                }
            }

            impl From<AnyModel> for $type {
                fn from(value: AnyModel) -> $type {
                    match value {
                        AnyModel::$type(inner) => inner,
                        _ => panic!( // Should never happen because this macro also generates the enum variant
                            "Tried to convert AnyModel into `{}`, but found a different variant",
                            stringify!($type)
                        ),
                    }
                }
            }
        )*
    };
}

define_any_model! {
    CookieJar,
    Environment,
    Folder,
    GraphQlIntrospection,
    GrpcConnection,
    GrpcEvent,
    GrpcRequest,
    HttpRequest,
    HttpResponse,
    KeyValue,
    Plugin,
    Settings,
    SyncState,
    WebsocketConnection,
    WebsocketEvent,
    WebsocketRequest,
    Workspace,
    WorkspaceMeta,
}

impl<'de> Deserialize<'de> for AnyModel {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let model = value.as_object().unwrap();
        use serde_json::from_value as fv;

        let model = match model.get("model") {
            Some(m) if m == "cookie_jar" => AnyModel::CookieJar(fv(value).unwrap()),
            Some(m) if m == "environment" => AnyModel::Environment(fv(value).unwrap()),
            Some(m) if m == "folder" => AnyModel::Folder(fv(value).unwrap()),
            Some(m) if m == "graphql_introspection" => {
                AnyModel::GraphQlIntrospection(fv(value).unwrap())
            }
            Some(m) if m == "grpc_connection" => AnyModel::GrpcConnection(fv(value).unwrap()),
            Some(m) if m == "grpc_event" => AnyModel::GrpcEvent(fv(value).unwrap()),
            Some(m) if m == "grpc_request" => AnyModel::GrpcRequest(fv(value).unwrap()),
            Some(m) if m == "http_request" => AnyModel::HttpRequest(fv(value).unwrap()),
            Some(m) if m == "http_response" => AnyModel::HttpResponse(fv(value).unwrap()),
            Some(m) if m == "key_value" => AnyModel::KeyValue(fv(value).unwrap()),
            Some(m) if m == "plugin" => AnyModel::Plugin(fv(value).unwrap()),
            Some(m) if m == "settings" => AnyModel::Settings(fv(value).unwrap()),
            Some(m) if m == "websocket_connection" => {
                AnyModel::WebsocketConnection(fv(value).unwrap())
            }
            Some(m) if m == "websocket_event" => AnyModel::WebsocketEvent(fv(value).unwrap()),
            Some(m) if m == "websocket_request" => AnyModel::WebsocketRequest(fv(value).unwrap()),
            Some(m) if m == "workspace" => AnyModel::Workspace(fv(value).unwrap()),
            Some(m) if m == "workspace_meta" => AnyModel::WorkspaceMeta(fv(value).unwrap()),
            Some(m) => {
                return Err(serde::de::Error::custom(format!(
                    "Failed to deserialize AnyModel {}",
                    m
                )));
            }
            None => {
                return Err(serde::de::Error::custom("Missing or invalid model"));
            }
        };

        Ok(model)
    }
}

impl AnyModel {
    pub fn resolved_name(&self) -> String {
        let compute_name = |name: &str, url: &str, fallback: &str| -> String {
            if !name.is_empty() {
                return name.to_string();
            }
            let without_variables = url.replace(r"\$\{\[\s*([^\]\s]+)\s*]}", "$1");
            if without_variables.is_empty() { fallback.to_string() } else { without_variables }
        };

        match self.clone() {
            AnyModel::CookieJar(v) => v.name,
            AnyModel::Environment(v) => v.name,
            AnyModel::Folder(v) => v.name,
            AnyModel::GrpcRequest(v) => compute_name(&v.name, &v.url, "gRPC Request"),
            AnyModel::HttpRequest(v) => compute_name(&v.name, &v.url, "HTTP Request"),
            AnyModel::WebsocketRequest(v) => compute_name(&v.name, &v.url, "WebSocket Request"),
            AnyModel::Workspace(v) => v.name,
            _ => "No Name".to_string(),
        }
    }
}

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

// Generate the created_at or updated_at timestamps for an upsert operation, depending on the ID
// provided.
fn upsert_date(update_source: &UpdateSource, dt: NaiveDateTime) -> SimpleExpr {
    match update_source {
        // Sync and import operations always preserve timestamps
        UpdateSource::Sync | UpdateSource::Import => {
            if dt.and_utc().timestamp() == 0 {
                // Sometimes data won't have timestamps (partial data)
                Utc::now().naive_utc().into()
            } else {
                dt.into()
            }
        }
        // Other sources will always update to the latest time
        _ => Utc::now().naive_utc().into(),
    }
}
