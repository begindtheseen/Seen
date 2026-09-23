// Pure, client-safe mapping from a Gmail capture to a tracker application (Gmail auto-capture,
// stage 2). No Node built-ins so both the confirm UI (components/GmailConnect) and the server can
// import it. Confirming a capture reuses the EXISTING user-sync `add_application` contract — this
// only shapes the payload.

// Pipeline stages (lib/constants STAGES): Applied / Viewed / Phone Screen / Interview / Final Round
// / Offer. Terminal state lives in `status` (active | rejected | ghosted | hired), NOT the stage.
export const EVENT_TO_STAGE = {
  application_submitted: { status: 'active', stage: 'Applied' },
  response_received:     { status: 'active', stage: 'Viewed' },
  assessment_received:   { status: 'active', stage: 'Phone Screen' },
  interview_received:    { status: 'active', stage: 'Interview' },
  offer_received:        { status: 'active', stage: 'Offer' },
  rejected:              { status: 'rejected', stage: 'Applied' },
};

/**
 * Shape a capture into the `application` object user-sync's add_application expects.
 * @param {{company?:string, event?:string, outcome?:string, confidence?:string, received_at?:string, message_id?:string, subject?:string}} capture
 * @returns {object|null} null when there's no company to attach to
 */
export function captureToApplication(capture) {
  if (!capture || !capture.company) return null;
  const map = EVENT_TO_STAGE[capture.event] || EVENT_TO_STAGE.response_received;
  const dateMs = capture.received_at ? Date.parse(capture.received_at) : NaN;
  const date = Number.isFinite(dateMs) ? dateMs : Date.now();
  return {
    company: capture.company,
    role: '', // not reliably present in headers — the user fills it in on the card
    platform: 'Gmail',
    status: map.status,
    stage: map.stage,
    appliedAt: date, // ms epoch — matches Application.appliedAt (number)
    events: [{
      id: `gmail-${capture.message_id || capture.signature || date}`.slice(0, 40),
      type: capture.event || 'response_received',
      date,
      source: 'gmail',
      confidence: capture.confidence || 'medium',
    }],
  };
}
