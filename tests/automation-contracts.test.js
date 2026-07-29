import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const playwrightConfig = require("../playwright.config.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = path.join(root, ".github", "workflows");
const workflowNames = fs
  .readdirSync(workflowRoot)
  .filter((name) => name.endsWith(".yml"));
const workflows = Object.fromEntries(
  workflowNames.map((name) => [
    name,
    fs.readFileSync(path.join(workflowRoot, name), "utf8"),
  ]),
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

describe("automation contracts", () => {
  it("has exactly one workflow that publishes GitHub Releases", () => {
    const publishers = Object.entries(workflows)
      .filter(([, source]) => source.includes("softprops/action-gh-release"))
      .map(([name]) => name);

    expect(publishers).toEqual(["release-deploy.yml"]);
    expect(workflows["build-apk.yml"]).toContain("workflow_call:");
    expect(workflows["release-deploy.yml"]).toContain(
      "uses: ./.github/workflows/build-apk.yml",
    );
    expect(workflows["release-deploy.yml"]).toContain(
      "files: release-assets/app-debug.apk",
    );
    expect(workflows["release-deploy.yml"]).toContain(
      "ref: ${{ needs.release-check.outputs.release_ref }}",
    );
    expect(workflows["build-apk.yml"]).toContain(
      "ref: ${{ inputs.ref || github.ref }}",
    );
  });

  it("uses action majors whose JavaScript runtime is Node 24", () => {
    const allWorkflows = Object.values(workflows).join("\n");
    for (const action of [
      "actions/checkout@v7",
      "actions/setup-node@v7",
      "actions/setup-java@v5",
      "actions/upload-artifact@v7",
      "actions/download-artifact@v8",
      "android-actions/setup-android@v4",
      "softprops/action-gh-release@v3",
    ]) {
      expect(allWorkflows).toContain(`uses: ${action}`);
    }
    expect(allWorkflows).not.toMatch(/actions\/(checkout|setup-node)@v4/);
    expect(allWorkflows).not.toContain("softprops/action-gh-release@v2");
  });

  it("fails VPS deployment atomically and fetches only the release tag", () => {
    const releaseWorkflow = workflows["release-deploy.yml"];

    expect(releaseWorkflow).toContain("set -Eeuo pipefail");
    expect(releaseWorkflow).toContain("exit_status=\\$?");
    expect(releaseWorkflow).toContain('exit "\\$exit_status"');
    expect(releaseWorkflow).toContain("safe.directory=/opt/tetris");
    expect(releaseWorkflow).toContain(
      '"refs/tags/$DEPLOY_REF:refs/tags/$DEPLOY_REF"',
    );
    expect(releaseWorkflow).not.toContain("fetch origin --tags");
    expect(releaseWorkflow).toContain(
      "EXPECTED_REVISION: ${{ needs.release-check.outputs.revision }}",
    );
    expect(releaseWorkflow).toContain(
      "EXPECTED_VERSION: ${{ needs.release-check.outputs.release_ref }}",
    );
  });

  it("parallelizes functional E2E while isolating the performance budget", () => {
    expect(playwrightConfig.workers).toBeGreaterThan(1);
    expect(packageJson.scripts["test:e2e"]).toBe(
      "npm run test:e2e:functional && npm run test:e2e:performance",
    );
    expect(packageJson.scripts["test:e2e:performance"]).toContain("--no-deps");
    const performanceProject = playwrightConfig.projects.find(
      (project) => project.name === "galaxy-s25-fe-performance",
    );
    const visualProject = playwrightConfig.projects.find(
      (project) => project.name === "chromium",
    );
    const webkitProject = playwrightConfig.projects.find(
      (project) => project.name === "webkit",
    );
    const parallelProjectNames = [
      "chromium-functional",
      "firefox",
      "galaxy-s25-fe",
      "mobile-360x700",
      "mobile-390x844",
      "mobile-landscape-780x360",
    ];

    expect(webkitProject.dependencies).toEqual(parallelProjectNames);
    expect(visualProject.dependencies).toEqual(["webkit"]);
    expect(performanceProject.dependencies).toEqual(["chromium"]);
    expect(String(performanceProject.grep)).toBe("/@performance/");
    for (const project of playwrightConfig.projects.filter((candidate) =>
      [
        "galaxy-s25-fe",
        ...parallelProjectNames.filter((name) => name.startsWith("mobile-")),
      ].includes(candidate.name),
    )) {
      expect(String(project.grepInvert)).toBe("/@performance/");
    }
  });
});
