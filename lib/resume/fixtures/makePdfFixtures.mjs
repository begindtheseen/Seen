// Builds realistic résumé PDFs with pdfkit for extractor/parser testing.
import PDFDocument from 'pdfkit';
import fs from 'fs';
const TTF = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url).pathname;
const TTFB = new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf', import.meta.url).pathname;
function build(fn) { return new Promise((resolve) => { const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 } }); const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); fn(doc); doc.end(); }); }

// 1) Word-like single column with embedded TrueType subset fonts, right-aligned dates, bullets.
const word = await build((doc) => {
  doc.registerFont('R', TTF).registerFont('B', TTFB);
  doc.font('B').fontSize(22).text('MARIA GONZALEZ', { align: 'center' });
  doc.font('R').fontSize(10).text('Phoenix, AZ • (480) 555-0177 • maria.gonzalez@example.com • linkedin.com/in/mariagonzalez', { align: 'center' });
  doc.moveDown(0.8);
  doc.font('B').fontSize(12).text('PROFESSIONAL SUMMARY');
  doc.font('R').fontSize(10).text('Registered Nurse with 6 years of acute-care experience in medical-surgical and telemetry units. Known for calm triage under pressure and precise charting in Epic.');
  doc.moveDown(0.8);
  doc.font('B').fontSize(12).text('EXPERIENCE');
  const role = (title, co, dates, bullets) => {
    const y = doc.y;
    doc.font('B').fontSize(11).text(title, 50, y, { width: 350 });
    doc.font('R').fontSize(10).text(dates, 400, y, { width: 162, align: 'right' });
    doc.font('R').fontSize(10).text(co, 50, doc.y);
    doc.font('R').fontSize(10).list(bullets, 58, doc.y + 2, { bulletRadius: 1.6, textIndent: 12, bulletIndent: 4, width: 500 });
    doc.moveDown(0.6);
  };
  role('Registered Nurse, Telemetry', 'Banner Health — Phoenix, AZ', 'Mar 2021 – Present', [
    'Care for 5–6 patients per shift on a 32-bed telemetry unit, coordinating with hospitalists and PT.',
    'Precept new graduate nurses; 4 of 4 preceptees passed probation on first review.',
    'Reduced medication documentation errors on the unit by 30% through a barcode double-check habit.',
  ]);
  role('Staff Nurse, Med-Surg', 'HonorHealth — Scottsdale, AZ', 'Jun 2018 – Feb 2021', [
    'Responsible for admissions, discharges and patient education for a 28-bed unit.',
    'Helped implement a new fall-prevention protocol that cut falls by 18% in six months.',
  ]);
  doc.font('B').fontSize(12).text('EDUCATION', 50);
  doc.font('R').fontSize(10).text('Bachelor of Science in Nursing — Arizona State University, Tempe, AZ, 2018');
  doc.moveDown(0.8);
  doc.font('B').fontSize(12).text('LICENSES & CERTIFICATIONS');
  doc.font('R').fontSize(10).list(['Registered Nurse (RN), Arizona Board of Nursing, 2018', 'BLS and ACLS, American Heart Association, 2024'], { bulletRadius: 1.6 });
  doc.moveDown(0.8);
  doc.font('B').fontSize(12).text('SKILLS');
  doc.font('R').fontSize(10).text('Epic EHR, Telemetry monitoring, IV therapy, Patient education, Triage, Spanish (fluent)');
});
fs.writeFileSync(new URL('./word.pdf', import.meta.url), word);

