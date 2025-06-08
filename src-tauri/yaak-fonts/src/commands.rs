use crate::Result;
use font_loader::system_fonts;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::command;
use ts_rs::TS;

#[derive(Default, Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_fonts.ts")]
pub struct Fonts {
    pub editor_fonts: Vec<String>,
    pub ui_fonts: Vec<String>,
}

#[command]
pub(crate) async fn list() -> Result<Fonts> {
    let mut ui_fonts = HashSet::new();
    let mut editor_fonts = HashSet::new();

    let mut property = system_fonts::FontPropertyBuilder::new().monospace().build();
    for font in &system_fonts::query_specific(&mut property) {
        editor_fonts.insert(font.to_string());
    }
    for font in &system_fonts::query_all() {
        if !editor_fonts.contains(font) {
            ui_fonts.insert(font.to_string());
        }
    }

    let mut ui_fonts: Vec<String> = ui_fonts.into_iter().collect();
    let mut editor_fonts: Vec<String> = editor_fonts.into_iter().collect();

    ui_fonts.sort();
    editor_fonts.sort();

    Ok(Fonts {
        ui_fonts,
        editor_fonts,
    })
}
