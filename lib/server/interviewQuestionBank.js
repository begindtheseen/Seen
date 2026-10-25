// Hand-written interview questions per field, for the Interview Prep pack when no model answer is
// available (2026-10-25 eval: the generated ones read "Give me an example of when you showed safety",
// "How would you handle handling a busy register line…", and a Store Manager got cashier questions).
//
// Each question is one a hiring manager in that field really asks, with a one-line "why" written to
// the candidate. No numbers and no premises about the person: the bank never claims anything about
// their past. `lead` questions are for titles that run people (lead, supervisor, manager, charge).

const Q = (q, why) => ({ q, why });

const BANK = {
  customer_service: {
    base: [
      Q('Tell me about the hardest customer you have dealt with. What did you do?', 'They check you stay calm and still fix the problem. Pick a real one with a clear ending.'),
      Q('What do you do when a customer asks for something you cannot give them?', 'They want to hear you say no kindly and offer what you can do instead.'),
      Q('How do you keep your quality up when the queue is long and people are upset?', 'They check how you pace yourself on a busy day.'),
      Q('How do you make sure a problem is really solved before you close it?', 'They screen for follow-through: notes, checking back, and escalating the right way.'),
    ],
    lead: [
      Q('How would you coach an agent whose quality scores are slipping?', 'Team leads are judged on how their people improve, not just their own calls.'),
      Q('When do you step in on a hard call, and when do you let the agent handle it?', 'They want judgment: support without taking over.'),
    ],
  },
  retail: {
    base: [
      Q('A customer wants to return something the policy does not allow. What do you do?', 'They check you follow the policy and keep the customer on your side.'),
      Q('The line is long and a customer on the floor needs help. How do you handle it?', 'They want to see you call for backup and keep both customers moving.'),
      Q('How do you start a conversation with a customer who is just browsing?', 'Stores want friendly selling, not pressure.'),
      Q('What would you do if you saw a coworker take something?', 'An integrity question. The answer they want: tell a manager, do not handle it yourself.'),
    ],
    lead: [
      Q('Payroll hours get cut for next week. How do you build the schedule?', 'Store leaders are judged on running the store to a labor budget.'),
      Q('Sales are down against last year. What do you look at first, and what do you change?', 'They want to hear how you read the numbers and act on them.'),
      Q('How do you keep shrink down in your store?', 'Loss prevention is part of every store leader\'s numbers.'),
      Q('How do you handle an associate who keeps coming in late?', 'They check you hold people accountable fairly and in writing.'),
      Q('How do you get the store ready for a big truck or a holiday weekend?', 'Freight, staffing and the floor all have to be ready at once.'),
    ],
  },
  warehouse: {
    base: [
      Q('How do you keep working safely when the pace picks up?', 'Safety is the first thing every warehouse screens for.'),
      Q('Tell me about a time you found a mistake in an order or a shipment. What did you do?', 'They want accuracy and owning the fix.'),
      Q('Which equipment are you trained on, and which are you still learning?', 'Be exact about forklifts, reach trucks, pallet jacks and scanners. Never overstate a certification.'),
      Q('How do you keep your rate up across a whole shift without cutting corners?', 'They check for steady pace and good habits, not speed alone.'),
    ],
    lead: [
      Q('Your shift is behind the plan with two hours left. What do you do?', 'Leads are judged on hitting the plan: they want how you move people and what you escalate.'),
      Q('How do you handle a crew member who keeps missing rate or skipping a safety step?', 'They check you correct people early, fairly and safely.'),
      Q('How do you run a start-of-shift meeting?', 'Good leads set the plan, the safety point and the priorities in a few minutes.'),
      Q('How do you find the cause of picking or shipping errors on your shift?', 'They want a lead who fixes causes, not just counts mistakes.'),
    ],
  },
  delivery_logistics: {
    base: [
      Q('How do you plan your day when you have more stops than usual?', 'They check you can sequence a route and keep the customer informed.'),
      Q('What do you do when the customer is not there or the address is wrong?', 'They want you to follow the process, not guess.'),
      Q('How do you stay safe and on time when traffic or weather throws off your schedule?', 'Safety first, then communication.'),
      Q('What do you do with a package that is damaged before you deliver it?', 'They check you report it instead of hiding it.'),
    ],
  },
  valet_parking: {
    base: [
      Q('A guest says their car was scratched. What do you do?', 'They want calm, a report, and a manager, never an argument.'),
      Q('How do you keep track of keys when it gets busy?', 'Key control is the job. Name the system you would use.'),
      Q('How do you stay friendly and fast during a rush?', 'Guests remember the wait and the greeting.'),
    ],
  },
  food_service: {
    base: [
      Q('The ticket rail is full and an order comes back wrong. What do you do?', 'They want you to fix it fast without stopping the line.'),
      Q('How do you keep food safe and your station clean during a rush?', 'Food safety and sanitation are checked at every kitchen interview.'),
      Q('How do you work with the front of house when things get tense?', 'They check you communicate, not argue, on a busy night.'),
      Q('Tell me about a time you had to learn a new station or menu quickly.', 'Kitchens move people around. They want someone who picks things up fast.'),
    ],
    lead: [
      Q('You are short a cook on a busy night. How do you run the line?', 'Kitchen leads are judged on getting through the night with what they have.'),
      Q('How do you keep food cost and waste down?', 'Prep amounts, rotation and portioning are part of a lead\'s numbers.'),
    ],
  },
  hospitality: {
    base: [
      Q('A guest is upset because their room is not ready. What do you say?', 'They want empathy, an option, and a time, not an excuse.'),
      Q('How do you make a guest feel welcome when you are busy?', 'They check the small things: name, eye contact, a clear next step.'),
      Q('Tell me about a time you went out of your way for a guest.', 'Pick a real story with a specific detail.'),
      Q('What do you do when a guest asks for something you are not allowed to give?', 'Say no kindly and offer what you can do.'),
    ],
  },
  healthcare_support: {
    base: [
      Q('How do you protect a patient\'s dignity and privacy during care?', 'Respect and privacy are checked at every patient-care interview.'),
      Q('Tell me about a time a patient\'s condition changed. What did you notice and who did you tell?', 'They want you to notice, act within your role, and report fast.'),
      Q('How do you handle a patient or family member who is upset?', 'They check you stay calm and kind and bring in the right person.'),
      Q('How do you keep your charting accurate when the shift is busy?', 'Documentation errors are a safety risk. Describe your habit.'),
    ],
  },
  nursing: {
    base: [
      Q('Two of your patients need you at the same time. How do you decide who comes first?', 'Prioritization is the core nursing question. Walk through your reasoning (airway, breathing, circulation, safety).'),
      Q('Tell me about a time you caught a change in a patient\'s condition early. What did you do?', 'They want assessment, escalation and follow-through.'),
      Q('Walk me through how you give and take handoff report.', 'Safe handoffs prevent errors. Describe the format you use.'),
      Q('What do you do when you disagree with a provider about a patient\'s care?', 'They check you advocate for the patient and use the chain of command.'),
      Q('How do you handle a patient or family member who is angry or scared?', 'They want calm, clear explanations and knowing when to bring in help.'),
    ],
    lead: [
      Q('As charge nurse, how do you make assignments when the unit is short-staffed?', 'They check fairness, acuity and safety.'),
      Q('How do you support a new nurse who is struggling on your unit?', 'Charge and preceptor roles are judged on how they bring people along.'),
    ],
    night: [
      Q('How do you stay sharp and safe on night shift?', 'Night units ask this every time. Be specific about your routine.'),
    ],
  },
  administrative: {
    base: [
      Q('Two important meetings land at the same time. How do you sort out the calendar?', 'They want judgment about priorities and clear communication.'),
      Q('Several people need things from you at once. How do you decide what comes first?', 'They check you can rank work by deadline and impact, and say so.'),
      Q('How do you handle confidential information?', 'Discretion is the first thing an office screens for.'),
      Q('Tell me about a time you caught an error before it went out.', 'Accuracy is the job. Pick a real catch.'),
      Q('Which office tools do you use every day, and how well?', 'Be exact; they may test you on them.'),
    ],
    executive: [
      Q('How do you plan travel for someone whose schedule keeps changing?', 'Executive assistants are judged on handling changes without dropping details.'),
      Q('How do you support more than one executive without letting anyone down?', 'They want your system for priorities and check-ins.'),
    ],
  },
  sales: {
    base: [
      Q('Walk me through how you find and reach out to new prospects.', 'They want a repeatable process, not luck.'),
      Q('What do you do when a prospect says "not right now"?', 'They check you follow up with a reason, not pressure.'),
      Q('How do you track your activity and your pipeline?', 'Sales managers want reps who know their own numbers.'),
      Q('Tell me about a deal you lost. What did you learn?', 'They want honesty and what you changed afterward.'),
    ],
    sdr: [
      Q('How do you balance call volume with personalizing your outreach?', 'Every SDR interview asks this. Show you can do both.'),
      Q('How do you open a cold call?', 'Be ready to do it live; many SDR interviews include a role-play.'),
    ],
  },
  software_engineering: {
    base: [
      Q('Walk me through a system you built. What were the trade-offs, and what would you change now?', 'They want depth on one real project, including what did not go well.'),
      Q('Tell me about a production incident you worked on. How did you find the cause?', 'They check how you debug under pressure and what you changed after.'),
      Q('How do you make sure a change is safe to ship?', 'Tests, reviews, rollouts and monitoring: name what you really do.'),
      Q('Tell me about a time you disagreed with a technical decision.', 'They want respectful disagreement backed by evidence.'),
    ],
    lead: [
      Q('How do you help less experienced engineers grow?', 'Senior roles are judged on the people around them too.'),
    ],
    payments: [
      Q('How would you design a payment flow so a retry never charges someone twice?', 'Payments teams screen for idempotency and correctness when things fail.'),
    ],
  },
  data_analytics: {
    base: [
      Q('Walk me through an analysis you did, from the question to the decision it changed.', 'They want impact, not just queries.'),
      Q('How do you check your numbers are right before you share them?', 'They screen for habits that catch errors.'),
      Q('Tell me about a time the data did not support what a stakeholder wanted to hear.', 'They check you stay honest and explain it well.'),
      Q('How do you explain a finding to someone who is not technical?', 'Analysts are judged on whether people act on their work.'),
    ],
  },
  operations: {
    base: [
      Q('Tell me about a process you improved. How did you know it was better?', 'They want a before, an after and how you measured it.'),
      Q('Several things are going wrong at once. How do you decide what to fix first?', 'They check your judgment under pressure.'),
      Q('How do you get people to follow a new process when they are used to the old one?', 'Operations is half process, half people.'),
      Q('Which numbers do you look at every day, and why?', 'They want someone who runs on data.'),
    ],
  },
  security: {
    base: [
      Q('What do you do when someone refuses to follow a rule or leave?', 'They want de-escalation and knowing when to call for help.'),
      Q('Walk me through how you write an incident report.', 'Clear, factual reports are part of the job.'),
      Q('How do you stay alert on a long, quiet shift?', 'They check your routine for patrols and checks.'),
      Q('When do you step in yourself, and when do you call it in?', 'They screen for judgment and staying within your role.'),
    ],
  },
  finance_accounting: {
    base: [
      Q('Walk me through your month-end close.', 'They want your steps, your timing and what you own.'),
      Q('A reconciliation does not tie out. How do you find the difference?', 'They check your method, not just the answer.'),
      Q('Tell me about a time you found an error in the numbers. What did you do?', 'They want accuracy and owning the fix.'),
      Q('How do you get ready for an audit?', 'Support, documentation and timing.'),
      Q('How do you explain a big variance to a manager?', 'Accountants are judged on clear explanations, not just entries.'),
    ],
  },
  marketing: {
    base: [
      Q('Walk me through a campaign you worked on: the goal, what you did, and how it performed.', 'They want your part, in order, with the result.'),
      Q('How do you decide what to post or send, and how do you know if it worked?', 'They check you plan from goals and read the results.'),
      Q('How do you keep a brand\'s voice the same across channels?', 'Consistency is the job in a coordinator role.'),
      Q('Tell me about something you launched that did not work. What did you change?', 'They want honesty and what you learned.'),
      Q('How do you keep track of several deadlines at once?', 'Coordinators are judged on not dropping things.'),
    ],
  },
  education: {
    base: [
      Q('How do you use student data to plan your teaching?', 'Schools want teachers who adjust instruction from evidence.'),
      Q('Tell me about a student who was struggling and what you did.', 'Pick a real student (no names) and what changed.'),
      Q('How do you handle a disruptive class?', 'They check your classroom management, before and during.'),
      Q('How do you work with parents, including ones who are upset?', 'Communication with families is part of every teaching job.'),
      Q('How do you support students with IEPs or 504 plans?', 'Be concrete about accommodations and working with specialists.'),
      Q('How do you work with your grade-level team?', 'Collaboration (PLCs, shared planning) is screened for.'),
    ],
  },
  project_management: {
    base: [
      Q('Walk me through a project you ran from start to finish.', 'They want scope, plan, risks and the result.'),
      Q('Tell me about a project that slipped. What did you do?', 'They check honesty and recovery.'),
      Q('How do you handle someone who keeps changing the scope?', 'They want your change process.'),
      Q('How do you keep a team on track when they do not report to you?', 'Influence without authority is the job.'),
    ],
  },
  skilled_trades: {
    base: [
      Q('Walk me through how you find the cause of a problem you have not seen before.', 'They want a step-by-step diagnostic process.'),
      Q('How do you make sure a job is done safely and to code?', 'Safety and code compliance come first.'),
      Q('Tell me about a job that went wrong. How did you fix it?', 'They check honesty and problem solving.'),
      Q('How do you explain a repair and its cost to a customer?', 'Techs who explain well get trusted and get callbacks.'),
      Q('Which equipment and systems are you most comfortable with, and where do you need more time?', 'Be exact. Overstating a system is the fastest way to fail a ride-along.'),
    ],
    commercial: [
      Q('How is commercial work different from residential, and how are you closing that gap?', 'If your experience is mostly residential, they will ask. Be honest and specific about what you are learning.'),
    ],
  },
  general: {
    base: [
      Q('Walk me through your main duties in your last job, with one example.', 'They want to picture you doing the work.'),
      Q('Tell me about a time you learned something new quickly.', 'They check how fast you get up to speed.'),
      Q('How do you handle a day when there is too much to do?', 'They want how you decide what comes first.'),
      Q('Tell me about a mistake you made at work and what you did about it.', 'They want honesty and the fix, not perfection.'),
    ],
    lead: [
      Q('Tell me about a time you led a team or a shift.', 'They want how you organized people and what happened.'),
      Q('How do you handle someone on your team who is not pulling their weight?', 'They check you address it early and fairly.'),
    ],
  },
};

