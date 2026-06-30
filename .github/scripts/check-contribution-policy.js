const COMMENT_MARKER = "<!-- yaak-contribution-policy -->";

const MAINTAINER_LOGINS = new Set(["gschier"]);
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MAINTAINER_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const REVIEWER_LOGIN = "gschier";

const LARGE_DIFF_CHANGED_FILES = 20;
const LARGE_DIFF_CHANGED_LINES = 800;
const SUMMARY_TITLE_MAX_LENGTH = 80;

const LABELS = {
  inScope: {
    name: "contribution: in scope",
    color: "0E8A16",
    description: "Community PR appears to be in scope for maintainer review.",
  },
  outOfScope: {
    name: "contribution: out of scope",
    color: "B60205",
    description: "Community PR does not match Yaak's contribution policy.",
  },
  explicitPermission: {
    name: "contribution: explicit permission",
    color: "5319E7",
    description:
      "Community PR links feedback where @gschier explicitly allowed the work.",
  },
  needsTemplate: {
    name: "contribution: needs template",
    color: "D93F0B",
    description: "Community PR needs a completed pull request template.",
  },
  needsPermission: {
    name: "contribution: needs permission",
    color: "B60205",
    description:
      "Community PR needs feedback showing explicit permission from @gschier.",
  },
  needsScopeReview: {
    name: "contribution: needs scope review",
    color: "FBCA04",
    description:
      "Community PR may be broader than Yaak's small-scope contribution policy.",
  },
};

const MANAGED_LABEL_NAMES = [
  ...new Set(Object.values(LABELS).map((label) => label.name)),
];

const CHECKBOXES = {
  smallScope: "This PR is a bug fix or small-scope improvement.",
  explicitPermission:
    "If this PR is not a bug fix or small-scope improvement, I linked the feedback item where @gschier explicitly gave me permission to work on it.",
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

function normalizeCheckboxLabel(label) {
  return label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function checkboxState(body, label) {
  const expectedLabel = normalizeCheckboxLabel(label);

  for (const line of body.split("\n")) {
    const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.*?)\s*$/i);

    if (match == null) {
      continue;
    }

    if (normalizeCheckboxLabel(match[2]) === expectedLabel) {
      return match[1].toLowerCase() === "x";
    }
  }

  return null;
}

function findFeedbackUrl(body) {
  return (
    body.match(
      /https?:\/\/(?:www\.)?(?:yaak\.app\/feedback|feedback\.yaak\.app)\/[^\s)>\]]+/i,
    )?.[0] ?? null
  );
}

function getLabelNames(pr) {
  return new Set((pr.labels || []).map((label) => label.name));
}

