import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { getDb, closeDb } from "../../db/database.js";
import { collectReportData } from "../../report/collect.js";
import { generateHtmlReport } from "../../report/html.js";
import { logger } from "../../shared/logger.js";

export async function reportCommand(options: {
  path?: string;
  output?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    console.log("Collecting metrics...");
    const data = collectReportData(db, repoPath);

    console.log("Generating report...");
    const html = generateHtmlReport(data);

    const repoName = repoPath.split("/").pop() ?? "wisegit";
    const outputPath = options.output ?? resolve(repoPath, `wisegit-report.html`);

    writeFileSync(outputPath, html, "utf-8");

    console.log(`\nReport generated: ${outputPath}`);
    console.log(`\n  ${data.totalCommits} commits, ${data.totalEvents} events, ${data.totalFunctions} functions`);
    console.log(`  Theory health: ${data.theoryHealth.healthy} healthy, ${data.theoryHealth.fragile} fragile, ${data.theoryHealth.critical} critical`);
    console.log(`  Freeze: ${data.freezeDistribution.frozen} frozen, ${data.freezeDistribution.stable} stable, ${data.freezeDistribution.open} open`);
    console.log(`\n  Open in browser: file://${outputPath}`);
  } catch (err) {
    logger.error("Report generation failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
