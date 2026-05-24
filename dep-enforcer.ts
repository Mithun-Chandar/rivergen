import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { GeneratorConfig } from "./config";

// ─── Required package matrix ───────────────────────────────────────────────────

/**
 * Packages that MUST exist in the target project.
 * These are non-negotiable for the realtime law to hold end-to-end.
 * If any are missing the plan will WARN before any writes proceed.
 * With --install the enforcer will run `pnpm add` in the correct workspace.
 */
export const REQUIRED_PACKAGES = {
  api: {
    dependencies: [
      "zod", // EventFactory .strict() schema validation — mandatory
      "socket.io", // WebSocket transport
      "express", // HTTP server
    ],
    devDependencies: ["@types/express", "@types/node", "typescript", "tsx"],
  },
  web: {
    dependencies: [
      "zod", // Client-side schema validation
      "socket.io-client", // WebSocket client
      "@tanstack/react-query", // Server state + cache layer
    ],
    devDependencies: ["typescript"],
  },
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MissingPackage {
  workspace: "api" | "web";
  packageName: string;
  depType: "dependencies" | "devDependencies";
  packageJsonPath: string;
}

export interface DepEnforcerResult {
  ok: boolean;
  missing: MissingPackage[];
  summary: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readPackageJson(
  projectRoot: string,
  relPath: string,
): Record<string, Record<string, string>> {
  const absPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(absPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8")) as Record<
      string,
      Record<string, string>
    >;
  } catch {
    return {};
  }
}

function hasPackage(
  pkg: Record<string, Record<string, string>>,
  depType: "dependencies" | "devDependencies",
  packageName: string,
): boolean {
  const deps = pkg[depType];
  if (!deps) return false;
  return packageName in deps;
}

// ─── Main enforcer ─────────────────────────────────────────────────────────────

/**
 * Checks the target project's package.json files against the required dep matrix.
 * Returns a list of all missing packages with their workspace and dep type.
 */
export function checkDependencies(
  projectRoot: string,
  config: GeneratorConfig,
): DepEnforcerResult {
  const missing: MissingPackage[] = [];

  const apiPkg = readPackageJson(projectRoot, config.api.packageJsonPath);
  const webPkg = readPackageJson(projectRoot, config.web.packageJsonPath);

  // Check API dependencies
  for (const pkgName of REQUIRED_PACKAGES.api.dependencies) {
    if (!hasPackage(apiPkg, "dependencies", pkgName)) {
      missing.push({
        workspace: "api",
        packageName: pkgName,
        depType: "dependencies",
        packageJsonPath: config.api.packageJsonPath,
      });
    }
  }
  for (const pkgName of REQUIRED_PACKAGES.api.devDependencies) {
    const inDeps = hasPackage(apiPkg, "dependencies", pkgName);
    const inDev = hasPackage(apiPkg, "devDependencies", pkgName);
    if (!inDeps && !inDev) {
      missing.push({
        workspace: "api",
        packageName: pkgName,
        depType: "devDependencies",
        packageJsonPath: config.api.packageJsonPath,
      });
    }
  }

  // Check Web dependencies
  for (const pkgName of REQUIRED_PACKAGES.web.dependencies) {
    if (!hasPackage(webPkg, "dependencies", pkgName)) {
      missing.push({
        workspace: "web",
        packageName: pkgName,
        depType: "dependencies",
        packageJsonPath: config.web.packageJsonPath,
      });
    }
  }
  for (const pkgName of REQUIRED_PACKAGES.web.devDependencies) {
    const inDeps = hasPackage(webPkg, "dependencies", pkgName);
    const inDev = hasPackage(webPkg, "devDependencies", pkgName);
    if (!inDeps && !inDev) {
      missing.push({
        workspace: "web",
        packageName: pkgName,
        depType: "devDependencies",
        packageJsonPath: config.web.packageJsonPath,
      });
    }
  }

  const summary = missing.map((m) => {
    const flag = m.depType === "devDependencies" ? "-D" : "";
    return `  MISSING [${m.workspace}] pnpm add ${flag} ${m.packageName}  (${m.packageJsonPath})`;
  });

  return {
    ok: missing.length === 0,
    missing,
    summary,
  };
}

/**
 * Installs all missing packages in their respective workspaces.
 * Only runs if --install flag is passed. Exits on failure.
 */
export function installMissing(
  projectRoot: string,
  missing: MissingPackage[],
): void {
  if (missing.length === 0) {
    console.log("[gen-v2] All required dependencies are present.");
    return;
  }

  // Group by workspace + depType
  const groups = new Map<
    string,
    { workspace: string; flag: string; packages: string[] }
  >();

  for (const m of missing) {
    const flag = m.depType === "devDependencies" ? "-D" : "";
    const key = `${m.workspace}:${flag}`;
    if (!groups.has(key)) {
      groups.set(key, { workspace: m.workspace, flag, packages: [] });
    }
    groups.get(key)!.packages.push(m.packageName);
  }

  for (const [, group] of groups) {
    const workspaceDir = path.join(
      projectRoot,
      group.workspace === "api" ? "apps/api" : "apps/web",
    );
    const cmd = `pnpm add ${group.flag} ${group.packages.join(" ")}`.trim();
    console.log(`[gen-v2] Installing in ${group.workspace}: ${cmd}`);
    try {
      execSync(cmd, { cwd: workspaceDir, stdio: "inherit" });
    } catch (err) {
      console.error(
        `[gen-v2] Install failed for ${group.workspace}: ${String(err)}`,
      );
      process.exit(1);
    }
  }
}
