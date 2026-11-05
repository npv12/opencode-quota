import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean | string;
  };
  jobs: Record<
    string,
    {
      permissions?: Record<string, string>;
      steps?: WorkflowStep[];
    }
  >;
}

type IssueScriptCall = { method: string; labels?: string[] };

// Runs one actions/github-script step of the issue workflow against a fake issue.
async function runIssueScript(
  jobId: string,
  issue: { title: string; body: string; labels?: string[] },
): Promise<IssueScriptCall[]> {
  const workflow = parse(
    await readFile(".github/workflows/thin-issue-check.yml", "utf8"),
  ) as Workflow;
  const script = workflow.jobs[jobId]?.steps?.[0]?.with?.script;
  if (typeof script !== "string") throw new Error(`no script in job ${jobId}`);

  const calls: IssueScriptCall[] = [];
  const github = {
    rest: {
      issues: {
        addLabels: async (params: { labels: string[] }) => {
          calls.push({ method: "addLabels", labels: params.labels });
        },
        createComment: async () => {
          calls.push({ method: "createComment" });
        },
      },
    },
  };
  const context = {
    repo: { owner: "slkiser", repo: "opencode-quota" },
    payload: {
      issue: {
        number: 1,
        title: issue.title,
        body: issue.body,
        labels: (issue.labels ?? []).map((name) => ({ name })),
      },
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction("github", "context", script)(github, context);
  return calls;
}

// GitHub renders each issue form answer as "### <label>", a blank line, then the answer.
function formBody(answers: Array<[label: string, answer: string]>): string {
  return answers.map(([label, answer]) => `### ${label}\n\n${answer}`).join("\n\n");
}

const LONG_SUMMARY = "The sidebar shows the weekly window twice after a restart.";

describe("GitHub workflows", () => {
  it("only lets stale automation close issues labeled needs info", async () => {
    const source = await readFile(".github/workflows/close-inactive-issues.yml", "utf8");
    const workflow = parse(source) as Workflow;
    const staleJob = workflow.jobs.stale;
    const staleStep = staleJob?.steps?.find(
      (step) => step.name === "Mark and close inactive issues",
    );

    expect(staleStep).toEqual(
      expect.objectContaining({
        uses: "actions/stale@v10",
        with: expect.objectContaining({
          "only-issue-labels": "needs info",
          "days-before-issue-stale": 14,
          "days-before-issue-close": 7,
          "days-before-pr-stale": -1,
          "days-before-pr-close": -1,
        }),
      }),
    );
    expect(staleStep?.with).not.toHaveProperty("exempt-issue-labels");
  });

  it("runs the thin issue check with only issues write permission", async () => {
    const source = await readFile(".github/workflows/thin-issue-check.yml", "utf8");
    const workflow = parse(source) as Workflow;

    expect(workflow.jobs.check?.permissions).toEqual({ issues: "write" });
  });

  it("adds the v4 label from the issue form answer, and never removes labels", async () => {
    const workflow = parse(
      await readFile(".github/workflows/thin-issue-check.yml", "utf8"),
    ) as Workflow;
    expect(workflow.jobs["version-labels"]?.permissions).toEqual({ issues: "write" });

    const title = "Sidebar shows a window twice";
    const v4Body = formBody([
      ["Which OpenCode do you use?", "OpenCode 1"],
      ["What went wrong?", LONG_SUMMARY],
    ]);
    await expect(runIssueScript("version-labels", { title, body: v4Body })).resolves.toEqual([
      { method: "addLabels", labels: ["v4"] },
    ]);
    await expect(
      runIssueScript("version-labels", { title, body: v4Body.replace(/\n/gu, "\r\n") }),
    ).resolves.toEqual([{ method: "addLabels", labels: ["v4"] }]);
    await expect(
      runIssueScript("version-labels", {
        title,
        body: formBody([
          ["Which OpenCode do you use?", "OpenCode 1"],
          ["What's the problem?", LONG_SUMMARY],
        ]),
      }),
    ).resolves.toEqual([{ method: "addLabels", labels: ["v4"] }]);

    for (const body of [
      formBody([["Which OpenCode do you use?", "OpenCode 2"]]),
      formBody([["What went wrong?", "OpenCode 1"]]),
      "",
    ]) {
      await expect(runIssueScript("version-labels", { title, body })).resolves.toEqual([]);
    }
    // Already labeled (or labeled by hand with an answer that no longer matches): no calls.
    await expect(
      runIssueScript("version-labels", { title, body: v4Body, labels: ["v4"] }),
    ).resolves.toEqual([]);
    await expect(
      runIssueScript("version-labels", {
        title,
        body: formBody([["Which OpenCode do you use?", "OpenCode 2"]]),
        labels: ["v4", "v6"],
      }),
    ).resolves.toEqual([]);
  });

  it("does not count the version dropdown answers as typed text in the thin issue check", async () => {
    const thinBody = formBody([
      ["Which OpenCode do you use?", "OpenCode 1"],
      ["What went wrong?", "broken"],
    ]);
    await expect(
      runIssueScript("check", { title: "Sidebar shows a window twice", body: thinBody }),
    ).resolves.toEqual([
      { method: "addLabels", labels: ["needs info"] },
      { method: "createComment" },
    ]);

    const fullBody = formBody([
      ["Which OpenCode do you use?", "OpenCode 2"],
      ["What went wrong?", LONG_SUMMARY],
    ]);
    await expect(
      runIssueScript("check", { title: "Sidebar shows a window twice", body: fullBody }),
    ).resolves.toEqual([]);
  });

  it("counts a typed dropdown answer outside its own dropdown in the thin issue check", async () => {
    // 45 typed characters without spaces; dropping the typed "OpenCode 1" leaves 36 (< 40).
    const body = formBody([
      ["Which OpenCode do you use?", "OpenCode 2"],
      ["OpenCode version", "2.0.20"],
      ["What's the problem?", "Quota retries stop."],
      ["What would you like to happen?", "Wait for reset."],
      ["Other ideas you thought about (optional)", "OpenCode 1"],
    ]);
    await expect(
      runIssueScript("check", { title: "Retries stop at the limit", body }),
    ).resolves.toEqual([]);

    // The dropdown's own answer still does not count.
    await expect(
      runIssueScript("check", {
        title: "Retries stop at the limit",
        body: body.replace(
          "Other ideas you thought about (optional)\n\nOpenCode 1",
          "Other ideas you thought about (optional)\n\n_No response_",
        ),
      }),
    ).resolves.toEqual([
      { method: "addLabels", labels: ["needs info"] },
      { method: "createComment" },
    ]);
  });

  it("asks what the reporter sees first, then which OpenCode", async () => {
    type Field = {
      type: string;
      id?: string;
      attributes: { label?: string; options?: unknown[] };
      validations?: { required?: boolean };
    };
    const readForm = async (file: string) =>
      parse(await readFile(`.github/ISSUE_TEMPLATE/${file}`, "utf8")) as { body: Field[] };
    const bug = await readForm("bug_report.yml");
    const feature = await readForm("feature_request.yml");
    const provider = await readForm("provider_request.yml");

    for (const form of [bug, feature, provider]) {
      expect(form.body[0]?.type).toBe("markdown");
      expect(form.body[0]?.attributes).toMatchObject({
        value: expect.stringContaining("Title: the problem you see, not the fix."),
      });
    }
    for (const form of [bug, feature]) {
      expect(form.body[1]).toMatchObject({
        type: "input",
        id: "what_you_see",
        attributes: { label: "In one sentence, what do you see?" },
        validations: { required: true },
      });
    }
    expect(provider.body[1]).toMatchObject({
      type: "input",
      id: "what_should_show",
      attributes: { label: "In one sentence, what should the plugin show for this provider?" },
      validations: { required: true },
    });

    expect(bug.body[2]).toMatchObject({
      type: "dropdown",
      id: "opencode_line",
      attributes: {
        label: "Which OpenCode do you use?",
        options: ["OpenCode 2", "OpenCode 1"],
      },
      validations: { required: true },
    });
    expect(feature.body[2]).toEqual(bug.body[2]);
  });

  it("keeps issue forms without title prefills and with their labels", async () => {
    const expectedLabels: Record<string, string[]> = {
      "bug_report.yml": ["bug"],
      "feature_request.yml": ["feature"],
      "provider_request.yml": ["provider"],
    };
    for (const [file, labels] of Object.entries(expectedLabels)) {
      const form = parse(await readFile(`.github/ISSUE_TEMPLATE/${file}`, "utf8")) as {
        title?: string;
        labels?: string[];
      };
      expect(form.title, file).toBeUndefined();
      expect(form.labels, file).toEqual(labels);
    }
  });

  it("cancels a stale pull request CI run but never a push to main", async () => {
    const workflow = parse(await readFile(".github/workflows/ci.yml", "utf8")) as Workflow;
    // A pull request run shares its number's group; every push to main gets a group of its own
    // (its commit), so no push to main cancels or replaces another.
    const group =
      "ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}";
    expect(workflow.concurrency).toEqual({
      group,
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });
});
