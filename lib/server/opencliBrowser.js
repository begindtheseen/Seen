// OpenCLI's generic browser commands (open / eval / close) for the Mac-local collectors, in whichever
// argument form the installed OpenCLI speaks. The 2.0 README shows the session as a flag
// (`opencli browser open <url> --session work`); the 1.8 README says the session is a positional right after
// `browser` (`opencli browser work open <url>`). Neither can be checked from a server, so the first call tries
// the flag form and, when OpenCLI answers with a usage/session error, retries once in the other form and keeps
// whichever worked. Tests: lib/server/opencliBrowser.test.mjs.

const USAGE_ERROR = /session|positional|unknown (?:option|command|argument)|usage:|missing required|too many arguments|unexpected argument/i;

export function createOpenCliBrowser({ run, session = 'seen' }) {
  if (typeof run !== 'function') throw new Error('createOpenCliBrowser needs run(args) → OpenCLI data');
  let form = null; // 'flag' | 'positional', fixed after the first call that works
  const argsFor = (f, cmd, rest) => (f === 'positional' ? ['browser', session, cmd, ...rest] : ['browser', cmd, ...rest, '--session', session]);
  async function call(cmd, ...rest) {
    if (form) return run(argsFor(form, cmd, rest));
    try { const v = await run(argsFor('flag', cmd, rest)); form = 'flag'; return v; }
    catch (e) {
      // Judge OpenCLI's ANSWER, not the echoed command line: "Command failed: opencli browser open … --session
      // seen — <answer>" always contains "session", which made every real failure (a page that would not
      // load) look like a usage error and get retried in the other form, hiding the real reason.
      const msg = String(e?.message || e);
      const answer = msg.includes(' — ') ? msg.slice(msg.indexOf(' — ') + 3) : msg.replace(/^Command failed:[^\n]*?--session \S+/, '');
      if (!USAGE_ERROR.test(answer)) throw e;
      const v = await run(argsFor('positional', cmd, rest)); form = 'positional'; return v;
    }
  }
  return {
    open: (url) => call('open', url),
    eval: (js) => call('eval', js),
    close: () => call('close'),
    get form() { return form; },
  };
}