// 2) Two-column "modern" template: sidebar left (contact, skills, education), main right.
const twocol = await build((doc) => {
  doc.registerFont('R', TTF).registerFont('B', TTFB);
  doc.font('B').fontSize(24).text('DEVON PARK', 50, 50);
  doc.font('R').fontSize(11).text('Warehouse Operations Lead', 50, 80);
  const L = 50, LW = 150, R = 225, RW = 337;
  let y = 115;
  doc.font('B').fontSize(10).text('CONTACT', L, y, { width: LW }); y += 16;
  doc.font('R').fontSize(9).text('devon.park@example.com\n(214) 555-0138\nDallas, TX', L, y, { width: LW }); y += 48;
  doc.font('B').fontSize(10).text('SKILLS', L, y, { width: LW }); y += 16;
  doc.font('R').fontSize(9).text('Forklift certified (sit-down, reach)\nInventory control\nWMS: Manhattan, SAP EWM\nOSHA safety compliance\nTeam scheduling', L, y, { width: LW }); y += 70;
  doc.font('B').fontSize(10).text('EDUCATION', L, y, { width: LW }); y += 16;
  doc.font('R').fontSize(9).text('High School Diploma\nSkyline High School, Dallas, TX\n2014', L, y, { width: LW });
  let ry = 115;
  doc.font('B').fontSize(12).text('EXPERIENCE', R, ry, { width: RW }); ry += 20;
  const role = (title, co, dates, bullets) => {
    doc.font('B').fontSize(10.5).text(title, R, ry, { width: RW }); ry += 14;
    doc.font('R').fontSize(9).text(`${co}  |  ${dates}`, R, ry, { width: RW }); ry += 14;
    doc.font('R').fontSize(9.5).list(bullets, R + 6, ry, { width: RW - 6, bulletRadius: 1.4, textIndent: 10, bulletIndent: 2 });
    ry = doc.y + 8;
  };
  role('Warehouse Operations Lead', 'Amazon Fulfillment', 'Mar 2019 – Present', [
    'Supervised 12 associates across two shifts in outbound shipping.',
    'Cut mis-picks by 22% by adding a scan verification step at pack-out.',
    'Trained 30+ new hires on forklift safety and WMS procedures.',
  ]);
  role('Picker / Packer', 'Target Distribution Center', '2016 – 2019', [
    'Picked 180+ units per hour with 99.8% accuracy over three years.',
    'Worked on the inventory cycle-count team during peak season.',
  ]);
});
fs.writeFileSync(new URL('./twocol.pdf', import.meta.url), twocol);

// 3) Two-page résumé, classic Times, stacked headers (Company / Title / Dates on separate lines).
const twopage = await build((doc) => {
  doc.font('Times-Bold').fontSize(18).text('Samuel Okafor', { align: 'center' });
  doc.font('Times-Roman').fontSize(10).text('samuel.okafor@example.com | 312-555-0191 | Chicago, IL | github.com/sokafor', { align: 'center' });
  doc.moveDown();
  doc.font('Times-Bold').fontSize(12).text('WORK EXPERIENCE');
  for (let i = 0; i < 6; i++) {
    if (i === 4) doc.addPage(); // force a real second page so pagination is exercised
    doc.font('Times-Bold').fontSize(11).text(['Northwind Traders', 'Contoso Ltd', 'Fabrikam Inc', 'Adventure Works', 'Tailspin Toys', 'Wide World Importers'][i]);
    doc.font('Times-Italic').fontSize(10.5).text(['Senior Data Analyst', 'Data Analyst', 'Business Analyst', 'Reporting Analyst', 'Analyst Intern', 'Operations Intern'][i]);
    doc.font('Times-Roman').fontSize(10).text(['Jan 2022 – Present', 'Feb 2020 – Dec 2021', 'Jul 2018 – Jan 2020', 'Jun 2017 – Jun 2018', 'May 2016 – Aug 2016', 'May 2015 – Aug 2015'][i]);
    doc.font('Times-Roman').fontSize(10).list([
      `Built ${3 + i} dashboards in Tableau and Power BI used by ${20 * (i + 1)} managers weekly.`,
      'Automated recurring reports with Python and SQL, saving 10 hours per week.',
      'Partnered with finance to reconcile revenue data across three systems.',
      'Presented findings to leadership and documented data definitions.',
    ], { bulletRadius: 1.5 });
    doc.moveDown(0.5);
  }
  doc.font('Times-Bold').fontSize(12).text('EDUCATION');
  doc.font('Times-Roman').fontSize(10).text('M.S. Business Analytics, University of Illinois Chicago, 2017');
  doc.font('Times-Roman').fontSize(10).text('B.A. Economics, DePaul University, 2015');
  doc.moveDown();
  doc.font('Times-Bold').fontSize(12).text('TECHNICAL SKILLS');
  doc.font('Times-Roman').fontSize(10).text('Languages: Python, SQL, R\nTools: Tableau, Power BI, Excel, dbt, Snowflake\nMethods: A/B testing, forecasting, data modeling');
});
fs.writeFileSync(new URL('./twopage.pdf', import.meta.url), twopage);
console.log('built', word.length, twocol.length, twopage.length);
