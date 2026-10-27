// The person's own words in a prep answer stay pinned to the sentence they finished.
//
// Round 4 (Dev, Tasha): "Add the posting and rebuild" kept every typed fill by QUESTION, so when the rebuild
// matched the same question to a different résumé line — or redrafted the sentence the fill continued — the
// person's words were stitched onto a story they never told ("At H-E-B Digital … Two services were writing
// balances out of order", a pay answer that contradicted itself) and stamped ✓ finished with a Copy button.
//
// A fill belongs to the GIVEN text around it (everything that is not a blank). On a rebuild, a fill is carried
// only when the new answer's given text and blank count are the same as the one it was typed into; otherwise
// the words are kept aside as the person's notes for that question, never shown as a finished answer.

/** The text of an answer with its [blanks] removed, normalised — what the fill was typed into. */
export function givenKey(answer) {
  return String(answer || '').replace(/\[[^\]]*\]/g, '\u0000').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** How many [blanks] an answer has. */
export function blankCount(answer) {
  return (String(answer || '').match(/\[[^\]]*\]/g) || []).length;
}

/** The keys a pack can be filled on besides its questions: the intro and the two emails. */
export const SPECIAL_FILL_KEYS = ['__intro__', '__thankyou__', '__followup__'];

/** The fillable text behind a key in a pack: an answer's text, the intro, or an email body. */
export function fillTarget(pack, key) {
  if (!pack) return null;
  if (key === '__intro__') return pack.intro || null;
  if (key === '__thankyou__') return pack.emails?.thankYou?.body || null;
  if (key === '__followup__') return pack.emails?.followUp?.body || null;
  const a = Array.isArray(pack.answers) ? pack.answers.find((x) => x.q === key) : null;
  return a ? a.answer : null;
}

/**
 * Carry the fills from the pack a person typed into onto a rebuilt pack.
 * @returns {{ fills: Record<string, string[]>, notes: Record<string, string[]> }} fills that still belong to
 *   their sentence, and the words set aside because the sentence changed (keyed by question).
 */
export function carryFills(priorPack, nextPack) {
  const prior = priorPack && typeof priorPack.fills === 'object' && priorPack.fills ? priorPack.fills : {};
  const notes = { ...(priorPack && typeof priorPack.notes === 'object' && priorPack.notes ? priorPack.notes : {}) };
  // the sentence each note was typed into (given text + blank count), so a later rebuild that brings the same
  // sentence back makes the note a finished answer again (round 6, Maria: a restored posting line brought the
  // question back word for word and her words stayed parked as notes)
  const noteKeys = { ...(priorPack && typeof priorPack.noteKeys === 'object' && priorPack.noteKeys ? priorPack.noteKeys : {}) };
  const sentenceKey = (t) => `${givenKey(t)}|${blankCount(t)}`;
  const fills = {};
  for (const [key, values] of Object.entries(prior)) {
    if (!Array.isArray(values) || !values.some((v) => String(v || '').trim())) continue;
    const was = fillTarget(priorPack, key);
    const now = fillTarget(nextPack, key);
    if (was != null && now != null && sentenceKey(was) === sentenceKey(now)) { fills[key] = values; delete notes[key]; delete noteKeys[key]; continue; }
    // the words are the person's; the sentence they finished is gone — kept as notes, never as an answer
    notes[key] = values.filter((v) => String(v || '').trim());
    if (was != null) noteKeys[key] = sentenceKey(was);
  }
  for (const [key, values] of Object.entries(notes)) {
    if (fills[key]) continue;
    const now = fillTarget(nextPack, key);
    if (now != null && noteKeys[key] && noteKeys[key] === sentenceKey(now) && Array.isArray(values) && values.length === blankCount(now)) { fills[key] = values; delete notes[key]; delete noteKeys[key]; }
  }
  for (const key of Object.keys(noteKeys)) if (!notes[key]) delete noteKeys[key];
  // a note whose question left the pack entirely is still kept — it is their writing
  return { fills, notes, noteKeys };
}
