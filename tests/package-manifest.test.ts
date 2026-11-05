import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

describe("package manifest", () => {
  it("is the @npv12 fork with the expected entrypoints", () => {
    expect(pkg.name).toBe("@npv12/opencode-quota");
    expect(pkg.version).toMatch(/^2\.\d+\.\d+$/);
    expect(pkg.bin).toEqual({ "opencode-quota": "./dist/bin/opencode-quota.js" });
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./server": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./tui": { types: "./dist/tui.d.ts", default: "./dist/tui.js" },
    });
    expect(pkg.exports["./gui-experimental"]).toBeUndefined();
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
  });

  it("builds with Bun and Biome, and tests with Vitest", () => {
    expect(pkg.scripts.build).toContain("tsc");
    expect(pkg.scripts.build).toContain("prepare-tui-dist.mjs");
    expect(pkg.scripts.build).not.toContain("gui");
    expect(pkg.scripts.check).toBe("biome check .");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
    expect(pkg.packageManager).toBeUndefined();
    expect(existsSync(new URL("../bun.lock", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../pnpm-lock.yaml", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../vite.config.ts", import.meta.url))).toBe(false);
  });

  it("keeps the runtime dependencies small and the OpenCode peer current", () => {
    expect(pkg.dependencies).toEqual({ "jsonc-parser": "^3.3.1" });
    expect(pkg.dependencies["@opentelemetry/api"]).toBeUndefined();
    expect(pkg.peerDependencies["@opencode/plugin"]).toBe(">=2.0.28");
    expect(pkg.engines.node).toBe("^22.13.0 || >=23.4.0");
    expect(pkg.devDependencies["@biomejs/biome"]).toBeDefined();
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies["vite-plus"]).toBeUndefined();
  });

  it("compiles the TUI from src and ships no JSX artifacts", () => {
    const tsconfig = JSON.parse(read("tsconfig.json"));
    expect(tsconfig.compilerOptions.rootDir).toBe("./src");
    expect(tsconfig.compilerOptions.jsx).toBe("preserve");
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@opentui/solid");
    expect(tsconfig.include).toEqual(["src/**/*"]);
  });

  it("names the fork in its README", () => {
    const readme = read("README.md");
    expect(readme).toContain("@npv12/opencode-quota");
    expect(readme).not.toContain("npx @slkiser/opencode-quota");
  });
});
