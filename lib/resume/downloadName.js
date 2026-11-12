// The name of a downloaded résumé file: the person's name, "Resume", and the job it was built for — ASCII only, hyphens
// between words ("Daniela-Ortiz-Resume-Shift-Lead.docx"). A name that does not read as a person's name is left out
// (never a heading or a stray line printed into a file name). Pure; runs in the browser.
const ascii = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function resumeFileName(name, jobTitle, ext = 'docx') {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const person = /^[\p{L}][\p{L}.'’-]*(\s+[\p{L}][\p{L}.'’-]*){1,3}$/u.test(n) ? ascii(n) : '';
  // the role without a parenthesis or a trailing " - Location" / " | Team"
  const job = ascii(String(jobTitle || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+[-–—|,·]\s.*$/, '')).split('-').filter(Boolean).slice(0, 6).join('-');
  const base = [person, 'Resume', job].filter(Boolean).join('-').slice(0, 90).replace(/-+$/, '');
  return `${base}.${String(ext).replace(/^\./, '')}`;
}
