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
mod reset;
mod restore;
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
pub use log::{GitCommit, GitFileDiff, git_file_diff_for_commit, git_log, git_log_for_file};
pub use pull::{PullResult, git_pull, git_pull_force_reset, git_pull_merge};
pub use push::{PushResult, git_push};
pub use remotes::{GitRemote, git_add_remote, git_remotes, git_rm_remote};
pub use repository::{GitRepositoryPaths, git_path_is_ignored, git_repository_paths};
pub use reset::git_reset_changes;
pub use restore::{git_restore, git_restore_file_from_commit};
pub use status::{
    GitBranchInfo, GitStatusSummary, GitWorktreeStatus, git_branch_info, git_status,
    git_worktree_status,
};
pub use unstage::git_unstage;
