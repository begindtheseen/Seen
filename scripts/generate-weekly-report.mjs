#!/usr/bin/env node

// This script generates a weekly progress report based on the current week's data.
// It logs the progress to the console and could be extended to send an email or save to a file.

const moment = require('moment');

async function generateReport() {
  const now = moment();
  const weekLabel = `week of ${now.format('MMM D, YYYY')}`;
  
  // Fetch and process data for the report
  const ghostedApps = await db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id,company_name,role,city,stage,updated_at&order=updated_at.desc&limit=100`);
  const hiredApps = await db(`applications?status=eq.hired&updated_at=gte.${monthISO}&select=id,company_name,role,city,updated_at&order=updated_at.desc&limit=100`);

  console.log(`Generating weekly progress report for ${weekLabel}`);
  console.log('Ghosted Applications:', ghostedApps);
  console.log('Hired Applications:', hiredApps);

  // Send email or save to file (future enhancement)
}

generateReport().catch(err => {
  console.error('Error generating weekly report:', err);
});
