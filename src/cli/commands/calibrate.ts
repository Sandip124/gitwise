import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { loadCalibration, formatCalibrationReport } from "../../core/calibration.js";

export async function calibrateCommand(options: {
  path?: string;
  validate?: boolean;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();
  runMigrations(db);

  try {
    const calibration = loadCalibration(db, repoPath);

    if (!calibration) {
      console.log("No calibration data found.");
      console.log("Run `wisegit recompute` first to generate calibrated weights.");
      return;
    }

    console.log(formatCalibrationReport(calibration));
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
