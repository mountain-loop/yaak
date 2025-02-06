use git2::{Cred, RemoteCallbacks};
use log::{debug, info};
use crate::util::find_ssh_key;

pub(crate) fn default_callbacks<'s>() -> RemoteCallbacks<'s> {
    let mut callbacks = RemoteCallbacks::new();

    let mut fail_next_call = false;
    let mut tried_agent = false;

    callbacks.credentials(move |url, username_from_url, allowed_types| {
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
            // let mut push_result = push_result.lock().unwrap();
            // *push_result = PushResult::Success
        }
        true
    });

    callbacks.sideband_progress(|data| {
        debug!("sideband transfer: '{}'", String::from_utf8_lossy(data).trim());
        true
    });
    
    callbacks
}