#!/usr/bin/env node

// Script to automatically generate a weekly progress report.
//
// Usage:
//   node scripts/weekly-progress-report.mjs
//
// The report will be saved as `weekly_progress_report_<year>-<month>-<day>.txt` in the current directory.

const fs = require('fs');
const { exec } = require('child_process');
const moment = require('moment');

async function generateReport() {
  const today = moment().format('YYYY-MM-DD');
  const reportFilename = `weekly_progress_report_${today}.txt`;

  // Collect data for the report
  const commitData = await new Promise((resolve, reject) => {
    exec('git log --oneline --since="1 week ago"', (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve(stdout.trim());
    });
  });

  // Collect other relevant data as needed
  const additionalData = 'Add any other relevant data here.';

  // Construct the report content
  const reportContent = `
Weekly Progress Report for ${moment().format('MMMM Do, YYYY')}

Commits from the past week:
${commitData}

Additional Data:
${additionalData}
`;

  // Save the report to a file
  fs.writeFileSync(reportFilename, reportContent);
  console.log(`Report generated and saved as ${reportFilename}`);
}

generateReport().catch((error) => {
  console.error('Error generating the weekly progress report:', error.message);
});
