import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMarkdownSection } from "./helpers/markdown-document.js";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function headingIndex(document: string, heading: string): number {
  const index = document.split("\n").findIndex((line) => line === `## ${heading}`);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("contribution guidance", () => {
  const prTemplate = read(".github/pull_request_template.md");
  const contributing = read("CONTRIBUTING.md");

  it("places Before-and-after evidence after OpenCode Validation and before Quality Checklist", () => {
    const openCodeValidation = headingIndex(prTemplate, "OpenCode Validation");
    const evidence = headingIndex(prTemplate, "Before-and-after evidence");
    const quality = headingIndex(prTemplate, "Quality Checklist");
    expect(openCodeValidation).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(quality);
    expect(headingIndex(contributing, "Before-and-after screenshots (required)")).toBeLessThan(
      headingIndex(contributing, "PR checklist"),
    );
  });

  it("requires matching screenshots, retained surfaces, redaction, and justified Not applicable", () => {
    const templateEvidence = readMarkdownSection(prTemplate, /^Before-and-after evidence$/);
    expect(templateEvidence).toContain("matching before-and-after screenshots");
    expect(templateEvidence).toContain("Web output");
    expect(templateEvidence).toContain("TUI sidebar");
    expect(templateEvidence).toContain("/quota` report");
    expect(templateEvidence).toContain("unchanged or untested");
    expect(templateEvidence).toMatch(
      /redact credentials, account identifiers, private paths, and other sensitive information/i,
    );
    expect(templateEvidence).toContain("`Not applicable`");
    expect(templateEvidence).toContain("explain briefly");
    expect(templateEvidence).toContain("Formatter tests do not count as screenshot evidence");

    const contributingEvidence = readMarkdownSection(
      contributing,
      /^Before-and-after screenshots \(required\)$/,
    );
    expect(contributingEvidence).toContain("must include before-and-after screenshots");
    expect(contributingEvidence).toContain("same config, model, theme, and window size");
    expect(contributingEvidence).toContain("Web output, the TUI sidebar, and the `/quota` report");
    expect(contributingEvidence).toContain("Say which ones you didn't test");
    expect(contributingEvidence).toContain(
      "credentials, account identifiers, and private paths hidden",
    );
    expect(contributingEvidence).toContain("`Not applicable`");
    expect(contributingEvidence).toContain("Tests don't replace screenshots");

    expect(readMarkdownSection(contributing, /^PR checklist$/)).toContain(
      "Before-and-after screenshots and surface results, or `Not applicable`",
    );
  });

  it("uses the Bun typecheck, build, and test commands and keeps production-version and focused-change requirements", () => {
    expect(prTemplate).toContain("I ran `bun run typecheck`, `bun run build`, and `bun run test`");
    expect(prTemplate).not.toContain("pnpm");
    expect(prTemplate).toContain("Current production released OpenCode version tested:");
    expect(prTemplate).toContain("This change is focused and avoids unrelated behavior changes");
    expect(contributing).toContain("bun run typecheck");
    expect(contributing).toContain("bun run build");
    expect(contributing).toContain("bun run test");
    expect(contributing).not.toContain("pnpm");
    expect(contributing).toContain("Tested on the current released OpenCode");
    expect(contributing).toContain("smallest safe fix");
  });
});