const LEAD_RE = /\b(lead|supervisor|manager|head|director|chief|charge|foreman|captain|principal|senior|sr\.?|staff)\b/i;

/** The question bank for one role: field questions, then the variants the title and résumé call for. */
export function bankQuestions(family, { role = '', resumeText = '' } = {}) {
  const r = String(role || '');
  const nurse = /\b(nurse|rn|lpn|lvn)\b/i.test(r);
  const b = BANK[nurse ? 'nursing' : family] || BANK.general;
  const lead = LEAD_RE.test(r);
  const out = [];
  // Leaders get their leadership questions first, mixed with the field's core ones.
  if (lead && b.lead) {
    const l = [...b.lead];
    const base = [...b.base];
    while (l.length || base.length) { if (l.length) out.push(l.shift()); if (l.length) out.push(l.shift()); if (base.length) out.push(base.shift()); }
  } else out.push(...b.base);
  if (nurse && /\bnight/i.test(r)) out.push(...(b.night || []));
  if (family === 'administrative' && /\bexecutive|\bEA\b/i.test(r)) out.unshift(...(BANK[family]?.executive || []));
  if (family === 'sales' && /\b(sdr|bdr|development rep)/i.test(r)) out.unshift(...(BANK[family]?.sdr || []));
  if (family === 'software_engineering' && /payment/i.test(r)) out.unshift(...(BANK[family]?.payments || []));
  if (family === 'skilled_trades' && /commercial/i.test(r) && !/commercial/i.test(resumeText)) out.unshift(...(BANK[family]?.commercial || []));
  return out;
}