function analyzePullRequest(pr) {
  const body = normalizeBody(pr.body);
  const labelNames = getLabelNames(pr);
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

  if (labelNames.has(LABELS.outOfScope.name)) {
    return {
      blockers: [
        {
          label: LABELS.outOfScope.name,
          message: "Marked out of scope by maintainer label.",
        },
      ],
      changedFiles,
      desiredLabels: [LABELS.outOfScope.name],
      largeDiff,
      status: "out_of_scope",
      templateUsed,
      totalChangedLines,
    };
  }

  if (labelNames.has(LABELS.inScope.name)) {
    return {
      blockers: [],
      changedFiles,
      desiredLabels: [LABELS.inScope.name],
      largeDiff,
      status: "in_scope",
      templateUsed,
      totalChangedLines,
    };
  }

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
    const explicitPermission = states.explicitPermission === true;

    if (!hasSummary) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message: "Add a short summary describing the bug fix or improvement.",
      });
    }

    if (smallScope && explicitPermission) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message:
          "Choose either the small-scope checkbox or the explicit-permission checkbox, not both.",
      });
    } else if (!smallScope && !explicitPermission) {
      blockers.push({
        label: LABELS.needsTemplate.name,
        message:
          "Check whether this is a bug fix or small-scope improvement, or confirm that explicit permission from @gschier is linked.",
      });
    } else if (explicitPermission && feedbackUrl == null) {
      blockers.push({
        label: LABELS.needsPermission.name,
        message:
          "Link the feedback item where @gschier explicitly gave you permission to work on this.",
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

  const desiredLabels = new Set();

  if (blockers.length === 0) {
    desiredLabels.add(
      largeDiff
        ? LABELS.needsScopeReview.name
        : states.explicitPermission
          ? LABELS.explicitPermission.name
          : LABELS.inScope.name,
    );
  } else if (
    blockers.some((blocker) => blocker.label === LABELS.needsTemplate.name)
  ) {
    desiredLabels.add(LABELS.needsTemplate.name);
  } else {
    desiredLabels.add(blockers[0].label);
  }

  return {
    blockers,
    changedFiles,
    desiredLabels: [...desiredLabels],
    largeDiff,
    status: blockers.length === 0 ? "in_scope" : "blocked",
    templateUsed,
    totalChangedLines,
  };
}

function buildBlockingComment(analysis) {
  const lines = [
    COMMENT_MARKER,
    "Thanks for the PR. Yaak currently accepts community PRs for bug fixes and small-scope improvements, plus larger changes that link a feedback item where @gschier explicitly gave permission to work on it.",
    "",
    "This PR cannot be accepted yet. Please update the PR description to address:",
    "",
    ...analysis.blockers.map((blocker) => `- ${blocker.message}`),
  ];

  if (analysis.largeDiff) {
    lines.push(
      "",
      `This PR also changes ${analysis.changedFiles} files and ${analysis.totalChangedLines} lines, so it has been labeled as needing scope review. That label is advisory, but maintainers may ask for the scope to be reduced.`,
    );
  }

  lines.push(
    "",
    "I did not overwrite the PR body, since that can remove useful context. Editing the description directly is the safest way to keep your notes while completing the template.",
  );

  return lines.join("\n");
}

function buildInScopeComment() {
  return [
    COMMENT_MARKER,
    "Thanks for the PR. This appears to match Yaak's contribution policy and is awaiting review by @gschier.",
    "",
    "This only means the PR is in scope for review. It does not mean the change has been reviewed or accepted for merge.",
  ].join("\n");
}

function buildOutOfScopeComment() {
  return [
    COMMENT_MARKER,
    "Thanks for the PR. This does not appear to match Yaak's current contribution policy.",
    "",
    "Yaak currently accepts community PRs for bug fixes, small-scope improvements, or changes tied to a feedback item where @gschier explicitly gave permission to work on it.",
    "",
    "If this PR is tied to a feedback item where @gschier explicitly gave permission, please link it in the PR description.",
  ].join("\n");
}

function buildPolicyComment(analysis) {
  if (analysis.status === "out_of_scope") {
    return buildOutOfScopeComment();
  }

  if (analysis.blockers.length > 0) {
    return buildBlockingComment(analysis);
  }

  return buildInScopeComment();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateTitle(title) {
  if (title.length <= SUMMARY_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, SUMMARY_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function escapeTableText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function summarizeResult({ pr, analysis, skipped, skipReason }) {
  const comment =
    analysis == null
      ? "None"
      : buildPolicyComment(analysis).replace(COMMENT_MARKER, "").trim();
  const summary = {
    blocked: analysis?.blockers.length > 0,
    comment,
    details: "None",
    labels:
      analysis?.desiredLabels.length > 0
        ? analysis.desiredLabels.join(", ")
        : "None",
    number: pr.number,
    prLink: `<a href="${escapeHtml(pr.html_url)}">#${pr.number}</a>`,
    status: "In scope",
    title: escapeHtml(truncateTitle(pr.title)),
  };

  if (skipped) {
    return {
      ...summary,
      blocked: false,
      comment: "None",
      details: escapeHtml(skipReason),
      labels: "None",
      status: "Skipped",
    };
  }

  if (summary.blocked) {
    return {
      ...summary,
      comment: escapeTableText(summary.comment),
      details: escapeHtml(
        analysis.blockers.map((blocker) => blocker.message).join("; "),
      ),
      labels: escapeHtml(summary.labels),
      status: analysis.status === "out_of_scope" ? "Out of scope" : "Blocked",
    };
  }

  return {
    ...summary,
    comment: escapeTableText(summary.comment),
    labels: escapeHtml(summary.labels),
  };
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

async function requestMaintainerReview({ github, owner, repo, pr }) {
  if (pr.user.login === REVIEWER_LOGIN) {
    return;
  }

  try {
    await github.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pr.number,
      reviewers: [REVIEWER_LOGIN],
    });
  } catch (error) {
    if (error.status === 422) {
      return;
    }

    throw error;
  }
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
    core.notice(
      `[dry-run] PR #${summary.number}: ${summary.status}; labels: ${summary.labels}; details: ${summary.details}`,
    );
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
      body: buildPolicyComment(analysis),
    });
    return {
      blocked: true,
      number: pr.number,
      summary: summarizeResult({ pr, analysis }),
      skipped: false,
    };
  }

  await upsertPolicyComment({
    github,
    owner,
    repo,
    issueNumber,
    body: buildPolicyComment(analysis),
  });
  await requestMaintainerReview({ github, owner, repo, pr });
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

function getManualPullRequestNumbers({ context, core }) {
  const value = String(context.payload.inputs?.pr || "all").trim();

  if (value.toLowerCase() === "all") {
    return null;
  }

  const pullNumber = Number(value);

  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    core.setFailed('The "pr" input must be "all" or a positive PR number.');
    return [];
  }

  return [pullNumber];
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const payloadPr = context.payload.pull_request;
  const dryRunInput = context.payload.inputs?.dry_run;
  const dryRun =
    context.eventName === "workflow_dispatch" &&
    dryRunInput !== false &&
    dryRunInput !== "false";
  let pullNumbers;

  if (payloadPr != null) {
    pullNumbers = [payloadPr.number];
  } else {
    pullNumbers = getManualPullRequestNumbers({ context, core });
  }

  if (pullNumbers?.length === 0) {
    return;
  }

  const pullRequests =
    pullNumbers == null
      ? await listOpenPullRequests({ github, owner, repo })
      : pullNumbers.map((number) => ({ number }));
  const results = [];

  if (dryRun) {
    core.notice(
      `Running contribution policy in dry-run mode for ${
        pullNumbers == null
          ? "all open PRs"
          : pullNumbers.map((number) => `#${number}`).join(", ")
      }.`,
    );
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
        { data: "Title", header: true },
        { data: "Status", header: true },
        { data: "Labels", header: true },
        { data: "Details", header: true },
        { data: "Comment", header: true },
      ],
      ...results.map((result) => [
        result.summary.prLink,
        result.summary.title,
        result.summary.status,
        result.summary.labels,
        result.summary.details,
        result.summary.comment,
      ]),
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
