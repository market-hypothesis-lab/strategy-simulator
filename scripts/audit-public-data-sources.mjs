import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { auditSources, validateSourceRegistry } from "../src/public-scan/source-audit.mjs";

const configPath = resolve(process.argv[2] ?? "config/public-data-sources.v1.json");
const outputPath = resolve(process.argv[3] ?? "runtime/public-source-audit.json");
const registry = JSON.parse(await readFile(configPath, "utf8"));
const sources = validateSourceRegistry(registry);
const report = await auditSources(sources, { token: process.env.GITHUB_TOKEN ?? "" });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
const rejected = report.sources.filter((source) => source.status === "rejected");
console.log(`audited=${report.sources.length} rejected=${rejected.length}`);
if (rejected.length) process.exitCode = 1;
