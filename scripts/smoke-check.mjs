import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootUrl = new URL("../", import.meta.url);
const manifestUrl = new URL("manifest.json", rootUrl);

const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("Expected a Manifest V3 extension.");
}

const requiredFiles = new Set([
  manifest.background?.service_worker,
  manifest.options_page,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
].filter(Boolean));

for (const filePath of requiredFiles) {
  await access(new URL(filePath, rootUrl));
}

const javascriptFiles = [
  "src/background.js",
  "src/shared.js",
  "src/options.js",
  "src/blocked.js"
];

for (const filePath of javascriptFiles) {
  await execFileAsync(process.execPath, ["--check", filePath], {
    cwd: rootUrl
  });
}

console.log("Extension smoke check passed.");
