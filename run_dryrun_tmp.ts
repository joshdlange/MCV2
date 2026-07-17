import { runDriveImageSyncDryRun } from './server/services/driveImageSync';
import fs from 'fs';
const report = await runDriveImageSyncDryRun();
fs.writeFileSync('/tmp/drive_dryrun_report.json', JSON.stringify(report, null, 2));
const { allCardFolders, allImageFiles, ...small } = report as any;
console.log(JSON.stringify(small.summary, null, 2));
console.log('firstLevel:', JSON.stringify(small.firstLevelFolders, null, 1));
console.log('report saved to /tmp/drive_dryrun_report.json');
process.exit(0);
