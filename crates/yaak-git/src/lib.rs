mod add;
mod binary;
mod branch;
mod clone;
mod commit;
mod credential;
pub mod error;
mod fetch;
mod init;
mod log;

mod pull;
mod push;
mod remotes;
mod repository;
mod status;
mod unstage;
mod util;

// Re-export all git functions for external use
pub use add::git_add;
pub use branch::{
    BranchDeleteResult, git_checkout_branch, git_create_branch, git_delete_branch,
    git_delete_remote_branch, git_merge_branch, git_rename_branch,
};
pub use clone::{CloneResult, git_clone};
pub use commit::git_commit;
pub use credential::git_add_credential;
pub use fetch::git_fetch_all;
pub use init::git_init;
pub use log::{GitCommit, git_log};
pub use pull::{PullResult, git_pull};
pub use push::{PushResult, git_push};
pub use remotes::{GitRemote, git_add_remote, git_remotes, git_rm_remote};
pub use status::{GitStatusSummary, git_status};
pub use unstage::git_unstage;
