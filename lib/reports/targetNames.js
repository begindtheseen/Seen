// Which company names are worth searching for applicant reports.
// A board slug that was only capitalized ("Andurilindustries", "Ivcevidensia") matches no one's post, and a
// search for it burns the run's minutes (seen live 2026-10-21: 2 companies, 0 accounts, all 230 s). Real
// names have a space, a Seen grade row, or are a normal-length single word ("Walmart", "Salesforce").
// Used by the targets endpoint (Mac collectors) and the hourly cloud run.
export const searchableName = (c) => /\s/.test(c.company) || !!c.has_score || String(c.company).length < 12;
