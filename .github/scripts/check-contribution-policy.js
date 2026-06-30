const COMMENT_MARKER = "<!-- yaak-contribution-policy -->";

const MAINTAINER_LOGINS = new Set(["gschier"]);
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MAINTAINER_PERMISSIONS = new Set(["admin", "maintain", "write"]);

const LARGE_DIFF_CHANGED_FILES = 20;
const LARGE_DIFF_CHANGED_LINES = 800;

const LABELS = {
  accepted: {
    name: "contribution: accepted",
    color: "0E8A16",
    description: "Community PR appears to match Yaak's contribution policy.",
  },
  approvedFeedback: {
    name: "contribution: approved feedback",
    color: "5319E7",
    description: "Community PR links an approved feedback item.",
  },
  needsTemplate: {
    name: "contribution: needs template",
    color: "D93F0B",
    description: "Community PR needs a completed pull request template.",
  },
  needsApproval: {
    name: "contribution: needs approval",
    color: "B60205",
    description: "Community PR needs an approved feedback item before review.",
  },
  largeDiff: {
    name: "contribution: large diff",
    color: "FBCA04",
    description:
      "Community PR has a larger-than-usual diff for a small-scope contribution.",
  },
};

const MANAGED_LABEL_NAMES = Object.values(LABELS).map((label) => label.name);

const CHECKBOXES = {
  smallScope: "This PR is a bug fix or small-scope improvement.",
  approvedFeedback:
    "If this PR is not a bug fix or small-scope improvement, I linked an approved feedback item below.",
  readContributing:
    "I have read and followed [`CONTRIBUTING.md`](CONTRIBUTING.md).",
  testedLocally: "I tested this change locally.",
  testsUpdated: "I added or updated tests when reasonable.",
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBody(body) {
  return (body || "").replace(/\r\n/g, "\n");
}

function stripComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function getSection(body, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "gim");
  const match = pattern.exec(body);

  if (match == null) {
    return null;
  }

  const rest = body.slice(match.index + match[0].length);
  const nextHeadingIndex = rest.search(/^##\s+/m);
  return nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex);
}

function hasMeaningfulText(value) {
  return stripComments(value || "").length > 0;
}

function checkboxState(body, label) {
  const flexibleLabel = escapeRegExp(label).replace(/\\ /g, "\\s+");
  const pattern = new RegExp(
    `^\\s*[-*]\\s*\\[([ xX])\\]\\s*${flexibleLabel}\\s*$`,
    "im",
  );
  const match = body.match(pattern);

  if (match == null) {
    return null;
  }

  return match[1].toLowerCase() === "x";
}

function findFeedbackUrl(body) {
  return (
    body.match(
      /https?:\/\/(?:www\.)?(?:yaak\.app\/feedback|feedback\.yaak\.app)\/[^\s)>\]]+/i,
    )?.[0] ?? null
  );
}

function analyzePullRequest(pr) {
  const body = normalizeBody(pr.body);
  const states = Object.fromEntries(
    Object.entries(CHECKBOXES).map(([key, label]) => [
      key,
      checkboxState(body, label),
    ]),
  );
  const sectionCount = ["Summary", "Submission", "Related"].filter(
    (heading) => getSection(body, heading) != null,
  ).length;
  const checkboxCount = Object.values(states).filter(
    (state) => state != null,
  ).length;
  const templateUsed = sectionCount >= 2 && checkboxCount >= 3;
  const blockers = [];
  const totalChangedLines =
    Number(pr.additions || 0) + Number(pr.deletions || 0);
  const changedFiles = Number(pr.changed_files || 0);
  const largeDiff =
    changedFiles > LARGE_DIFF_CHANGED_FILES ||
    totalChangedLines > LARGE_DIFF_CHANGED_LINES;

  if (!templateUsed) {
    blockers.push({
      label: LABELS.needsTemplate.name,
      message:
        "Update the PR description with the repository pull request template.",
    });
  } else {
    const summary = getSection(body, "Summary");
    const hasSummary = hasMeaningfulText(summary);
    const feedbackUrl = findFeedbackUrl(body);
    const smallScope = states.smallScope === true;
    const approvedFeedback = states.approvedFeedback === true;

    if (!hasSummary) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message: "Add a short summary describing the bug fix or improvement.",
      });
    }

    if (smallScope && approvedFeedback) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message:
          "Choose either the small-scope checkbox or the approved-feedback checkbox, not both.",
      });
    } else if (!smallScope && !approvedFeedback) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message:
          "Check whether this is a bug fix or small-scope improvement, or confirm that an approved feedback item is linked.",
      });
    } else if (approvedFeedback && feedbackUrl == null) {
      blockers.push({
        label: LABELS.needsApproval.name,
        message:
          "Link the approved feedback item where contribution approval was explicitly stated.",
      });
    }

    if (states.readContributing !== true) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message: "Confirm that `CONTRIBUTING.md` was read and followed.",
      });
    }

    if (states.testedLocally !== true) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message: "Confirm that the change was tested locally.",
      });
    }

    if (states.testsUpdated !== true) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message: "Confirm that tests were added or updated when reasonable.",
      });
    }
  }

  const desiredLabels = new Set(blockers.map((blocker) => blocker.label));

  if (blockers.length === 0) {
    desiredLabels.add(
      states.approvedFeedback
        ? LABELS.approvedFeedback.name
        : LABELS.accepted.name,
    );
  }

  if (largeDiff) {
    desiredLabels.add(LABELS.largeDiff.name);
  }

  return {
    blockers,
    changedFiles,
    desiredLabels: [...desiredLabels],
    largeDiff,
    templateUsed,
    totalChangedLines,
  };
}