// A story question that fits what the résumé line says (round 1: "Tell me about a time you worked with a
// team" ← "Served 40+ guests a shift").
const CUES = [
  [/\b(?:saved|retained|kept) \d+ (?:in|of) \d+\b|\bretention\b|\bwin-?backs?\b/i, ['Tell me about a time you turned an unhappy customer around.']],
  [/\b(?:closed|sold) \$|\$[\d.,]+[kKmM]? in (?:sales|contracts|revenue)\b/i, ['Tell me about your best sale.']],
  [/\b(cut|cutting|reduc\w+|lower(?:ed|ing)|saving|decreas\w+|eliminat\w+|ending|recovered)\b/i, ['Tell me about a time you cut a cost, a delay or a loss.', 'Tell me about a problem you fixed for good.']],
  [/\b(raised|grew|increas\w+|improv\w+|boost\w+|lifted|doubled)\b/i, ['Tell me about a time you improved a result.', 'What is a result you are proud of?']],
  [/\b(trained|training|coached|mentored|precepted|onboarded|taught)\b/i, ['Tell me about a time you trained or coached someone.']],
  [/\b(built|rebuilt|created|designed|launched|wrote|automated|set up|started|developed)\b/i, ['Tell me about something you built or set up that others used.', 'Tell me about a problem you solved by building something.']],
  [/\b(supervis\w+|led (?:a |the |my )?(?:team|crew|shift|group)|managed (?:a |the |my )?(?:team|crew|staff|\d+)|directed)\b|^(?:Lead|Supervise|Manage) (?:a |the )?\S*\s?(?:team|crew|shift|staff)/i, ['Tell me about a time you led people or ran a shift.']],
  [/\b(named|award\w*|recogni[sz]ed|promoted|top \w+|ranked|the most|highest|first place)\b|#\d+ of \d+/i, ['What is a result you are proud of?']],
  [/\b(took over|stepped in|filled in|covered for)\b/i, ['Tell me about a time you stepped in when things were hard.']],
  [/^(?:Care|Handle|Answer|Serve|Run|Work|Process|Support|Assist|Help|Operate|Prepare|Maintain|Teach|Manage|Floated|Operated|Took)\b/, ['Tell me about a typical busy day in that job.']],
  [/\b(patients?)\b/i, ['Tell me about a patient you cared for that you still think about.'], 'healthcare_support'],
  [/\b(helped|resolv\w+|assisted|answered)\b/i, ['Tell me about a time you helped someone through a problem.']],
];
const DEFAULTS = ['Walk me through one thing you did well in that job.', 'Tell me about a typical busy day in that job.', 'Walk me through how you do that part of the job.'];

export function storyQuestion(text, used = new Set(), family = '') {
  for (const [re, qs, only] of CUES) {
    if (only && only !== family) continue;
    if (!re.test(text)) continue;
    const q = qs.find((x) => !used.has(x));
    if (q) return q;
  }
  return DEFAULTS.find((q) => !used.has(q)) || DEFAULTS[0];
}
