import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionDirectory = path.join(rootDirectory, "dist");

function resolveCommitSha() {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { cwd: rootDirectory }).toString().trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  await mkdir(distributionDirectory, { recursive: true });
  const buildInfo = {
    commit: resolveCommitSha(),
    builtAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(distributionDirectory, "build-info.json"),
    JSON.stringify(buildInfo, null, 2),
  );
  console.log(`Wrote build-info.json (commit ${buildInfo.commit})`);
}

main();