function buildBlockingComment(analysis) {
  const lines = [
    COMMENT_MARKER,
    "Thanks for the PR. Yaak currently accepts community PRs for bug fixes and small-scope improvements, plus larger changes that link an approved feedback item from https://yaak.app/feedback.",
    "",
    "This PR cannot be accepted yet. Please update the PR description to address:",
    "",
    ...analysis.blockers.map((blocker) => `- ${blocker.message}`),
  ];

  if (analysis.largeDiff) {
    lines.push(
      "",
      `This PR also changes ${analysis.changedFiles} files and ${analysis.totalChangedLines} lines, so it has been labeled as a large diff. That label is advisory, but maintainers may ask for the scope to be reduced.`,
    );
  }

  lines.push(
    "",
    "I did not overwrite the PR body, since that can remove useful context. Editing the description directly is the safest way to keep your notes while completing the template.",
  );

  return lines.join("\n");
}

function summarizeResult({ pr, analysis, skipped, skipReason }) {
  if (skipped) {
    return `#${pr.number} ${pr.title} - skipped (${skipReason})`;
  }

  const status =
    analysis.blockers.length > 0
      ? `blocked: ${analysis.blockers.map((blocker) => blocker.message).join("; ")}`
      : "accepted";
  const labels =
    analysis.desiredLabels.length > 0
      ? analysis.desiredLabels.join(", ")
      : "none";

  return `#${pr.number} ${pr.title} - ${status}; labels: ${labels}`;
}

async function isOfficialMaintainer({ github, owner, repo, pr }) {
  if (MAINTAINER_LOGINS.has(pr.user.login)) {
    return true;
  }

  if (MAINTAINER_ASSOCIATIONS.has(pr.author_association)) {
    return true;
  }

  try {
    const response = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: pr.user.login,
    });

    return MAINTAINER_PERMISSIONS.has(response.data.permission);
  } catch (error) {
    if (error.status === 404) {
      return false;
    }

    throw error;
  }
}

async function ensureManagedLabels({ github, owner, repo }) {
  for (const label of Object.values(LABELS)) {
    try {
      await github.rest.issues.getLabel({
        owner,
        repo,
        name: label.name,
      });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }

      await github.rest.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
    }
  }
}

async function syncLabels({ github, owner, repo, issueNumber, desiredLabels }) {
  const desired = new Set(desiredLabels);

  await ensureManagedLabels({ github, owner, repo });

  for (const labelName of MANAGED_LABEL_NAMES) {
    if (desired.has(labelName)) {
      continue;
    }

    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  if (desired.size > 0) {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [...desired],
    });
  }
}

async function findPolicyComment({ github, owner, repo, issueNumber }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  return comments.find(
    (comment) =>
      comment.user.type === "Bot" && comment.body?.includes(COMMENT_MARKER),
  );
}

