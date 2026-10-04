import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { QUOTA_DIALOG_COMMANDS } from "../src/lib/quota-dialog-command-specs.js";
import { QUOTA_RPC_ID, QuotaRpc } from "../src/rpc.js";

type ValidateResult = { value?: unknown; issues?: ReadonlyArray<{ message: string }> };
type StandardSchema = {
  "~standard": {
    version: number;
    vendor: string;
    types?: unknown;
    validate: (value: unknown) => unknown;
  };
};

async function validate(schema: StandardSchema, value: unknown): Promise<ValidateResult> {
  return (await schema["~standard"].validate(value)) as ValidateResult;
}

async function expectAccepted(schema: StandardSchema, value: unknown): Promise<void> {
  const result = await validate(schema, value);
  expect(result.issues).toBeUndefined();
  expect(result.value).toBe(value);
}

async function expectRejected(schema: StandardSchema, value: unknown, message: string) {
  const result = await validate(schema, value);
  expect(result.issues).toEqual([{ message }]);
  expect(result).not.toHaveProperty("value");
}

const methods = QuotaRpc.methods;

describe("quota RPC definition", () => {
  it("defines the plain RPC id, no events and two methods", () => {
    expect(QUOTA_RPC_ID).toBe("npv12.opencode-quota");
    expect(QuotaRpc.id).toBe(QUOTA_RPC_ID);
    expect(QuotaRpc.events).toEqual({});
    expect(Object.keys(methods)).toEqual(["surface", "command"]);
  });

  it("uses Standard Schema v1 validators that carry no runtime types", () => {
    for (const method of Object.values(methods)) {
      for (const schema of [method.input, method.output]) {
        expect(schema["~standard"]).toEqual(
          expect.objectContaining({ version: 1, vendor: "opencode-quota" }),
        );
        expect(schema["~standard"]).not.toHaveProperty("types");
      }
    }
  });

  it("validates surface input", async () => {
    await expectAccepted(methods.surface.input, { surface: "sidebar", sessionID: "session-1" });
    await expectRejected(methods.surface.input, null, "input must be an object");
    await expectRejected(methods.surface.input, [], "input must be an object");
    await expectRejected(
      methods.surface.input,
      { sessionID: "session-1" },
      "surface must be sidebar",
    );
    await expectRejected(
      methods.surface.input,
      { surface: "idle", sessionID: "session-1" },
      "surface must be sidebar",
    );
    await expectRejected(
      methods.surface.input,
      { surface: "sidebar" },
      "sessionID must be a string",
    );
    await expectRejected(
      methods.surface.input,
      { surface: "sidebar", sessionID: 1 },
      "sessionID must be a string",
    );
  });

  it("validates command input", async () => {
    for (const spec of QUOTA_DIALOG_COMMANDS) {
      await expectAccepted(methods.command.input, { command: spec.id });
    }
    await expectAccepted(methods.command.input, {
      command: "quota",
      arguments: "anything",
      sessionID: "session-1",
    });
    await expectRejected(methods.command.input, 1, "input must be an object");
    await expectRejected(methods.command.input, {}, "command must be a quota command id");
    await expectRejected(
      methods.command.input,
      { command: "quota_nope" },
      "command must be a quota command id",
    );
    await expectRejected(
      methods.command.input,
      { command: "tokens_today" },
      "command must be a quota command id",
    );
    await expectRejected(
      methods.command.input,
      { command: "quota", arguments: 5 },
      "arguments must be a string",
    );
    await expectRejected(
      methods.command.input,
      { command: "quota", sessionID: 5 },
      "sessionID must be a string",
    );
  });

  it("requires every output to be an object", async () => {
    for (const method of Object.values(methods)) {
      await expectAccepted(method.output, { any: "object" });
      for (const value of [undefined, null, "text", 1, []]) {
        await expectRejected(method.output, value, "output must be an object");
      }
    }
  });

  it("ships dist/rpc.js without loading any @opencode package", () => {
    const source = readFileSync(new URL("../dist/rpc.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*["']@opencode\//);
    expect(source).toContain('from "./lib/quota-dialog-command-specs.js"');
  });
});
