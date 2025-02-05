use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use git2::{Cred, ProxyOptions, PushOptions, RemoteCallbacks};
use log::{debug, info};
use ts_rs::TS;
use crate::branch::branch_set_upstream_after_push;
use crate::repository::open_repo;
use crate::util::find_ssh_key;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushType {
    Branch,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_git.ts")]
pub(crate) enum PushResult {
    Success,
    NothingToPush,
}

pub(crate) fn git_push(dir: &Path) -> Result<PushResult> {
    let repo = open_repo(dir)?;
    let head = repo.head()?;
    let branch = head.shorthand().unwrap();
    let push_result = Mutex::new(PushResult::NothingToPush);
    let mut remote = repo.find_remote("origin")?;
    let mut callbacks = RemoteCallbacks::new();

    let mut fail_next_call = false;
    let mut tried_agent = false;

    callbacks.credentials(|url, username_from_url, allowed_types| {
        if fail_next_call {
            info!("Failed to get credentials for push");
            return Err(git2::Error::from_str("Bad credentials."));
        }

        debug!("getting credentials {url} {username_from_url:?} {allowed_types:?}");
        match (allowed_types.is_ssh_key(), username_from_url) {
            (true, Some(username)) => {
                if !tried_agent {
                    tried_agent = true;
                    return Cred::ssh_key_from_agent(username);
                }

                fail_next_call = true; // This is our last try

                // If the agent failed, try using the default SSH key
                if let Some(key) = find_ssh_key() {
                    Cred::ssh_key(username, None, key.as_path(), None)
                } else {
                    Err(git2::Error::from_str(
                        "Bad credentials. Ensure your key was added using ssh-add",
                    ))
                }
            }
            (true, None) => Err(git2::Error::from_str("Couldn't get username from url")),
            _ => {
                todo!("Implement basic auth credential");
            }
        }
    });

    callbacks.push_transfer_progress(|current, total, bytes| {
        debug!("progress: {}/{} ({} B)", current, total, bytes,);
    });

    callbacks.transfer_progress(|p| {
        debug!("transfer: {}/{}", p.received_objects(), p.total_objects());
        true
    });

    callbacks.pack_progress(|stage, current, total| {
        debug!("packing: {:?} - {}/{}", stage, current, total);
    });

    callbacks.push_update_reference(|reference, msg| {
        debug!("push_update_reference: '{}' {:?}", reference, msg);
        Ok(())
    });

    callbacks.update_tips(|name, a, b| {
        debug!("update tips: '{}' {} -> {}", name, a, b);
        if a != b {
            let mut push_result = push_result.lock().unwrap();
            *push_result = PushResult::Success
        }
        true
    });

    callbacks.sideband_progress(|data| {
        debug!("sideband transfer: '{}'", String::from_utf8_lossy(data).trim());
        true
    });

    let mut options = PushOptions::new();
    options.packbuilder_parallelism(0);
    options.remote_callbacks(callbacks);

    let mut proxy = ProxyOptions::new();
    proxy.auto();
    options.proxy_options(proxy);

    // Push the current branch
    let force = false;
    let delete = false;
    let branch_modifier = match (force, delete) {
        (true, true) => "+:",
        (false, true) => ":",
        (true, false) => "+",
        (false, false) => "",
    };

    let ref_type = PushType::Branch;

    let ref_type = match ref_type {
        PushType::Branch => "heads",
        PushType::Tag => "tags",
    };

    let refspec = format!("{branch_modifier}refs/{ref_type}/{branch}");
    remote.push(&[refspec], Some(&mut options))?;

    branch_set_upstream_after_push(&repo, branch)?;

    let push_result = push_result.lock().unwrap();
    Ok(push_result.clone())
}
