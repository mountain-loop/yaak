use crate::error::{Error, Result};
use chrono::Utc;
use log::{debug, error, warn};
use notify::Watcher;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Listener, Runtime};
use tokio::select;
use tokio::sync::watch;
use tokio::time::sleep;
use ts_rs::TS;
use yaak_git::{GitWorktreeStatus, git_path_is_ignored, git_repository_paths, git_worktree_status};

const GIT_STATUS_COALESCE_WINDOW: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "index.ts")]
pub(crate) struct GitWatchResult {
    unlisten_event: String,
}

pub(crate) async fn watch_git_worktree_status<R: Runtime>(
    app_handle: AppHandle<R>,
    dir: &Path,
    channel: Channel<GitWorktreeStatus>,
) -> Result<GitWatchResult> {
    let paths = git_repository_paths(dir)?;
    let repo_dir = dir.to_path_buf();
    let workdir = paths.workdir;
    let gitdir = paths.gitdir;

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| Error::GenericError(format!("Failed to watch Git repository: {e}")))?;

    watcher
        .watch(&workdir, notify::RecursiveMode::Recursive)
        .map_err(|e| Error::GenericError(format!("Failed to watch Git worktree: {e}")))?;
    if gitdir != workdir {
        watcher
            .watch(&gitdir, notify::RecursiveMode::Recursive)
            .map_err(|e| Error::GenericError(format!("Failed to watch Git metadata: {e}")))?;
    }

    let (async_tx, mut async_rx) = tokio::sync::mpsc::channel::<notify::Result<notify::Event>>(100);
    std::thread::spawn(move || {
        for res in rx {
            if async_tx.blocking_send(res).is_err() {
                break;
            }
        }
    });

    let (cancel_tx, cancel_rx) = watch::channel(());
    let mut cancel_rx = cancel_rx;
    send_worktree_status(&repo_dir, &channel);

    tauri::async_runtime::spawn(async move {
        let _watcher = watcher;
        loop {
            select! {
                Some(event_res) = async_rx.recv() => {
                    handle_git_watch_event(
                        event_res,
                        &mut async_rx,
                        &repo_dir,
                        &workdir,
                        &gitdir,
                        &channel,
                    ).await;
                }
                _ = cancel_rx.changed() => {
                    break;
                }
            }
        }
    });

    let app_handle_inner = app_handle.clone();
    let unlisten_event = format!("git-watch-unlisten-{}", Utc::now().timestamp_millis());
    app_handle.listen_any(unlisten_event.clone(), move |event| {
        app_handle_inner.unlisten(event.id());
        if let Err(e) = cancel_tx.send(()) {
            warn!("Failed to send git watch cancel signal {e:?}");
        }
    });

    Ok(GitWatchResult { unlisten_event })
}

async fn handle_git_watch_event(
    event_res: notify::Result<notify::Event>,
    async_rx: &mut tokio::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    repo_dir: &Path,
    workdir: &Path,
    gitdir: &Path,
    channel: &Channel<GitWorktreeStatus>,
) {
    if !is_relevant_git_watch_event(event_res, repo_dir, workdir, gitdir) {
        return;
    }

    send_worktree_status(repo_dir, channel);

    let settle_window = sleep(GIT_STATUS_COALESCE_WINDOW);
    tokio::pin!(settle_window);
    loop {
        select! {
            Some(event_res) = async_rx.recv() => {
                let _ = is_relevant_git_watch_event(event_res, repo_dir, workdir, gitdir);
            }
            _ = &mut settle_window => {
                break;
            }
        }
    }

    send_worktree_status(repo_dir, channel);
}

fn is_relevant_git_watch_event(
    event_res: notify::Result<notify::Event>,
    repo_dir: &Path,
    workdir: &Path,
    gitdir: &Path,
) -> bool {
    let event = match event_res {
        Ok(event) => event,
        Err(e) => {
            error!("Git watch error: {:?}", e);
            return false;
        }
    };

    for path in event.paths {
        if path.strip_prefix(gitdir).is_ok() {
            return true;
        }

        let Ok(rela_path) = path.strip_prefix(workdir) else {
            continue;
        };

        match git_path_is_ignored(repo_dir, rela_path) {
            Ok(true) => {}
            Ok(false) => return true,
            Err(e) => {
                debug!("Failed to check Git ignore status for {:?}: {e}", rela_path);
                return true;
            }
        }
    }

    false
}

fn send_worktree_status(repo_dir: &Path, channel: &Channel<GitWorktreeStatus>) {
    match git_worktree_status(repo_dir) {
        Ok(status) => {
            if let Err(e) = channel.send(status) {
                warn!("Failed to send git worktree status: {:?}", e);
            }
        }
        Err(e) => {
            warn!("Failed to get git worktree status: {e}");
        }
    }
}
