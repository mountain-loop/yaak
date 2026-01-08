use crate::error::Result;
use log::{error, info};
use notify::Watcher;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tokio::select;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_watch.ts")]
pub struct WatchEvent {
    pub paths: Vec<PathBuf>,
    pub kind: String,
}

/// Watch a directory for changes and send events through a callback.
///
/// The callback is invoked for each watch event. The function returns when
/// the cancel receiver receives a signal.
pub async fn watch_directory<F>(
    dir: &Path,
    callback: F,
    mut cancel_rx: tokio::sync::watch::Receiver<()>,
) -> Result<()>
where
    F: Fn(WatchEvent) + Send + 'static,
{
    let dir = dir.to_owned();
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx)?;

    // Spawn a blocking thread to handle the blocking `std::sync::mpsc::Receiver`
    let (async_tx, mut async_rx) = tokio::sync::mpsc::channel::<notify::Result<notify::Event>>(100);
    std::thread::spawn(move || {
        for res in rx {
            if async_tx.blocking_send(res).is_err() {
                break; // Exit the thread if the async receiver is closed
            }
        }
    });

    tokio::spawn(async move {
        watcher.watch(&dir, notify::RecursiveMode::Recursive).expect("Failed to watch directory");
        info!("Watching directory {:?}", dir);

        loop {
            select! {
                // Listen for new watch events
                Some(event_res) = async_rx.recv() => {
                    match event_res {
                        Ok(event) => {
                            // Filter out any ignored directories and see if we still get a result
                            let paths = event.paths.into_iter()
                                .map(|p| p.strip_prefix(&dir).unwrap().to_path_buf())
                                .filter(|p| !p.starts_with(".git") && !p.starts_with("node_modules"))
                                .collect::<Vec<PathBuf>>();

                            if paths.is_empty() {
                                continue;
                            }

                            callback(WatchEvent {
                                paths,
                                kind: format!("{:?}", event.kind),
                            });
                        }
                        Err(e) => error!("Directory watch error: {:?}", e),
                    }
                }
                // Listen for cancellation
                _ = cancel_rx.changed() => {
                    // To cancel, we break from the loop, which will exit the task and make the
                    // watcher go out of scope (cancelling it)
                    info!("Cancelling watch for {:?}", dir);
                    break;
                }
            }
        }
    });

    Ok(())
}
