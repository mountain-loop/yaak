use crate::error::Error::MergeConflicts;
use crate::util::bytes_to_string;
use git2::{AnnotatedCommit, Branch, IndexEntry, Reference, Repository};
use log::{debug, info};

pub(crate) fn do_merge(
    repo: &Repository,
    local_branch: &Branch,
    commit_to_merge: &AnnotatedCommit,
) -> crate::error::Result<()> {
    debug!("Merging remote branches");
    let analysis = repo.merge_analysis(&[&commit_to_merge])?;

    if analysis.0.is_fast_forward() {
        let refname = bytes_to_string(local_branch.get().name_bytes())?;
        match repo.find_reference(&refname) {
            Ok(mut r) => {
                merge_fast_forward(repo, &mut r, &commit_to_merge)?;
            }
            Err(_) => {
                // The branch doesn't exist, so set the reference to the commit directly. Usually
                // this is because you are pulling into an empty repository.
                repo.reference(
                    &refname,
                    commit_to_merge.id(),
                    true,
                    &format!("Setting {} to {}", refname, commit_to_merge.id()),
                )?;
                repo.set_head(&refname)?;
                repo.checkout_head(Some(
                    git2::build::CheckoutBuilder::default()
                        .allow_conflicts(true)
                        .conflict_style_merge(true)
                        .force(),
                ))?;
            }
        };
    } else if analysis.0.is_normal() {
        let head_commit = repo.reference_to_annotated_commit(&repo.head()?)?;
        merge_normal(repo, &head_commit, commit_to_merge)?;
    } else {
        debug!("Skipping merge. Nothing to do")
    }

    Ok(())
}

pub(crate) fn merge_fast_forward(
    repo: &Repository,
    local_reference: &mut Reference,
    remote_commit: &AnnotatedCommit,
) -> crate::error::Result<()> {
    info!("Performing fast forward");
    let name = match local_reference.name() {
        Some(s) => s.to_string(),
        None => String::from_utf8_lossy(local_reference.name_bytes()).to_string(),
    };
    let msg = format!("Fast-Forward: Setting {} to id: {}", name, remote_commit.id());
    local_reference.set_target(remote_commit.id(), &msg)?;
    repo.set_head(&name)?;
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::default()
            // For some reason, the force is required to make the working directory actually get
            // updated I suspect we should be adding some logic to handle dirty working directory
            // states, but this is just an example so maybe not.
            .force(),
    ))?;
    Ok(())
}

pub(crate) fn merge_normal(
    repo: &Repository,
    local: &AnnotatedCommit,
    remote: &AnnotatedCommit,
) -> crate::error::Result<()> {
    info!("Performing normal merge");
    let local_tree = repo.find_commit(local.id())?.tree()?;
    let remote_tree = repo.find_commit(remote.id())?.tree()?;
    let ancestor = repo.find_commit(repo.merge_base(local.id(), remote.id())?)?.tree()?;

    let mut idx = repo.merge_trees(&ancestor, &local_tree, &remote_tree, None)?;

    if idx.has_conflicts() {
        let conflicts = idx.conflicts()?;
        for conflict in conflicts {
            if let Ok(conflict) = conflict {
                print_conflict(&conflict);
            }
        }
        return Err(MergeConflicts);
    }

    let result_tree = repo.find_tree(idx.write_tree_to(repo)?)?;
    // now create the merge commit
    let msg = format!("Merge: {} into {}", remote.id(), local.id());
    let sig = repo.signature()?;
    let local_commit = repo.find_commit(local.id())?;
    let remote_commit = repo.find_commit(remote.id())?;

    // Do our merge commit and set current branch head to that commit.
    let _merge_commit = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &msg,
        &result_tree,
        &[&local_commit, &remote_commit],
    )?;

    // Set working tree to match head.
    repo.checkout_head(None)?;

    Ok(())
}

fn print_conflict(conflict: &git2::IndexConflict) {
    let ancestor = conflict.ancestor.as_ref().map(path_from_index_entry);
    let ours = conflict.our.as_ref().map(path_from_index_entry);
    let theirs = conflict.their.as_ref().map(path_from_index_entry);

    println!("Conflict detected:");
    if let Some(path) = ancestor {
        println!("  Common ancestor: {:?}", path);
    }
    if let Some(path) = ours {
        println!("  Ours: {:?}", path);
    }
    if let Some(path) = theirs {
        println!("  Theirs: {:?}", path);
    }
}

fn path_from_index_entry(entry: &IndexEntry) -> String {
    String::from_utf8_lossy(entry.path.as_slice()).into_owned()
}