async function upsertPolicyComment({ github, owner, repo, issueNumber, body }) {
  const existingComment = await findPolicyComment({
    github,
    owner,
    repo,
    issueNumber,
  });

  if (existingComment == null) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return;
  }

  await github.rest.issues.updateComment({
    owner,
    repo,
    comment_id: existingComment.id,
    body,
  });
}

async function deletePolicyComment({ github, owner, repo, issueNumber }) {
  const existingComment = await findPolicyComment({
    github,
    owner,
    repo,
    issueNumber,
  });

  if (existingComment == null) {
    return;
  }

  await github.rest.issues.deleteComment({
    owner,
    repo,
    comment_id: existingComment.id,
  });
}

async function checkPullRequest({
  github,
  core,
  owner,
  repo,
  pullNumber,
  dryRun,
}) {
  const response = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const pr = response.data;
  const issueNumber = pr.number;

  if (pr.draft) {
    core.notice(`Skipping contribution policy for draft PR #${pr.number}.`);
    return {
      blocked: false,
      number: pr.number,
      summary: summarizeResult({
        pr,
        skipped: true,
        skipReason: "draft",
      }),
      skipped: true,
    };
  }

  if (await isOfficialMaintainer({ github, owner, repo, pr })) {
    core.notice(
      `Skipping contribution policy for maintainer PR #${pr.number} from @${pr.user.login}.`,
    );
    if (!dryRun) {
      await syncLabels({ github, owner, repo, issueNumber, desiredLabels: [] });
      await deletePolicyComment({ github, owner, repo, issueNumber });
    }
    return {
      blocked: false,
      number: pr.number,
      summary: summarizeResult({
        pr,
        skipped: true,
        skipReason: `maintainer @${pr.user.login}`,
      }),
      skipped: true,
    };
  }

  const analysis = analyzePullRequest(pr);

  if (dryRun) {
    const summary = summarizeResult({ pr, analysis });
    core.notice(`[dry-run] ${summary}`);
    return {
      blocked: analysis.blockers.length > 0,
      number: pr.number,
      summary,
      skipped: false,
    };
  }

  await syncLabels({
    github,
    owner,
    repo,
    issueNumber,
    desiredLabels: analysis.desiredLabels,
  });

  if (analysis.blockers.length > 0) {
    await upsertPolicyComment({
      github,
      owner,
      repo,
      issueNumber,
      body: buildBlockingComment(analysis),
    });
    return {
      blocked: true,
      number: pr.number,
      summary: summarizeResult({ pr, analysis }),
      skipped: false,
    };
  }

  await deletePolicyComment({ github, owner, repo, issueNumber });
  core.notice(`Contribution policy check passed for PR #${pr.number}.`);
  return {
    blocked: false,
    number: pr.number,
    summary: summarizeResult({ pr, analysis }),
    skipped: false,
  };
}

async function listOpenPullRequests({ github, owner, repo }) {
  return github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const payloadPr = context.payload.pull_request;
  const dryRun =
    context.eventName === "workflow_dispatch" &&
    context.payload.inputs?.dry_run !== "false";
  const pullRequests =
    payloadPr == null
      ? await listOpenPullRequests({ github, owner, repo })
      : [payloadPr];
  const results = [];

  if (dryRun) {
    core.notice("Running contribution policy in dry-run mode.");
  }

  for (const pr of pullRequests) {
    results.push(
      await checkPullRequest({
        github,
        core,
        owner,
        repo,
        pullNumber: pr.number,
        dryRun,
      }),
    );
  }

  await core.summary
    .addHeading(`Contribution Policy ${dryRun ? "Dry Run" : "Results"}`)
    .addTable([
      [
        { data: "PR", header: true },
        { data: "Result", header: true },
      ],
      ...results.map((result) => [`#${result.number}`, result.summary]),
    ])
    .write();

  const blockedPullRequests = results.filter((result) => result.blocked);

  if (blockedPullRequests.length > 0) {
    if (dryRun) {
      core.warning(
        `Dry run found contribution policy failures for PR(s): ${blockedPullRequests
          .map((result) => `#${result.number}`)
          .join(", ")}`,
      );
      return;
    }

    core.setFailed(
      `Contribution policy failed for PR(s): ${blockedPullRequests
        .map((result) => `#${result.number}`)
        .join(", ")}`,
    );
  }
}

module.exports = {
  analyzePullRequest,
  run,
};
