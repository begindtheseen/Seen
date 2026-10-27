// Generated from the hand-written tech.json (scripts/guides-to-js.mjs) — edit the JSON, not this file.
// 33 companies. Every sentence is hedged and limited to what the company publishes or what is
// consistently reported in public; see lib/server/interviewGuides.js.
export default {
 "group": "tech",
 "guides": [
  {
   "names": [
    "Google",
    "Alphabet",
    "Google Cloud",
    "YouTube",
    "Google LLC"
   ],
   "confidence": "high",
   "framework": {
    "name": "Google's four attributes (GCA, role-related knowledge, leadership, Googleyness)",
    "note": "Google says every interviewer rates you on four things: general cognitive ability (how you think through a problem), role-related knowledge, leadership (stepping up without a title), and Googleyness (comfort with ambiguity, caring about users and the team). Expect each answer to be scored against one of them, so say your reasoning out loud."
   },
   "format": {
    "default": "Google uses structured interviews: every candidate for a role gets the same kinds of questions, scored on a rubric, and a separate hiring committee reviews the written feedback rather than the people who met you. It usually starts with a recruiter call about your background, location and what roles fit, then one or two phone or video interviews, then an onsite or virtual loop of roughly four to five interviews of about 45 minutes each. The recruiter call rarely goes deep on pay; level is usually settled after the loop, and comp is discussed once there is an offer. The whole process often takes several weeks to a couple of months.",
    "tech": "Software interviews are mostly coding on a shared document or whiteboard-style tool, with data structures, algorithms and time/space tradeoffs, plus a system design interview for more experienced levels and one behavioral interview on leadership and Googleyness. You are expected to ask clarifying questions, talk through your approach before writing code, and test your own work. Interviewers often follow up with a harder variant once you solve the first version.",
    "corporate": "Non-engineering roles (marketing, sales, operations, finance, people) use the same four attributes. Expect a mix of behavioral questions, hypothetical 'how would you approach' questions about the role, and role-related knowledge questions. Many applicants report a case-style question where you reason through a business problem out loud with imperfect information."
   },
   "questions": [
    {
     "q": "Walk me through how you would figure out why a product's usage dropped last month.",
     "why": "General cognitive ability. They are grading how you break the problem down, what data you would ask for and how you handle not knowing. Think aloud, name your assumptions, and say what you would check first and why.",
     "audience": "all",
     "principle": "General cognitive ability"
    },
    {
     "q": "Tell me about a time you had to make a decision without all the information you wanted.",
     "why": "Googleyness and GCA together: comfort with ambiguity. Describe the decision, what you did to reduce the uncertainty, what you decided and what you learned afterward.",
     "audience": "all",
     "principle": "Googleyness"
    },
    {
     "q": "Tell me about a time you helped a team move forward when you were not in charge.",
     "why": "Google calls this emergent leadership: stepping up when something needed doing, then stepping back. Pick a real moment, say what the group was stuck on, what you did and how it ended.",
     "audience": "all",
     "principle": "Leadership"
    },
    {
     "q": "Tell me about a time you disagreed with a teammate or manager. How did you handle it?",
     "why": "Googleyness: being direct while staying collaborative. Show you argued with data and respect, and say what the outcome was even if you did not get your way.",
     "audience": "all",
     "principle": "Googleyness"
    },
    {
     "q": "Design a system that lets millions of users store and share files.",
     "why": "Role-related knowledge and GCA for engineers. Clarify requirements first (scale, read vs write, consistency), sketch the pieces, then go deep on one or two tradeoffs. Interviewers care more about your reasoning than a perfect diagram.",
     "audience": "tech",
     "principle": "Role-related knowledge"
    },
    {
     "q": "Given this problem, how would you solve it? Now what if the input were a hundred times larger?",
     "why": "Coding interviews usually escalate after a working solution. State the brute force, give its complexity, then improve it. Test with a small example and an edge case before you say you are done.",
     "audience": "tech",
     "principle": "General cognitive ability"
    },
    {
     "q": "How would you decide which of two features to launch first if you could only do one this quarter?",
     "why": "A hypothetical for non-engineering roles. They want a structure: who the users are, what you would measure, what tradeoffs you would accept. Pick one and defend it; a hedge without a decision scores poorly.",
     "audience": "corporate",
     "principle": "General cognitive ability"
    },
    {
     "q": "Tell me about something you learned recently on your own and how you went about it.",
     "why": "Googleyness includes curiosity and bias to learn. Keep it concrete: what you wanted to learn, how you practiced, how you know you got better.",
     "audience": "all",
     "principle": "Googleyness"
    }
   ],
   "tips": [
    "Say your thinking out loud for the whole interview; a silent correct answer scores worse than a spoken path to a good one.",
    "Ask clarifying questions before you start solving anything; vague prompts are deliberate.",
    "Your interviewers are not the decision makers, so write-up-friendly answers help: clear situation, your action, a measurable result.",
    "For coding, practice on a plain document rather than an IDE; many Google rounds do not give you autocomplete or a compiler.",
    "Prepare one story for each of the four attributes so you can match whatever they ask.",
    "Googleyness is not about being quirky; it is about ambiguity, user focus and working well with others."
   ],
   "ask_them": [
    "How is feedback from the interviews combined, and what happens after the loop?",
    "What does the team's work look like day to day, and how does it reach users?"
   ],
   "watch": "Timelines are long and quiet; a committee review after the loop can take weeks, so silence after the onsite is normal, not a rejection."
  },
  {
   "names": [
    "Microsoft",
    "Microsoft Corporation",
    "Xbox",
    "Azure"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Growth mindset culture",
    "note": "Microsoft describes its culture as growth mindset: learning from mistakes, being customer obsessed, diverse and inclusive, and working as 'One Microsoft'. Interviewers often listen for how you learned from a failure as much as for the success."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, the roles that fit and your timeline, sometimes a technical or hiring-manager phone screen, then a virtual or onsite loop of around four to five interviews in one day. Many applicants report a final 'as appropriate' interview with a senior leader that only happens if the earlier rounds went well. Comp is usually discussed with the recruiter after the loop; level is tied to years of relevant experience and what the loop shows. Expect several weeks end to end.",
    "tech": "Software loops mix coding (data structures, algorithms, often with real-world framing), a design or architecture discussion for experienced levels, and behavioral questions about collaboration, customers and learning from mistakes. Interviewers frequently ask you to write code in a shared editor and then test it yourself. Each interviewer typically writes feedback before the next one meets you.",
    "corporate": "Marketing, sales, finance, program management and operations roles lean on behavioral and situational questions tied to growth mindset and customer obsession, plus role-specific scenario questions. Expect to be asked for examples of influencing without authority and of changing your mind."
   },
   "questions": [
    {
     "q": "Tell me about a time you failed at something and what you did next.",
     "why": "Growth mindset is the core of Microsoft's culture talk. Do not pick a fake failure; name what went wrong, what you changed, and how you applied it later.",
     "audience": "all",
     "principle": "Growth mindset"
    },
    {
     "q": "Tell me about a time you changed your approach because of feedback or new information.",
     "why": "They want to see you learn in the open. Say who gave the feedback, what you did differently, and the result.",
     "audience": "all",
     "principle": "Growth mindset"
    },
    {
     "q": "Describe a time you worked with another team to get something done that neither could do alone.",
     "why": "'One Microsoft' means working across org lines. Explain how you found common ground and kept both sides moving.",
     "audience": "all",
     "principle": "One Microsoft"
    },
    {
     "q": "Tell me about a time you put the customer's need ahead of what was easiest for you or your team.",
     "why": "Customer obsessed. Show you understood the customer's actual problem and made a tradeoff for them.",
     "audience": "all",
     "principle": "Customer obsessed"
    },
    {
     "q": "Write a function that solves this problem, then tell me how you would test it.",
     "why": "Microsoft coding rounds often weigh testing and edge cases heavily. Walk through inputs, handle the empty and oversized cases, and say what you would add in production.",
     "audience": "tech"
    },
    {
     "q": "How would you design a service that many teams in the company would depend on?",
     "why": "Design discussion for senior engineers. Cover reliability, versioning, and how other teams would adopt it; mention how you would roll out changes safely.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you had to influence a decision without having authority over the people involved.",
     "why": "Common for program and business roles. Show how you built the case, who you brought along and what changed.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Have a real failure story ready and finish it with what you learned; it is asked more here than at most companies.",
    "Microsoft interviewers tend to probe how you work with others, so give credit to teammates in your stories.",
    "Write tests for your own code in coding rounds before the interviewer asks.",
    "Know what the product or team you are interviewing with actually ships and who uses it.",
    "If a final senior interview appears late in the day, treat it as a real interview, not a formality."
   ],
   "ask_them": [
    "What does growth look like on this team for someone in this role over the first year?",
    "How does the team decide what to build next and who the customer is?"
   ],
   "watch": "Loops are often scheduled as one long day; many applicants report not knowing in advance whether the final senior interview will be added."
  },
  {
   "names": [
    "Apple",
    "Apple Inc.",
    "Apple Computer"
   ],
   "confidence": "medium",
   "format": {
    "default": "Apple hires team by team, so the process differs more than at other big companies. Usually a recruiter call about your background and the specific team, then a hiring-manager call, then several interviews with members of that team, often in more than one session. Many applicants report meeting many people and being told little about what the team actually works on because of secrecy. Comp is typically discussed after the interviews. This guide covers corporate and engineering roles; Apple Store roles interview differently.",
    "tech": "Engineering rounds are usually deep technical conversations with the people you would work with: coding with practical problems, systems or domain questions tied to the team's area (hardware, OS, apps, services), and questions about your past projects in detail. Expect to be asked why you made specific technical choices and what you would do differently. Interviewers often care about craft and attention to detail.",
    "corporate": "Marketing, operations, finance and retail-corporate roles usually involve multiple one-on-one conversations with the team and partner functions, with behavioral questions about collaboration, judgment and quality, plus role-specific scenario questions."
   },
   "questions": [
    {
     "q": "Tell me about a project you are most proud of. Walk me through the decisions you made.",
     "why": "Apple interviewers often spend a long time on one past project. Be ready to go several levels deep on why you chose what you chose and what you would change now.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you noticed a small detail others missed and it mattered.",
     "why": "Attention to detail is a theme. Pick a concrete example and say what would have happened if you had not caught it.",
     "audience": "all"
    },
    {
     "q": "Why Apple, and why this team?",
     "why": "Asked often and taken seriously. Talk about the products you use and specific things you admire or would improve, not slogans.",
     "audience": "all"
    },
    {
     "q": "How would you debug a problem that only happens on some devices some of the time?",
     "why": "Engineering teams like practical, hard-to-reproduce problems. Describe how you would narrow it down step by step and what you would log or measure.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you had to work with people who did not report to you to ship something on a fixed date.",
     "why": "Many Apple projects run across teams toward a fixed launch. Show how you managed dependencies and kept quality up under time pressure.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you pushed back on a plan because the quality was not good enough.",
     "why": "They want people who will say something is not ready. Explain how you raised it, what the tradeoff was and how it resolved.",
     "audience": "all"
    }
   ],
   "tips": [
    "Expect to be told very little about the project; prepare questions about how the team works rather than what it builds.",
    "Know your own résumé cold; interviewers often pick one line and go very deep.",
    "Show that you care about the product experience, not just the technology.",
    "Many rounds are conversations rather than quizzes, so bring examples with tradeoffs you can discuss.",
    "If you are asked for a presentation or work sample, keep it tight and polished; sloppiness is noticed."
   ],
   "ask_them": [
    "How does this team work with design and other engineering teams day to day?",
    "What does the team expect someone to accomplish in their first few months?"
   ],
   "watch": "The process can involve many interviewers over several weeks with long gaps; applicants commonly report NDAs and very limited information about the role."
  },
  {
   "names": [
    "Meta",
    "Facebook",
    "Meta Platforms",
    "Instagram",
    "WhatsApp",
    "Reality Labs"
   ],
   "confidence": "high",
   "framework": {
    "name": "Meta's values + its published interview guides",
    "note": "Meta publishes its values (move fast, focus on long-term impact, build awesome things, live in the future, be direct and respect your colleagues, Meta, Metamates, me) and public prep guides for each interview type. Behavioral answers land best when they show speed, impact and directness with real numbers."
   },
   "format": {
    "default": "Usually a recruiter screen that covers your background, the roles in play and timeline, then a technical or role screen, then a loop of several interviews over one or two days. Meta publishes what each interview type checks, and interviewers are trained on a shared rubric. Level is usually decided after the loop based on how you performed, and comp is discussed by the recruiter at offer stage. Expect several weeks.",
    "tech": "Software loops usually include two coding interviews (data structures and algorithms, in a plain shared editor with no compiler), one system or product design interview for experienced levels, and one behavioral interview about how you work. Meta's own guides stress talking through your approach, writing working code within the time, and testing it. Product-facing engineers may get a product design interview instead of infrastructure design.",
    "corporate": "Marketing, sales, operations, analytics and product roles usually mix behavioral questions tied to Meta's values with role exercises: a case or analysis for analytics and ops, a product-sense or execution discussion for product roles, and a presentation for some sales and partnerships roles."
   },
   "questions": [
    {
     "q": "Tell me about the project you had the most impact on. How did you measure it?",
     "why": "Focus on long-term impact. Meta's behavioral interview looks for measurable results and your specific part in them. Lead with the outcome, then how you got there.",
     "audience": "all",
     "principle": "Focus on long-term impact"
    },
    {
     "q": "Tell me about a time you moved fast and it caused a problem. What did you do?",
     "why": "Move fast is a value, but they want to see judgment. Show how you fixed it and what you changed so speed did not break things again.",
     "audience": "all",
     "principle": "Move fast"
    },
    {
     "q": "Tell me about a time you gave hard feedback to a peer or a manager.",
     "why": "Be direct and respect your colleagues. Describe how you said it, how it was received and what changed after.",
     "audience": "all",
     "principle": "Be direct and respect your colleagues"
    },
    {
     "q": "Tell me about a time you had conflicting priorities and how you decided what to drop.",
     "why": "Behavioral rounds probe prioritization under pressure. Explain the tradeoff and who you told.",
     "audience": "all"
    },
    {
     "q": "Solve this coding problem, then tell me its time and space complexity.",
     "why": "Meta coding rounds usually fit two problems into 45 minutes with no compiler. Get a working solution quickly, state complexity, then optimize if time allows. Test by walking through an example by hand.",
     "audience": "tech"
    },
    {
     "q": "Design a news feed or a messaging system for a very large number of users.",
     "why": "System design for senior engineers. Clarify scale and requirements, outline the data flow, then dive into one hard part such as fan-out, ranking or storage. Name tradeoffs explicitly.",
     "audience": "tech"
    },
    {
     "q": "How would you decide whether a new feature is working after launch?",
     "why": "Common for product, analytics and marketing roles. Name the goal, the metric that shows it, the guardrail metrics, and what result would make you roll back.",
     "audience": "corporate"
    },
    {
     "q": "Tell me about a time you went deep into something to find the real cause instead of the obvious one.",
     "why": "Build awesome things and live in the future both reward rigor. Show how you dug past the first explanation.",
     "audience": "all",
     "principle": "Build awesome things"
    }
   ],
   "tips": [
    "Read Meta's own interview prep pages for your role; they describe the rounds and what is scored.",
    "Practice coding in a plain text editor against a clock; two problems in 45 minutes is the usual pace.",
    "Put a number on every behavioral story (users, revenue, time saved, errors reduced).",
    "Say what you would do next, not just what you did; impact and follow-through are graded.",
    "Be direct about what you do not know; bluffing is easy to spot on a rubric."
   ],
   "ask_them": [
    "How does the team measure impact, and how often do priorities change?",
    "What does the team's planning cycle look like, and how much is set from above?"
   ],
   "watch": "Team matching often happens after you pass the loop, so there can be a quiet gap between a strong loop and a concrete team or offer."
  },
  {
   "names": [
    "Netflix",
    "Netflix Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Netflix culture memo",
    "note": "Netflix publishes a culture document built on freedom and responsibility, candor, 'context, not control', and the idea of a dream team. Many applicants report that interviewers test whether you have read it and can show, with examples, how you have worked that way."
   },
   "format": {
    "default": "Usually a recruiter call about your background and what the team needs, then a hiring-manager conversation, then a loop with several team members and often people from partner teams, sometimes split over two sessions. Netflix hires mostly experienced people, so the recruiter screen is often about whether your experience matches a specific opening rather than a general level. Many applicants report that comp is discussed openly and early because Netflix talks about paying at the top of market for the role. Timelines are often faster than at other large companies.",
    "tech": "Engineering interviews are usually practical: discussing your past systems in depth, design conversations about the kind of problems the team actually has, and coding that is closer to real work than to puzzles. Expect many questions about judgment and ownership rather than textbook algorithms, and expect several interviewers to probe the same project from different angles.",
    "corporate": "Marketing, content, finance and operations roles usually involve a series of one-on-one conversations with the team and cross-functional partners, heavy on candor, judgment and how you make decisions with context rather than approval."
   },
   "questions": [
    {
     "q": "Tell me about a decision you made on your own that your manager might not have made the same way.",
     "why": "Freedom and responsibility. They want people who act with context rather than wait for approval. Explain the context you had, what you decided, and how you kept others informed.",
     "audience": "all",
     "principle": "Freedom and responsibility"
    },
    {
     "q": "Tell me about a time you gave someone candid feedback that was hard to hear.",
     "why": "Candor is central to the culture memo. Describe how you delivered it directly and kindly and what happened next.",
     "audience": "all",
     "principle": "Candor"
    },
    {
     "q": "Tell me about a time you received feedback that stung. What did you do with it?",
     "why": "Candor goes both ways. Show you took it seriously and changed something concrete.",
     "audience": "all",
     "principle": "Candor"
    },
    {
     "q": "Describe a time you chose not to do something everyone expected you to do because it was not the best use of time.",
     "why": "The memo favors judgment over process. Show how you weighed impact and what you did instead.",
     "audience": "all",
     "principle": "Context, not control"
    },
    {
     "q": "Walk me through a system you built or ran. What broke, and what did you change?",
     "why": "Engineering rounds go deep on real systems. Be honest about failures and show ownership of fixing the cause.",
     "audience": "tech"
    },
    {
     "q": "What would you do in your first few months in this role if nobody told you what to work on?",
     "why": "Netflix expects people to find and own the important work. Give a concrete plan: who you would talk to, what you would learn, what you would ship.",
     "audience": "all",
     "principle": "Freedom and responsibility"
    }
   ],
   "tips": [
    "Read the culture memo before any call; interviewers often ask about it directly.",
    "Be unusually direct about your own mistakes; the culture rewards candor and penalizes spin.",
    "Expect interviewers to compare notes, so keep stories consistent across the day.",
    "Show judgment, not just effort: why you chose what you chose matters more than how hard you worked.",
    "Netflix describes itself as a team, not a family; frame examples around performance and results."
   ],
   "ask_them": [
    "How does the team practice candor day to day, and how is feedback given?",
    "How much context versus direction does this role get from leadership?"
   ],
   "watch": "The culture memo describes a 'keeper test' for current employees; many applicants report interviewers asking about how you have handled high expectations, so have a real example ready."
  },
  {
   "names": [
    "Stripe",
    "Stripe Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Stripe operating principles",
    "note": "Stripe publishes operating principles such as putting users first and moving with urgency and focus, and it is known for a writing-heavy culture. Behavioral answers that show care for the end user and for craft tend to land."
   },
   "format": {
    "default": "Usually a recruiter screen covering your background, the roles that fit and timeline, then a technical or hiring-manager screen, then a loop of several interviews. Stripe describes its engineering loop publicly and tells candidates in advance what each interview checks. Many applicants report that you may use your own laptop and editor for coding rounds. Comp and level are usually discussed by the recruiter after the loop. Expect a few weeks.",
    "tech": "Stripe's publicly described engineering loop usually includes: a coding interview with a practical, multi-step problem rather than a puzzle; an integration interview where you build against an API or a described system; a system design interview; a 'bug squash' where you find and fix a bug in an unfamiliar real codebase; and a conversation with a hiring manager about how you work. Exact rounds vary by level and role, so expect your recruiter to confirm which ones apply.",
    "corporate": "Sales, marketing, operations, finance and support roles usually mix behavioral questions tied to the operating principles with role exercises; many applicants report written take-home exercises or a presentation given how much Stripe values writing."
   },
   "questions": [
    {
     "q": "Tell me about a time you noticed something was hurting users and fixed it without being asked.",
     "why": "Users first. Show how you spotted it, what you did and how you knew it helped.",
     "audience": "all",
     "principle": "Users first"
    },
    {
     "q": "Tell me about a time you had to move quickly on something important. How did you decide what to leave out?",
     "why": "Move with urgency and focus. Show the tradeoff you made consciously and what you came back to later.",
     "audience": "all",
     "principle": "Move with urgency and focus"
    },
    {
     "q": "Here is a codebase you have never seen with a failing test. Find the bug and fix it.",
     "why": "The bug squash round. Read before you type: run the tests, follow the error, narrow the cause, then make a minimal fix. Talking through your process matters as much as finishing.",
     "audience": "tech"
    },
    {
     "q": "Build a small program that talks to this API and handles the failure cases.",
     "why": "Integration interview. Read the docs quickly, get a working happy path first, then handle errors, retries and bad input. Keep the code readable.",
     "audience": "tech"
    },
    {
     "q": "Design a system that processes payments reliably even when parts of it fail.",
     "why": "System design with Stripe's flavor: correctness and idempotency matter. Talk about retries, duplicates, and what happens when a step fails halfway.",
     "audience": "tech"
    },
    {
     "q": "Tell me about something you wrote that changed a decision.",
     "why": "Stripe runs on written communication. A memo, doc or long email counts. Explain how you structured it for the reader.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you got a detail wrong that mattered, and what you changed afterward.",
     "why": "Care for craft and honesty about mistakes. Show the fix and the habit you built from it.",
     "audience": "all"
    }
   ],
   "tips": [
    "Practice reading unfamiliar code and running its tests; the bug squash rewards calm, methodical debugging.",
    "Set up your own laptop and editor ahead of time if the recruiter says you can use them.",
    "Write clean, readable code with sensible names; interviewers often read your code later.",
    "Prepare a story about a document you wrote; writing is part of how Stripe works.",
    "Ask clarifying questions in the integration round; the API descriptions are meant to be read carefully."
   ],
   "ask_them": [
    "How does the team write things down, and how do decisions get made?",
    "What does this team own, and who are its users inside or outside Stripe?"
   ],
   "watch": "Applicants commonly report that the bug squash and integration rounds feel different from standard algorithm interviews; practice real debugging, not only puzzles."
  },
  {
   "names": [
    "Databricks",
    "Databricks Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, the roles that fit and your timeline, then a technical phone screen, then a loop of several interviews over one or two days. Comp and level are usually discussed with the recruiter after the loop. Many applicants report the process taking a few weeks.",
    "tech": "Software loops usually include coding interviews that many applicants describe as harder than average, with a focus on algorithms, data structures and sometimes concurrency or data processing; a system design or architecture interview for experienced levels; and a hiring-manager or behavioral conversation. Some teams add a practical or domain interview tied to data infrastructure. Expect follow-up questions that push a working solution toward production quality.",
    "corporate": "Sales, customer-facing and operations roles usually mix behavioral questions with role exercises; many applicants for sales and solutions roles report a presentation or mock customer discussion."
   },
   "questions": [
    {
     "q": "Solve this problem, then make it work efficiently on a very large input.",
     "why": "Databricks coding rounds often start with a reasonable problem and push toward scale. State complexity and memory, and say what changes when data does not fit in memory.",
     "audience": "tech"
    },
    {
     "q": "Design a system that ingests large amounts of data and lets people query it quickly.",
     "why": "Architecture round in Databricks' domain. Cover storage format, partitioning, batch versus streaming, and failure handling. Keep tradeoffs explicit.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you owned a hard problem from start to finish.",
     "why": "Ownership comes up across teams. Walk through how you scoped it, what got in the way and how it ended.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you had to understand a customer's problem deeply before proposing a solution.",
     "why": "Customer focus is a repeated theme in Databricks' hiring. Show how you listened, what you learned and how it changed your plan.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you were wrong and how you found out.",
     "why": "Interviewers often look for truth-seeking and humility. Be direct about the mistake and what you changed.",
     "audience": "all"
    },
    {
     "q": "Explain a technical concept you know well to someone who does not work in your field.",
     "why": "Common for customer-facing and solutions roles. Keep it plain and check understanding as you go.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Practice harder algorithm problems than you think you need; many applicants report tougher coding rounds here.",
    "Know the basics of distributed data processing if you are interviewing for engineering roles near the core product.",
    "Bring examples where you dug for the real cause rather than accepting the first explanation.",
    "For design rounds, be ready to talk about data at scale: partitioning, formats and what breaks first.",
    "Keep your answers precise; interviewers tend to probe vague claims."
   ],
   "ask_them": [
    "What does the team own, and how does it connect to the core platform?",
    "How does the team balance customer requests against longer-term work?"
   ]
  },
  {
   "names": [
    "Salesforce",
    "Salesforce.com",
    "Salesforce Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Salesforce core values (trust, customer success, innovation, equality, sustainability)",
    "note": "Salesforce publishes five core values and talks about its 'Ohana' culture and V2MOM goal-setting. Interviewers often ask for examples that show trust and customer success specifically, so have one story for each."
   },
   "format": {
    "default": "Usually a recruiter screen covering your background, level and years of experience, timeline and sometimes pay expectations, then a hiring-manager interview, then a set of interviews with the team and partner functions, often as a panel or a series of video calls. Many applicants report a values or culture conversation as part of the loop. Expect several weeks.",
    "tech": "Software and data roles usually include coding interviews (data structures, algorithms, and often practical object-oriented design), a system design discussion for experienced levels, and behavioral rounds tied to the core values. Knowledge of the Salesforce platform is usually not expected for general engineering roles unless the posting says so.",
    "corporate": "Sales (account executive, business development) roles commonly include a presentation or mock discovery call in a later round; many applicants report being asked to present a territory plan or a short pitch to a panel. Marketing, finance, operations and customer success roles mix behavioral questions on the core values with role scenarios."
   },
   "questions": [
    {
     "q": "Tell me about a time you kept a promise to a customer or colleague when it was costly to do so.",
     "why": "Trust is Salesforce's first value. Show the cost, why you held the line and what it earned you.",
     "audience": "all",
     "principle": "Trust"
    },
    {
     "q": "Tell me about a time you helped a customer succeed with something beyond what they asked for.",
     "why": "Customer success. Explain how you understood their goal and what you did that moved it.",
     "audience": "all",
     "principle": "Customer success"
    },
    {
     "q": "Tell me about a time you changed how something was done on your team.",
     "why": "Innovation at Salesforce is often small and practical. Describe the before, the change and the measurable after.",
     "audience": "all",
     "principle": "Innovation"
    },
    {
     "q": "Tell me about a time you made sure everyone on a team had a voice in a decision.",
     "why": "Equality. Pick a real example of including people and what it changed about the outcome.",
     "audience": "all",
     "principle": "Equality"
    },
    {
     "q": "Walk me through how you would run a first call with a prospect who has never heard of us.",
     "why": "Common for account executive roles, sometimes as a live mock. Ask discovery questions before pitching, and tie features to the prospect's goals.",
     "audience": "corporate"
    },
    {
     "q": "Design the data model and services for an application many different companies will use at once.",
     "why": "Multi-tenant design is close to Salesforce's core. Talk about isolation, customization and scaling, and name tradeoffs.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and explain how you would structure it as reusable code.",
     "why": "Salesforce coding rounds often value clean object-oriented structure alongside correctness.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Have one story per core value; interviewers often map questions to them directly.",
    "For sales roles, practice a short discovery-led pitch out loud; a presentation round is common.",
    "Know what the product you would sell or build actually does for customers.",
    "Mention how you measure your own goals; the company's V2MOM habit shows up in conversations.",
    "Expect several interviewers to ask similar behavioral questions; vary your examples."
   ],
   "ask_them": [
    "How does this team's work show up in a customer's day?",
    "How does the team set and track its goals through the year?"
   ],
   "watch": "Sales applicants commonly report a presentation or mock call round announced on short notice; ask the recruiter early whether one is part of your process."
  },
  {
   "names": [
    "Oracle",
    "Oracle Corporation",
    "Oracle Cloud",
    "OCI"
   ],
   "confidence": "medium",
   "format": {
    "default": "Oracle's process varies a lot by organization: cloud infrastructure, applications, sales and consulting each run differently. Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager call, then several technical or panel interviews. Comp is usually discussed with the recruiter after the interviews. Early-career hiring often runs through structured programs with online assessments and group interview days.",
    "tech": "Cloud infrastructure engineering roles usually look like other cloud companies: coding interviews on data structures and algorithms, a system design interview for experienced levels, and behavioral questions about ownership and working under pressure. Applications and database-adjacent roles often add questions on SQL, databases and the specific product area.",
    "corporate": "Sales, consulting and operations roles usually mix behavioral interviews with role scenarios; sales applicants often report a presentation or pitch round."
   },
   "questions": [
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round in cloud engineering. Clarify, solve, state complexity, then test an edge case.",
     "audience": "tech"
    },
    {
     "q": "Design a highly available service across multiple regions.",
     "why": "Common in cloud infrastructure rounds. Cover replication, failover, consistency tradeoffs and how you would detect problems.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you were on call or responsible for something that broke in production.",
     "why": "Infrastructure teams care about operational ownership. Describe how you found the cause, communicated and prevented a repeat.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you had to learn a large, unfamiliar system quickly.",
     "why": "Oracle's products are big and old; interviewers want to know you can get oriented. Explain your approach, not just that you did it.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you handled a demanding customer or stakeholder.",
     "why": "Common across sales, consulting and support roles. Show how you understood their real need and set expectations.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Ask the recruiter which organization you are interviewing with; the process differs widely between them.",
    "Brush up on SQL and database fundamentals for anything near the database or applications products.",
    "For cloud roles, prepare like you would for other cloud infrastructure companies: coding plus design plus operations stories.",
    "Early-career applicants should expect online assessments before any live interview."
   ],
   "ask_them": [
    "Which organization and product does this team belong to, and how is it staffed?"
   ],
   "watch": "Because groups run their own processes, applicants commonly report inconsistent timelines; follow up with the recruiter if you hear nothing for a couple of weeks."
  },
  {
   "names": [
    "IBM",
    "International Business Machines",
    "Red Hat",
    "IBM Consulting"
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually an application review, then for many roles an online assessment or a recorded video interview before you speak to a person, then a recruiter screen about your background, years of experience and timeline, then interviews with the hiring manager and team. Comp is usually discussed with the recruiter later in the process. Early-career programs often run a coding challenge and a video interview up front and can take weeks before a live conversation.",
    "tech": "Software roles usually include an online coding assessment early, then technical interviews on data structures, algorithms and the team's stack, and a design or architecture discussion for experienced roles. Red Hat teams often interview more like an open-source community: practical conversations about your code and how you collaborate in the open.",
    "corporate": "Consulting, sales, finance and operations roles mix behavioral and situational questions with role exercises; consulting applicants often report a case-style discussion or a group exercise in early-career programs."
   },
   "questions": [
    {
     "q": "Tell me about a time you worked with a client or stakeholder whose needs kept changing.",
     "why": "IBM sells to large clients, so adaptability with customers comes up often. Show how you kept scope and trust at the same time.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you learned a new technology to get a job done.",
     "why": "IBM talks a lot about continuous learning. Say how you learned, how fast, and what you shipped with it.",
     "audience": "all"
    },
    {
     "q": "Solve this coding problem and explain your approach.",
     "why": "Coding assessments and interviews are standard for software roles. Clear explanation counts as much as the answer.",
     "audience": "tech"
    },
    {
     "q": "How would you design a system that has to run reliably for a large enterprise customer?",
     "why": "Enterprise reliability, security and support matter here. Mention monitoring, access control and how you would hand it to operations.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you worked on a team spread across locations or time zones.",
     "why": "IBM teams are global. Explain how you communicated and kept work moving.",
     "audience": "all"
    },
    {
     "q": "How would you explain a complex solution to a client executive in two minutes?",
     "why": "Consulting and sales rounds test plain communication. Lead with their problem and the outcome, not the technology.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Expect automated steps first: do the coding challenge or recorded video interview promptly, since the live interview often cannot be scheduled until they are done.",
    "Practice answering to a camera with no one on the other end; recorded video interviews feel different from a call.",
    "Bring stories about clients and collaboration; IBM's work is mostly for and with large customers.",
    "For Red Hat roles, be ready to talk about open-source contributions or how you work in the open."
   ],
   "ask_them": [
    "What client or product does this team serve, and how is the work structured?"
   ],
   "watch": "Applicants commonly trip on the recorded video interview or timed coding challenge; find a quiet place and a deadline-safe time before you start them."
  },
  {
   "names": [
    "Intel",
    "Intel Corporation"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Intel values (customer first, fearless innovation, results driven, One Intel, inclusion, quality, integrity)",
    "note": "Intel publishes its values and interviewers often ask for examples that show results and quality. One story each for results driven and quality covers most behavioral questions."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager call, then a technical interview or a panel with several engineers, sometimes in one long session. Comp is typically discussed with the recruiter after the interviews. Many applicants report that the technical rounds are deep on fundamentals in the specific domain of the team.",
    "tech": "Hardware, firmware and software engineering interviews usually focus on fundamentals: computer architecture, digital logic, operating systems, C/C++ and memory, or the team's specific area, plus questions about your past projects in detail. Expect to work problems on a whiteboard or shared screen and to explain your reasoning. Software roles also get coding and some design questions.",
    "corporate": "Finance, supply chain, marketing and operations roles usually mix behavioral questions tied to Intel's values with role-specific scenario questions."
   },
   "questions": [
    {
     "q": "Walk me through a project from your résumé and the hardest technical problem in it.",
     "why": "Intel interviewers often spend much of the time on your own work. Be ready to explain the fundamentals behind your choices.",
     "audience": "tech"
    },
    {
     "q": "Explain what happens in a processor from the moment an instruction is fetched.",
     "why": "Fundamentals questions are common for hardware and systems roles. Go step by step and say where things can stall.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you found a defect late and what you did about it.",
     "why": "Quality is one of Intel's values. Show how you contained it, found the cause and changed the process.",
     "audience": "all",
     "principle": "Quality"
    },
    {
     "q": "Tell me about a time you delivered a result under a tight schedule.",
     "why": "Results driven. Describe what you prioritized and what you communicated when something had to give.",
     "audience": "all",
     "principle": "Results driven"
    },
    {
     "q": "Tell me about a time you worked with another group whose goals were different from yours.",
     "why": "One Intel. Explain how you found a shared goal and kept both sides committed.",
     "audience": "all",
     "principle": "One Intel"
    },
    {
     "q": "Tell me about a time you raised a concern that was not popular.",
     "why": "Integrity. Show how you raised it with evidence and what happened.",
     "audience": "all",
     "principle": "Integrity"
    }
   ],
   "tips": [
    "Review fundamentals for your specific domain; interviewers go deep on basics rather than on puzzles.",
    "Know your own projects well enough to draw them and defend the tradeoffs.",
    "Prepare examples around quality and schedule; hardware timelines make both themes common.",
    "Ask what the team's product cycle looks like; it shapes what the role actually does."
   ],
   "ask_them": [
    "Where in the product cycle is the team now, and what does that mean for this role in the first months?"
   ]
  },
  {
   "names": [
    "Nvidia",
    "NVIDIA",
    "NVIDIA Corporation"
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager call, then a series of technical interviews with team members, often several one-on-one calls scheduled over days or weeks rather than one onsite day. Many applicants report meeting a large number of engineers. Comp is usually discussed with the recruiter after the interviews.",
    "tech": "Technical rounds go deep on the team's domain: C/C++ and memory, GPU and parallel computing concepts, computer architecture, operating systems, or machine learning fundamentals depending on the role, plus coding problems and detailed discussion of your past projects. Interviewers often ask follow-ups until they find the edge of what you know. Expect to be asked why, not just what.",
    "corporate": "Non-engineering roles usually involve several conversations with the team and partner functions, with behavioral and scenario questions focused on judgment, pace and working with technical teams."
   },
   "questions": [
    {
     "q": "Walk me through a project you are proud of, then explain the lowest-level details of how it worked.",
     "why": "Nvidia interviewers often dig until they reach fundamentals. Be ready to go from the big picture down to memory, performance and failure modes.",
     "audience": "tech"
    },
    {
     "q": "How would you make this piece of code run faster?",
     "why": "Performance thinking is core here. Talk about measuring first, memory access patterns, parallelism and what you would try in order.",
     "audience": "tech"
    },
    {
     "q": "Explain the difference between how a CPU and a GPU handle work, and when you would use each.",
     "why": "Common fundamentals question for roles near the hardware or ML. Keep it concrete with an example.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you had to say you did not know something and what you did next.",
     "why": "Many applicants report interviewers valuing honesty about the limits of your knowledge over bluffing.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you worked on something with a very tight deadline where quality still mattered.",
     "why": "Hardware and driver schedules are fixed. Show how you kept rigor while moving fast.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you worked with a team that depended on your work to ship theirs.",
     "why": "Many Nvidia teams sit in a chain between hardware and products. Show how you communicated and unblocked others.",
     "audience": "all"
    }
   ],
   "tips": [
    "Expect many interviews with many people over an extended period; keep your energy and stories consistent.",
    "Review C/C++, memory and parallelism fundamentals for any engineering role near the hardware.",
    "Say 'I do not know, but here is how I would find out' rather than guessing.",
    "Know the team's product area and what it ships to whom.",
    "Prepare to whiteboard or share a screen and work through problems live."
   ],
   "ask_them": [
    "What does this team ship, and who depends on it inside the company?",
    "How many people will I meet, and roughly over what time span?"
   ],
   "watch": "The number of interviews and the time between them can stretch out; applicants commonly report long processes with many technical one-on-ones."
  },
  {
   "names": [
    "Cisco",
    "Cisco Systems",
    "Cisco Meraki",
    "Webex"
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager interview, then technical or panel interviews with the team, often by video. Comp is usually discussed with the recruiter after the interviews. Processes differ between business units, so ask which one you are interviewing with.",
    "tech": "Software roles usually include coding (data structures, algorithms, often C/C++, Python or Java), questions on networking and systems fundamentals when the role is near networking products, and a design discussion for experienced levels. Network and support engineering roles focus on networking fundamentals (routing, switching, TCP/IP) and troubleshooting scenarios. Early-career programs often add an online assessment.",
    "corporate": "Sales, marketing, finance and operations roles usually mix behavioral interviews with role scenarios; sales applicants often report a presentation or mock customer round."
   },
   "questions": [
    {
     "q": "Walk me through what happens when a packet leaves one computer and reaches a server on another network.",
     "why": "Networking fundamentals are common for roles near Cisco's core products. Go layer by layer and say where things can go wrong.",
     "audience": "tech"
    },
    {
     "q": "A customer says the network is slow. How do you troubleshoot it?",
     "why": "Troubleshooting scenarios are standard for network and support roles. Show a method: gather facts, isolate, test one change at a time.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and discuss how you would make it production ready.",
     "why": "Software rounds often follow a working solution with questions on error handling, testing and performance.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you worked with a customer or partner to solve a problem together.",
     "why": "Cisco sells and supports through partners and large customers. Show how you listened and kept them informed.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you had to coordinate with teams in other locations to deliver something.",
     "why": "Cisco teams are distributed. Explain how you handled time zones, handoffs and communication.",
     "audience": "all"
    }
   ],
   "tips": [
    "Review networking basics even for software roles if the team's product touches the network.",
    "Ask which business unit you are interviewing with; acquired brands often keep their own style.",
    "Bring customer and partner stories; they fit most Cisco roles.",
    "Be ready for a practical troubleshooting walk-through, not only knowledge questions."
   ],
   "ask_them": [
    "Which business unit is this team in, and who are its customers?"
   ]
  },
  {
   "names": [
    "Adobe",
    "Adobe Inc.",
    "Adobe Systems"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Adobe core values (genuine, exceptional, innovative, involved)",
    "note": "Adobe publishes four core values and interviewers often look for examples of craft and creative problem solving. One story about raising quality and one about a new idea you carried through cover most behavioral questions."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager call, then a loop of several interviews with the team and partner functions, often by video. Comp is usually discussed with the recruiter after the loop. Expect several weeks.",
    "tech": "Software interviews usually include coding on data structures and algorithms, sometimes with puzzle-style or math-flavored questions, a system design discussion for experienced levels, and behavioral questions about collaboration and quality. Teams near creative tools may ask about graphics, performance or document formats.",
    "corporate": "Marketing, design, sales and operations roles mix behavioral questions tied to the core values with role exercises; design and marketing applicants often report a portfolio or work-sample review."
   },
   "questions": [
    {
     "q": "Tell me about a time you raised the quality of something beyond what was asked.",
     "why": "Exceptional is one of Adobe's values. Describe the standard you set and what it changed for users.",
     "audience": "all",
     "principle": "Exceptional"
    },
    {
     "q": "Tell me about a new idea you had and how you got it adopted.",
     "why": "Innovative. Show the problem, the idea and the work of convincing others.",
     "audience": "all",
     "principle": "Innovative"
    },
    {
     "q": "Tell me about a time you were honest about a problem when it would have been easier to stay quiet.",
     "why": "Genuine. Show how you raised it and how the team responded.",
     "audience": "all",
     "principle": "Genuine"
    },
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round; some Adobe interviewers add puzzle-style questions, so practice reasoning aloud under uncertainty.",
     "audience": "tech"
    },
    {
     "q": "Design a system that lets many users edit the same document at once.",
     "why": "Collaboration and document systems are close to Adobe's products. Talk about conflicts, latency and consistency.",
     "audience": "tech"
    },
    {
     "q": "Walk me through a piece of work in your portfolio and the decisions behind it.",
     "why": "Design and marketing rounds often review work samples. Explain the goal, constraints and the result, not just the final piece.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Practice a few puzzle-style and probability questions alongside standard coding problems.",
    "Have examples that show craft and quality; the company talks about them often.",
    "For design and marketing roles, prepare to present work and the reasoning behind it.",
    "Know which Adobe product area the team belongs to and who its users are."
   ],
   "ask_them": [
    "Who uses what this team builds, and how does the team hear from them?"
   ]
  },
  {
   "names": [
    "Uber",
    "Uber Technologies",
    "Uber Eats",
    "Uber Freight"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Uber cultural norms",
    "note": "Uber publishes cultural norms that include customer obsession, acting like owners, doing the right thing, persevering and making bold bets. Many applicants report a dedicated interview that checks these norms, so prepare a story for each."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, level and years of experience, timeline and sometimes pay expectations, then a technical or role screen, then a loop of several interviews over one day. Many applicants report an interviewer from outside the team whose job is to check the hiring bar and culture, in addition to the team's own rounds. Comp and level are usually discussed with the recruiter after the loop.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms in a shared editor, a system design interview for experienced levels (often about real-time or location-based systems), and a behavioral interview tied to the cultural norms. Some teams add a practical coding or debugging session.",
    "corporate": "Operations, marketing, finance and analytics roles usually include a case or analytics exercise alongside behavioral questions; many operations applicants report a take-home analysis with a presentation."
   },
   "questions": [
    {
     "q": "Tell me about a time you took ownership of a problem that was not clearly yours.",
     "why": "Act like an owner. Show how you noticed it, what you did and what changed for customers.",
     "audience": "all",
     "principle": "We act like owners"
    },
    {
     "q": "Tell me about a time you did the right thing even though it was slower or harder.",
     "why": "Do the right thing. Be specific about the pressure and the choice you made.",
     "audience": "all",
     "principle": "We do the right thing"
    },
    {
     "q": "Tell me about a time something kept failing and you stuck with it.",
     "why": "Persevere. Explain what you tried, what finally worked and what you learned.",
     "audience": "all",
     "principle": "We persevere"
    },
    {
     "q": "Design a system that matches riders to nearby drivers in real time.",
     "why": "System design in Uber's domain. Cover location updates, matching, latency and what happens when a component fails.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and state its complexity.",
     "why": "Standard coding round in a shared editor. Clarify inputs, write clean code, test with an example.",
     "audience": "tech"
    },
    {
     "q": "Here is a dataset about a city's trips. What would you look at to improve the business?",
     "why": "Operations and analytics rounds often use case-style data questions. Structure it: define the goal, pick metrics, propose actions and how you would test them.",
     "audience": "corporate"
    },
    {
     "q": "Tell me about a bold decision you made with incomplete data.",
     "why": "Make big bold bets. Show how you sized the risk and what you did if it went wrong.",
     "audience": "all",
     "principle": "We make big bold bets"
    }
   ],
   "tips": [
    "Prepare a story per cultural norm; the behavioral round often maps questions to them.",
    "Practice system design around real-time, location and marketplace problems.",
    "Operations applicants should be ready for a data case or a take-home with a presentation.",
    "Know which product line you are interviewing for; rides, delivery and freight have different problems.",
    "Expect an interviewer from outside the team and treat that round as seriously as the technical ones."
   ],
   "ask_them": [
    "What does this team own in the product, and how does it measure success?",
    "How does the team work with city or market operations teams?"
   ]
  },
  {
   "names": [
    "DoorDash",
    "DoorDash Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "DoorDash values",
    "note": "DoorDash publishes a set of values that include being customer obsessed, operating at the lowest level of detail, bias for action, being an owner and getting better every day. Behavioral interviewers often listen for detail and ownership."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or role screen, then a loop of several interviews over one or two days. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms, a system design interview for experienced levels (often about logistics, marketplaces or real-time systems), and a behavioral interview tied to the values. Some teams add a practical coding or debugging round.",
    "corporate": "Operations, strategy and analytics roles usually include a case or analytics exercise, sometimes a take-home with a presentation, alongside behavioral questions on the values."
   },
   "questions": [
    {
     "q": "Tell me about a time you dug into the details of a problem and found something others had missed.",
     "why": "Operate at the lowest level of detail. Show the digging and what the detail changed.",
     "audience": "all",
     "principle": "Operate at the lowest level of detail"
    },
    {
     "q": "Tell me about a time you acted before you had full certainty. How did it go?",
     "why": "Bias for action. Explain how you limited the risk and what you learned.",
     "audience": "all",
     "principle": "Bias for action"
    },
    {
     "q": "Tell me about a time you owned an outcome end to end.",
     "why": "Be an owner. Walk through scoping, obstacles and the result.",
     "audience": "all",
     "principle": "Be an owner"
    },
    {
     "q": "Design a system that assigns delivery orders to drivers and estimates arrival times.",
     "why": "System design in DoorDash's domain. Discuss real-time updates, matching, estimates under uncertainty and failure handling.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round. Clarify, solve, state complexity, test an edge case.",
     "audience": "tech"
    },
    {
     "q": "A market's delivery times got worse this month. How would you figure out why and fix it?",
     "why": "Operations and analytics case question. Break it into supply, demand and process, pick metrics, propose actions.",
     "audience": "corporate"
    },
    {
     "q": "Tell me about something you got a little better at over time and how you did it.",
     "why": "Getting better every day. Keep it concrete and show the habit behind it.",
     "audience": "all",
     "principle": "Get 1% better every day"
    }
   ],
   "tips": [
    "Prepare a story per value; behavioral rounds often map to them.",
    "Practice design problems about logistics and marketplaces with three sides (customers, merchants, drivers).",
    "Operations applicants should expect a data case and possibly a take-home with a presentation.",
    "Show detail: interviewers often prefer a specific small example to a sweeping one."
   ],
   "ask_them": [
    "Which side of the marketplace does this team serve, and how does it measure success?"
   ]
  },
  {
   "names": [
    "Airbnb",
    "Airbnb Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Airbnb core values + core values interviews",
    "note": "Airbnb publishes core values (such as champion the mission, be a host, embrace the adventure, be a cereal entrepreneur) and is well known for dedicated core values interviews, often run by employees from other teams. Prepare real stories that show hospitality, resourcefulness and care for the mission."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or role screen, then a loop that combines role interviews with one or two core values interviews run by people outside the hiring team. Many applicants report that the values interviews carry real weight in the decision. Comp and level are usually discussed with the recruiter after the loop.",
    "tech": "Software loops usually include coding interviews that are practical rather than puzzle-like (you are often expected to write and run working code in a real environment), a system design interview for experienced levels, a conversation with the hiring manager or about past projects, and the core values interviews. Interviewers often care about code that runs and is readable.",
    "corporate": "Marketing, operations, finance and community roles mix role-specific exercises (cases, presentations or work samples) with behavioral rounds and the same core values interviews."
   },
   "questions": [
    {
     "q": "Tell me about a time you made someone feel welcome or taken care of when it was not your job.",
     "why": "Be a host is a core value. Pick a real, small example and explain why it mattered to that person.",
     "audience": "all",
     "principle": "Be a host"
    },
    {
     "q": "Tell me about a time you built something with very few resources.",
     "why": "Be a cereal entrepreneur refers to resourcefulness. Show what you lacked, what you improvised and the result.",
     "audience": "all",
     "principle": "Be a cereal entrepreneur"
    },
    {
     "q": "Tell me about a time you took a risk or stepped into the unknown at work.",
     "why": "Embrace the adventure. Explain the uncertainty, your choice and what you learned.",
     "audience": "all",
     "principle": "Embrace the adventure"
    },
    {
     "q": "Why does Airbnb's mission matter to you?",
     "why": "Champion the mission. Be honest and specific; a story about travel, hosting or belonging beats a slogan.",
     "audience": "all",
     "principle": "Champion the mission"
    },
    {
     "q": "Write a working program that solves this problem, then run it.",
     "why": "Airbnb coding rounds often expect running code in a real environment. Get a clean, working version first, then improve. Readability counts.",
     "audience": "tech"
    },
    {
     "q": "Design a system that lets guests search for places to stay by location and dates.",
     "why": "System design in Airbnb's domain. Cover search, availability, ranking and consistency when two people book at once.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Take the core values interviews as seriously as the technical ones; they are known to decide outcomes.",
    "Practice writing code that compiles and runs, not only pseudocode on a whiteboard.",
    "Have a real connection to the mission ready; interviewers can tell when it is made up.",
    "Bring stories about hospitality and resourcefulness from any part of your life, not just work."
   ],
   "ask_them": [
    "How do the core values show up in how this team works day to day?"
   ],
   "watch": "Applicants commonly underprepare for the core values interviews because they look like a chat; they are scored like every other round."
  },
  {
   "names": [
    "Shopify",
    "Shopify Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "The Life Story interview",
    "note": "Shopify is known for starting with a 'Life Story' conversation: a long, open discussion of your whole path, not just your résumé, with someone from the talent team. Be ready to talk honestly about choices, turning points and what you learned."
   },
   "format": {
    "default": "Usually a Life Story interview with the talent team first, then one or more role interviews with the hiring team, then a final conversation. Shopify is a remote-first company, so expect every step by video. Comp is usually discussed by the recruiter later in the process. Many applicants report the Life Story running an hour or more.",
    "tech": "Engineering rounds usually include a technical deep dive on your past work and a hands-on round, often pair programming or working through a practical problem together rather than a whiteboard puzzle. Interviewers tend to care about how you think, how you collaborate and how you handle feedback in the moment.",
    "corporate": "Marketing, support, sales and operations roles follow the same Life Story opening, then role conversations and sometimes a work sample or presentation."
   },
   "questions": [
    {
     "q": "Tell me your story, from the beginning. What choices shaped where you are now?",
     "why": "The Life Story interview. It is long and open on purpose. Be honest about turns and dead ends; the interviewer is listening for self-awareness and how you make decisions.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you had to adapt quickly to a change you did not choose.",
     "why": "Shopify talks about thriving on change. Show how you adjusted and what you kept from the old plan.",
     "audience": "all"
    },
    {
     "q": "Let's work on this problem together. Talk me through what you are doing.",
     "why": "The pairing round. Think aloud, take suggestions, and ask questions; collaboration is part of what is graded.",
     "audience": "tech"
    },
    {
     "q": "Walk me through a system you built. What would you change if you built it again?",
     "why": "Technical deep dive. Be candid about weaknesses and show judgment about tradeoffs.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you worked with people you had never met in person to deliver something.",
     "why": "Shopify is remote by default. Show how you communicated, documented and built trust without an office.",
     "audience": "all"
    },
    {
     "q": "Tell me about something you did for a merchant or small business owner, or a user like one.",
     "why": "Shopify's customers are merchants. Show that you understand what a small business needs.",
     "audience": "all"
    }
   ],
   "tips": [
    "Prepare for the Life Story by thinking through your actual path, including the decisions you would not repeat.",
    "In technical rounds, collaborate; a pairing session is not a test you take alone.",
    "Show you can work asynchronously: write clearly, follow up without being chased.",
    "Learn something about how merchants use Shopify before you interview."
   ],
   "ask_them": [
    "How does the team work asynchronously, and what does a normal week look like?"
   ],
   "watch": "The Life Story interview surprises people who expect a short screen; set aside enough time and treat it as a real interview."
  },
  {
   "names": [
    "Snowflake",
    "Snowflake Inc.",
    "Snowflake Computing"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Snowflake values",
    "note": "Snowflake publishes values that include putting customers first, integrity always, thinking big, being excellent, getting it done and embracing differences. Behavioral answers that show customer focus and follow-through fit well."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or hiring-manager screen, then a loop of several interviews over one or two days. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms, a system design interview for experienced levels (often about databases, storage or distributed systems), and a hiring-manager or behavioral conversation. Teams near the core engine often ask about databases, SQL and query processing in depth.",
    "corporate": "Sales, sales engineering and customer success roles usually include a presentation or mock customer discussion in a later round; marketing, finance and operations roles mix behavioral questions with role scenarios."
   },
   "questions": [
    {
     "q": "Design a system that stores very large tables and answers analytical queries quickly.",
     "why": "System design in Snowflake's domain. Talk about separating storage from compute, columnar formats, caching and scaling queries.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and discuss how it behaves on large inputs.",
     "why": "Standard coding round with a scale follow-up. State complexity and memory use.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you put a customer's need ahead of your own plan.",
     "why": "Put customers first. Show the tradeoff and the result for the customer.",
     "audience": "all",
     "principle": "Put customers first"
    },
    {
     "q": "Tell me about a time you finished something hard that others had given up on.",
     "why": "Get it done. Explain what blocked others, what you did differently and the outcome.",
     "audience": "all",
     "principle": "Get it done"
    },
    {
     "q": "Tell me about a time you told a customer or stakeholder something they did not want to hear.",
     "why": "Integrity always. Show how you delivered it honestly and kept the relationship.",
     "audience": "all",
     "principle": "Integrity always"
    },
    {
     "q": "Explain how a database executes a query, in plain terms.",
     "why": "Common for roles near the core product and for sales engineering. Keep it clear and structured.",
     "audience": "all"
    }
   ],
   "tips": [
    "Review database and distributed systems fundamentals for engineering roles.",
    "Sales and sales engineering applicants should expect a presentation or demo round.",
    "Have one story per value; the behavioral round often maps to them.",
    "Be concrete about customer impact in every example."
   ],
   "ask_them": [
    "Which part of the platform does this team own, and how do customers feel its work?"
   ]
  },
  {
   "names": [
    "Datadog",
    "Datadog Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager call, then technical or role interviews, sometimes including a take-home exercise, then a final set of conversations with the team. Comp is usually discussed with the recruiter later in the process. Expect a few weeks.",
    "tech": "Engineering rounds usually include practical coding that resembles real work (building something small, parsing or processing data, working with a library) rather than pure algorithm puzzles, a system design discussion for experienced levels (often around collecting and processing large volumes of metrics or logs), and behavioral questions about collaboration and ownership. Some roles use a take-home project discussed in a later round.",
    "corporate": "Sales, sales engineering and customer success roles usually include a presentation or demo round; marketing, finance and operations roles mix behavioral questions with role scenarios."
   },
   "questions": [
    {
     "q": "Write a program that reads this stream of events and reports summary statistics.",
     "why": "Practical coding in Datadog's domain. Get a correct version first, keep it readable, then discuss scale and edge cases like out-of-order data.",
     "audience": "tech"
    },
    {
     "q": "Design a system that collects metrics from millions of hosts and lets users query them.",
     "why": "System design around observability. Talk about ingestion, aggregation, storage over time and query latency.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you debugged a hard production issue. How did you find the cause?",
     "why": "Datadog builds tools for exactly this. Show a method and what you changed afterward.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you worked closely with another team to ship something.",
     "why": "Collaboration across teams is a common theme. Explain how you handled dependencies and communication.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you owned a project from idea to delivery.",
     "why": "Ownership. Walk through scoping, blockers and the result.",
     "audience": "all"
    },
    {
     "q": "Walk me through how you would demo a monitoring product to an engineering team.",
     "why": "Common for sales engineering roles. Start with their pain, show one clear workflow, and invite questions.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Practice building small, working programs that process data; the coding rounds are practical.",
    "If you get a take-home, make it clean and tested; you will likely discuss it with the team later.",
    "Know the basics of metrics, logs and tracing if you are interviewing for engineering or sales engineering.",
    "Bring a real debugging story with a clear method."
   ],
   "ask_them": [
    "How does this team use Datadog's own product in its work?"
   ],
   "watch": "Some roles include a take-home exercise; ask the recruiter early so you can plan time for it."
  },
  {
   "names": [
    "Cloudflare",
    "Cloudflare Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager conversation, then a loop of several interviews with the team and partner functions by video. Many applicants report a dedicated conversation about Cloudflare's mission and values. Comp is usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Engineering loops usually include coding (practical problems, often in a language of your choice), a system design interview for experienced levels (frequently about networking, distributed systems or performance at the edge), and a conversation about how you work. Teams near the network ask about networking, security and systems fundamentals.",
    "corporate": "Sales, marketing, support and operations roles mix behavioral questions with role exercises; sales applicants often report a presentation or mock pitch."
   },
   "questions": [
    {
     "q": "Design a system that serves content to users around the world with low latency.",
     "why": "System design in Cloudflare's domain. Talk about caching, routing to the nearest location, invalidation and what happens when a region fails.",
     "audience": "tech"
    },
    {
     "q": "Explain what happens when you type a web address and press enter.",
     "why": "A classic fundamentals question that fits Cloudflare's products. Cover DNS, TLS, HTTP and where a proxy sits.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and talk about performance.",
     "why": "Coding rounds often weigh efficiency; state complexity and think about memory.",
     "audience": "tech"
    },
    {
     "q": "Why does Cloudflare's mission of helping build a better Internet matter to you?",
     "why": "Mission comes up in many loops. Be specific about what that means to you and what you would want to work on.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you were transparent about a mistake or an incident.",
     "why": "Cloudflare is known for publishing detailed public write-ups of its own outages; interviewers often value candor. Show how you communicated and fixed the cause.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you learned something deeply out of curiosity.",
     "why": "Curiosity is a value the company talks about. Keep it concrete.",
     "audience": "all"
    }
   ],
   "tips": [
    "Review networking and web fundamentals (DNS, TLS, HTTP, caching) for engineering roles.",
    "Read a few of Cloudflare's public engineering and incident posts; they show what the company values.",
    "Have a real answer to why the mission matters to you.",
    "Expect design questions about global scale and failure handling."
   ],
   "ask_them": [
    "What does this team own at the edge, and how does it handle incidents?"
   ]
  },
  {
   "names": [
    "GitLab",
    "GitLab Inc."
   ],
   "confidence": "high",
   "framework": {
    "name": "GitLab CREDIT values (Collaboration, Results, Efficiency, Diversity Inclusion and Belonging, Iteration, Transparency)",
    "note": "GitLab's public handbook documents its values and its entire hiring process. Interviewers assess values alignment in every round, and the handbook is the best preparation: read the values page and the hiring section before any call."
   },
   "format": {
    "default": "GitLab's handbook lays out the steps: application review, a screening call with a recruiter about your background, timeline and compensation expectations (GitLab publishes how it calculates pay by location), then an interview with the hiring manager, then interviews with team members and peers, sometimes an interview with a senior leader, then reference checks and a background check before an offer. Every step is remote by video. The handbook describes each stage, so there are few surprises.",
    "tech": "Engineering candidates usually complete a technical interview that may include a take-home or live coding exercise and a technical conversation with engineers, plus the hiring-manager and team interviews. Because GitLab is all-remote and works in the open, interviewers also look at how you write and communicate asynchronously.",
    "corporate": "Sales, marketing, finance, people and support roles follow the same handbook process with role-specific exercises; sales applicants often complete a presentation or mock call, and marketing and support roles may include a written assignment."
   },
   "questions": [
    {
     "q": "Tell me about a time you shipped something small quickly and improved it afterward instead of waiting for it to be complete.",
     "why": "Iteration is a core GitLab value. Show the smallest useful version, what you learned from it and what came next.",
     "audience": "all",
     "principle": "Iteration"
    },
    {
     "q": "Tell me about a time you shared information openly that others might have kept private.",
     "why": "Transparency. GitLab works in the open by default. Explain the decision and its effect on trust.",
     "audience": "all",
     "principle": "Transparency"
    },
    {
     "q": "Tell me about a time you worked with people across many time zones without live meetings.",
     "why": "Collaboration and Efficiency in an all-remote company. Show how you documented, handed off and kept momentum asynchronously.",
     "audience": "all",
     "principle": "Collaboration"
    },
    {
     "q": "Tell me about a time you focused on the result rather than the hours or the process.",
     "why": "Results. GitLab measures outcomes, not presence. Describe the goal, what you cut and what you delivered.",
     "audience": "all",
     "principle": "Results"
    },
    {
     "q": "Tell me about a time you made a team or process more inclusive.",
     "why": "Diversity, Inclusion and Belonging. Pick a concrete action and what changed for people.",
     "audience": "all",
     "principle": "Diversity, Inclusion and Belonging"
    },
    {
     "q": "Walk me through a change you would make to a piece of code, written as if it were a merge request description.",
     "why": "GitLab engineers communicate through written merge requests and issues. Show that you can explain a change clearly in writing.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you were boring on purpose: chose the simple solution over the clever one.",
     "why": "Efficiency. GitLab's handbook favors boring solutions. Explain the tradeoff and why it paid off.",
     "audience": "all",
     "principle": "Efficiency"
    }
   ],
   "tips": [
    "Read the handbook's hiring and values sections; the process is described there in detail.",
    "Expect to be evaluated on writing; keep any written exercise clear and structured.",
    "Show that you can work without live meetings: documentation, async updates, clear handoffs.",
    "Reference GitLab's own values by name when a story fits one; interviewers map answers to them.",
    "Know how GitLab's public compensation approach works so the recruiter call is straightforward."
   ],
   "ask_them": [
    "How does this team iterate and communicate asynchronously day to day?",
    "What does the team's next few months of priorities look like in the public plans?"
   ],
   "watch": "Reference and background checks are explicit steps late in the process; have references ready so they do not slow the offer."
  },
  {
   "names": [
    "Plaid",
    "Plaid Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or hiring-manager screen, then a loop of several interviews by video, often including a conversation about values and how you work. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Engineering loops usually include practical coding (building or extending a small program in your own environment rather than whiteboard puzzles), a system design interview for experienced levels (often about reliability, data integrations or security), and behavioral conversations. Many applicants report the coding rounds being closer to real work than to algorithm quizzes.",
    "corporate": "Sales, partnerships, marketing and operations roles mix behavioral questions with role exercises; sales applicants often report a presentation or mock call."
   },
   "questions": [
    {
     "q": "Build a small program that fetches data from this source, handles errors, and exposes a clean result.",
     "why": "Practical coding in Plaid's domain. Get the happy path working, then handle failures and bad data. Readability matters.",
     "audience": "tech"
    },
    {
     "q": "Design a system that connects to many external data providers that each behave differently and sometimes fail.",
     "why": "System design around integrations. Talk about retries, rate limits, normalizing data and monitoring.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you handled sensitive data or a security concern carefully.",
     "why": "Plaid works with financial data. Show your judgment and the steps you took.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you helped a customer or partner succeed with a tricky integration or project.",
     "why": "Customer focus is a repeated theme. Show how you understood their constraints and got them live.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you grew from feedback.",
     "why": "Many applicants report questions about learning and growth. Be concrete about what changed.",
     "audience": "all"
    }
   ],
   "tips": [
    "Practice building small working programs with real error handling; the coding rounds are practical.",
    "Understand the basics of what Plaid does for apps and banks before you interview.",
    "Bring examples about reliability and handling messy external systems.",
    "Have a story about handling sensitive data responsibly."
   ],
   "ask_them": [
    "Which products or integrations does this team own, and what breaks most often?"
   ]
  },
  {
   "names": [
    "Coinbase",
    "Coinbase Global",
    "Coinbase Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Coinbase culture tenets",
    "note": "Coinbase publishes culture tenets that include clear communication, efficient execution, acting like an owner, customer focus, positive energy and continuous learning. Many applicants report a dedicated culture-alignment interview that maps to them."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or role screen, then a loop of several interviews that typically includes a culture-alignment conversation. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Engineering loops are known for a pair-programming style: you build a working solution with the interviewer in a shared environment, often extending it step by step, rather than solving a whiteboard puzzle. Experienced levels add a system design interview, and most loops include the culture-alignment round and a hiring-manager conversation.",
    "corporate": "Operations, compliance, finance, marketing and support roles mix behavioral questions on the culture tenets with role-specific scenarios and sometimes a case or written exercise."
   },
   "questions": [
    {
     "q": "Let's build this together. Start with a working version, then we will add requirements.",
     "why": "The pair-programming round. Get something running fast, talk as you go, keep the code easy to extend, and test each step.",
     "audience": "tech"
    },
    {
     "q": "Design a system that processes transactions where correctness matters more than speed.",
     "why": "System design in Coinbase's domain. Discuss idempotency, consistency, auditing and what happens on partial failure.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you communicated something complicated clearly to people who disagreed.",
     "why": "Clear communication. Show how you structured the message and what it changed.",
     "audience": "all",
     "principle": "Clear communication"
    },
    {
     "q": "Tell me about a time you took ownership of a problem nobody had assigned.",
     "why": "Act like an owner. Describe what you saw, what you did and the outcome.",
     "audience": "all",
     "principle": "Act like an owner"
    },
    {
     "q": "Tell me about a time you got something done efficiently when the usual way would have been slow.",
     "why": "Efficient execution. Explain the shortcut you took responsibly and the result.",
     "audience": "all",
     "principle": "Efficient execution"
    },
    {
     "q": "Tell me about a time you kept a team's energy up during a rough stretch.",
     "why": "Positive energy is a stated tenet. Keep it real; show what you did, not how you felt.",
     "audience": "all",
     "principle": "Positive energy"
    }
   ],
   "tips": [
    "Practice pair programming out loud: narrate, test often, and keep your code easy to change.",
    "Read the culture tenets; the culture round often asks for an example per tenet.",
    "Be ready to talk about correctness and safety in financial systems.",
    "Have a plain answer about why you want to work in crypto or finance; it will be asked."
   ],
   "ask_them": [
    "How does this team handle correctness and incidents when money is involved?"
   ]
  },
  {
   "names": [
    "Robinhood",
    "Robinhood Markets"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Robinhood values",
    "note": "Robinhood publishes values that include safety first, participation is power, radical customer focus and first-principles thinking. Behavioral rounds often ask for examples that match them, especially safety and customer focus."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a technical or role screen, then a loop of several interviews over one or two days. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms, a system design interview for experienced levels (often about reliability and consistency in financial systems), and a behavioral interview tied to the values. Some teams add a practical or debugging round.",
    "corporate": "Operations, compliance, finance and marketing roles mix behavioral questions on the values with role-specific scenarios."
   },
   "questions": [
    {
     "q": "Tell me about a time you slowed something down to make it safer.",
     "why": "Safety first. Show the risk you saw and how you balanced it against speed.",
     "audience": "all",
     "principle": "Safety first"
    },
    {
     "q": "Tell me about a time you questioned how something had always been done and reasoned from the basics.",
     "why": "First-principles thinking. Walk through the reasoning, not just the conclusion.",
     "audience": "all",
     "principle": "First-principles thinking"
    },
    {
     "q": "Tell me about a time you fixed something for a customer that the data did not show was a problem.",
     "why": "Radical customer focus. Explain how you noticed and what changed.",
     "audience": "all",
     "principle": "Radical customer focus"
    },
    {
     "q": "Design a system that places and tracks orders so that no order is lost or duplicated.",
     "why": "System design in Robinhood's domain. Cover idempotency, consistency, auditing and recovery after failure.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round. Clarify, solve, state complexity, test an edge case.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Prepare a story per value; safety first comes up often in a financial company.",
    "Practice design problems about correctness and consistency under load.",
    "Have a plain answer about why you want to work in finance for everyday investors.",
    "Be precise with numbers and facts; interviewers tend to probe vague claims."
   ],
   "ask_them": [
    "How does this team think about safety and reliability when shipping changes?"
   ]
  },
  {
   "names": [
    "Atlassian",
    "Atlassian Corporation",
    "Jira",
    "Trello"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Atlassian values + values interview",
    "note": "Atlassian publishes five values (open company, no bullshit; build with heart and balance; don't #@!% the customer; play, as a team; be the change you seek) and its careers site describes a dedicated values interview in the loop. Prepare one honest story for each."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a role or technical screen, then a loop that includes a values interview alongside the role interviews. Atlassian's careers site describes the interview types and offers preparation guidance. Comp and level are usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Engineering loops usually include a coding interview (often practical, with an emphasis on clean, working code), a system design interview for experienced levels, a 'management' or team-fit conversation about how you work with others and handle conflict, and the values interview.",
    "corporate": "Marketing, sales, finance, people and support roles mix role-specific exercises (cases, presentations, work samples) with the values interview and behavioral rounds."
   },
   "questions": [
    {
     "q": "Tell me about a time you were open about something uncomfortable instead of smoothing it over.",
     "why": "Open company, no bullshit. Show the honesty and how you kept it respectful.",
     "audience": "all",
     "principle": "Open company, no bullshit"
    },
    {
     "q": "Tell me about a time you pushed back on a decision because it would hurt customers.",
     "why": "Don't #@!% the customer. Explain what you saw, how you raised it and what changed.",
     "audience": "all",
     "principle": "Don't #@!% the customer"
    },
    {
     "q": "Tell me about a time you helped a teammate succeed at a cost to your own work.",
     "why": "Play, as a team. Pick a real example with a real cost.",
     "audience": "all",
     "principle": "Play, as a team"
    },
    {
     "q": "Tell me about a time you changed something that was not working instead of waiting for someone else to.",
     "why": "Be the change you seek. Show initiative and the outcome.",
     "audience": "all",
     "principle": "Be the change you seek"
    },
    {
     "q": "Tell me about a time you balanced speed with doing right by people.",
     "why": "Build with heart and balance. Explain the tradeoff you made and why.",
     "audience": "all",
     "principle": "Build with heart and balance"
    },
    {
     "q": "Write a working solution to this problem and explain how you would test it.",
     "why": "Atlassian coding rounds often value clean, tested code over clever tricks.",
     "audience": "tech"
    },
    {
     "q": "Design a system that lets many teams track work items with permissions and search.",
     "why": "System design close to Atlassian's products. Talk about data model, permissions, search and scaling.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Read Atlassian's own interview guidance and values page before any round.",
    "Prepare one true story per value; the values interview maps questions to them.",
    "In coding rounds, write code you would be happy to have reviewed; readability is graded.",
    "Expect a conversation about conflict and teamwork; have a real example of a disagreement handled well."
   ],
   "ask_them": [
    "How does this team put the values into practice when priorities clash?"
   ]
  },
  {
   "names": [
    "ServiceNow",
    "ServiceNow Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager interview, then several technical or panel interviews with the team by video. Comp is usually discussed with the recruiter after the interviews. Expect a few weeks.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms, a design or architecture discussion for experienced levels (often about multi-tenant platforms, workflows or enterprise scale), and behavioral questions about teamwork and customers. Some teams ask about Java, JavaScript or databases specifically.",
    "corporate": "Sales, customer success and implementation roles usually include a presentation or mock customer round; marketing, finance and operations roles mix behavioral questions with role scenarios."
   },
   "questions": [
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round. Clarify, solve, state complexity, test an edge case.",
     "audience": "tech"
    },
    {
     "q": "Design a workflow system that many different companies configure differently on the same platform.",
     "why": "Design close to ServiceNow's product. Talk about multi-tenancy, configuration versus code, and performance isolation.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you made a customer's experience better by removing a step or a wait.",
     "why": "ServiceNow sells on making work flow; customer-outcome stories fit well.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you won as a team rather than as an individual.",
     "why": "Teamwork is a stated theme in the company's culture. Give credit and show your part.",
     "audience": "all"
    },
    {
     "q": "Walk me through how you would run a discovery call with a large enterprise.",
     "why": "Common for sales and customer success. Ask about their process pain before pitching.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Know what the platform does for an enterprise IT or HR team; it shapes most questions.",
    "Prepare examples about customers and teamwork; they fit the company's stated culture.",
    "Sales applicants should expect a presentation round.",
    "For engineering, be ready for design questions about platforms used by many customers at once."
   ],
   "ask_them": [
    "Which product area does this team own, and who are its customers inside a company?"
   ]
  },
  {
   "names": [
    "Workday",
    "Workday Inc."
   ],
   "confidence": "medium",
   "framework": {
    "name": "Workday core values (employees, customer service, innovation, integrity, fun, profitability)",
    "note": "Workday publishes core values and puts employees first on the list. Interviewers often ask about teamwork, customer service and integrity, so have an example for each."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager interview, then a panel or series of interviews with the team by video. Comp is usually discussed with the recruiter after the interviews. Expect a few weeks.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms (often in Java or a language of your choice), a design discussion for experienced levels about enterprise applications at scale, and behavioral questions tied to the core values.",
    "corporate": "Sales, customer success, consulting and operations roles mix behavioral questions on the values with role scenarios; sales applicants often report a presentation round."
   },
   "questions": [
    {
     "q": "Tell me about a time you went out of your way for a customer.",
     "why": "Customer service is a core value. Show the extra step and its effect.",
     "audience": "all",
     "principle": "Customer service"
    },
    {
     "q": "Tell me about a time you did the right thing when nobody would have noticed otherwise.",
     "why": "Integrity. Keep it specific.",
     "audience": "all",
     "principle": "Integrity"
    },
    {
     "q": "Tell me about a time you helped make your team a better place to work.",
     "why": "Employees come first in Workday's values. Describe a concrete thing you did for colleagues.",
     "audience": "all",
     "principle": "Employees"
    },
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round. Clarify, solve, state complexity, test an edge case.",
     "audience": "tech"
    },
    {
     "q": "Design a system that stores and reports on payroll or HR data for many companies at once.",
     "why": "Design close to Workday's product. Talk about multi-tenancy, data privacy, auditability and reporting.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Prepare a story per core value; interviewers often ask about them directly.",
    "Bring customer service examples even for engineering roles.",
    "Expect design questions about enterprise data, privacy and correctness."
   ],
   "ask_them": [
    "How does this team hear from customers, and how does that change what it builds?"
   ]
  },
  {
   "names": [
    "Intuit",
    "Intuit Inc.",
    "TurboTax",
    "QuickBooks"
   ],
   "confidence": "medium",
   "framework": {
    "name": "Intuit values + the Craft Demonstration",
    "note": "Intuit publishes values (integrity without compromise, courage, customer obsession, stronger together, we care and give back) and is well known for a 'craft demonstration' interview step: you are given a problem in advance and present your approach to a panel. Prepare for both."
   },
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager interview, then an onsite or virtual day that for many roles includes the craft demonstration (a prepared presentation on an assigned problem) followed by interviews with the team and partner functions. Comp is usually discussed with the recruiter after the loop. Expect a few weeks.",
    "tech": "Engineering candidates usually get coding and design interviews plus, for many roles, a craft demonstration where you present how you would design or build something, then take questions. Interviewers look at how you reason about customers and tradeoffs, not just the technical answer.",
    "corporate": "Product, design, marketing, data and finance roles commonly include the craft demonstration with a role-specific problem, plus behavioral rounds on the values."
   },
   "questions": [
    {
     "q": "Here is a problem we sent you in advance. Walk us through how you would approach it.",
     "why": "The craft demonstration. Structure it: the customer problem, your approach, tradeoffs you considered, what you would do first. Leave time for questions; the discussion is graded.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you learned something about customers by watching or talking to them, and what you changed.",
     "why": "Customer obsession. Intuit talks about direct customer observation; show you have done something like it.",
     "audience": "all",
     "principle": "Customer obsession"
    },
    {
     "q": "Tell me about a time you spoke up when it was risky.",
     "why": "Courage. Describe what was at stake and how you did it.",
     "audience": "all",
     "principle": "Courage"
    },
    {
     "q": "Tell me about a time you refused to cut a corner even under pressure.",
     "why": "Integrity without compromise. Be specific about the pressure and the result.",
     "audience": "all",
     "principle": "Integrity without compromise"
    },
    {
     "q": "Solve this coding problem and explain your approach.",
     "why": "Standard coding round. Clear reasoning counts as much as the answer.",
     "audience": "tech"
    },
    {
     "q": "Design a system that handles a huge spike of users in one short season.",
     "why": "Design in Intuit's domain (tax season). Talk about scaling, reliability, correctness and what you would test ahead of time.",
     "audience": "tech"
    }
   ],
   "tips": [
    "Take the craft demonstration seriously: rehearse out loud, keep slides simple, and leave time for discussion.",
    "Tie every example back to a customer; Intuit's culture is built on it.",
    "Prepare one story per value.",
    "Ask the recruiter exactly what the craft demonstration will cover and how long you will have."
   ],
   "ask_them": [
    "How does this team learn from customers, and how often?"
   ],
   "watch": "The craft demonstration is often sent only days before the interview; clear time to prepare when you get it."
  },
  {
   "names": [
    "Block",
    "Block Inc.",
    "Square",
    "Cash App"
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then a hiring-manager or technical screen, then a loop of several interviews by video, often including a conversation about how you work with others. Block is a distributed company, so expect remote interviews. Comp and level are usually discussed with the recruiter after the loop. Processes vary somewhat between Square, Cash App and the other business units.",
    "tech": "Engineering loops usually include practical coding (sometimes a take-home or a build-something exercise), a system design interview for experienced levels (often about payments, reliability or mobile at scale), and behavioral conversations about collaboration and ownership.",
    "corporate": "Operations, marketing, finance and support roles mix behavioral questions with role scenarios and sometimes a case or written exercise."
   },
   "questions": [
    {
     "q": "Build a small service that accepts payments and handles retries and failures correctly.",
     "why": "Practical coding in Block's domain. Get the happy path working, then handle duplicates and failures. Readability counts.",
     "audience": "tech"
    },
    {
     "q": "Design a system that moves money between accounts without losing or duplicating a transaction.",
     "why": "System design around payments. Talk about idempotency, ledgers, consistency and auditing.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you built something for small businesses or everyday users, or learned what they needed.",
     "why": "Block's customers are sellers and everyday people. Show understanding of their constraints.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you worked with a distributed team and kept everyone aligned.",
     "why": "Block is remote-friendly. Explain how you communicated and documented.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you owned a problem from start to finish.",
     "why": "Ownership. Walk through scoping, blockers and the outcome.",
     "audience": "all"
    }
   ],
   "tips": [
    "Ask which business unit you are interviewing with; Square and Cash App run somewhat differently.",
    "Practice design problems about payments and ledgers.",
    "Be ready to talk about sellers or everyday users and what they need.",
    "If you get a take-home, make it clean and tested; you will discuss it later."
   ],
   "ask_them": [
    "Which business unit is this team in, and who is its customer?"
   ]
  },
  {
   "names": [
    "Palantir",
    "Palantir Technologies"
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, years of experience and timeline, then one or more technical phone screens, then a loop of several interviews. Many applicants report a conversation that probes why you want to work on Palantir's kind of problems and how you think about hard, messy real-world situations. Comp and level are usually discussed with the recruiter after the loop.",
    "tech": "Software loops usually include coding interviews on data structures and algorithms, and Palantir is well known for a 'decomposition' interview where you are given a vague, real-world problem and asked to break it into a workable system, asking questions as you go. Forward deployed engineering roles add questions about working directly with customers and handling ambiguity in the field; some add a practical or data-handling exercise.",
    "corporate": "Non-engineering roles usually involve several conversations testing judgment, communication and comfort with ambiguity, sometimes with a case-style discussion."
   },
   "questions": [
    {
     "q": "A large organization wants to track all of its physical assets across many sites. How would you build something to help them?",
     "why": "The decomposition interview. Ask clarifying questions first, define what matters, break the problem into parts, then dig into one or two. There is no single right answer; they grade how you think.",
     "audience": "tech"
    },
    {
     "q": "Solve this coding problem and discuss its complexity.",
     "why": "Standard coding round. Clarify, solve, state complexity, test an edge case.",
     "audience": "tech"
    },
    {
     "q": "Tell me about a time you worked directly with a customer or user to understand a problem before building anything.",
     "why": "Forward deployed roles live with customers. Show listening and how it changed your plan.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you had to make progress with almost no clear direction.",
     "why": "Comfort with ambiguity is central. Describe how you found the real problem and what you did first.",
     "audience": "all"
    },
    {
     "q": "Why do you want to work on the kinds of problems Palantir works on?",
     "why": "Asked often and taken seriously. Be honest and specific about the kinds of problems and customers you care about.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you argued for a position with evidence and lost, and what you did next.",
     "why": "Many applicants report interviewers probing intellectual honesty and how you handle being wrong.",
     "audience": "all"
    }
   ],
   "tips": [
    "Practice decomposition problems out loud: vague prompt, lots of questions, then a structured breakdown.",
    "Have a clear, honest answer about why Palantir's work interests you; interviewers will press on it.",
    "For forward deployed roles, bring stories about working directly with customers in messy situations.",
    "Stay calm when a problem is deliberately underspecified; asking good questions is the point."
   ],
   "ask_them": [
    "What does a typical engagement or project look like for this team, and how much is on site with customers?"
   ]
  },
  {
   "names": [
    "Anthropic",
    "Anthropic PBC"
   ],
   "confidence": "medium",
   "format": {
    "default": "Anthropic's careers site describes a process that usually includes an initial conversation with a recruiter about your background, experience and timeline, one or more skills assessments or interviews (often a take-home or a timed exercise for technical roles), then a set of interviews with the team that includes a conversation about the company's mission and how you work. Comp is usually discussed with the recruiter later in the process. Postings often ask applicants not to use AI assistants during application exercises; read your posting for the current rule.",
    "tech": "Engineering and research loops usually include a practical coding assessment (building or extending something real rather than algorithm puzzles), a system design or research-discussion interview for experienced levels, and conversations about collaboration and the mission. Expect interviewers to care about clear thinking and honesty about what you do and do not know.",
    "corporate": "Operations, policy, finance, people and go-to-market roles usually include a role-specific exercise (written or case-style) alongside behavioral conversations and the mission discussion."
   },
   "questions": [
    {
     "q": "Build or extend this small program so it does what the description asks, then explain your choices.",
     "why": "Practical coding assessment. Get it working, keep it readable, and be ready to explain tradeoffs and what you would do with more time.",
     "audience": "tech"
    },
    {
     "q": "Walk me through a hard technical problem you solved and what you would do differently.",
     "why": "Technical deep dive. Be honest about what went wrong and show judgment.",
     "audience": "tech"
    },
    {
     "q": "Why does Anthropic's mission matter to you, and what worries you about it?",
     "why": "Mission comes up in most loops, and interviewers often value thoughtful disagreement over enthusiasm. Give a specific, honest answer.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you changed your mind because of evidence.",
     "why": "Many applicants report questions about calibration and honesty. Show the evidence, the change and what you did next.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you worked with people whose expertise was very different from yours.",
     "why": "Teams mix research, engineering, policy and operations. Show how you communicated and learned.",
     "audience": "all"
    },
    {
     "q": "Write a short memo recommending a decision on this problem.",
     "why": "Written exercises are common for operations and policy roles. State the recommendation first, then the reasoning and the risks.",
     "audience": "corporate"
    }
   ],
   "tips": [
    "Read the posting carefully for rules about AI tools during assessments and follow them.",
    "Have an honest, specific view on the mission, including things you are unsure about.",
    "Practice building small working programs under time; the assessments are practical.",
    "Say plainly what you do not know; interviewers tend to value calibration."
   ],
   "ask_them": [
    "How does this team decide what to work on, and how does it connect to the mission?"
   ],
   "watch": "Timed take-home assessments are common; set aside an uninterrupted block before you start one."
  },
  {
   "names": [
    "OpenAI",
    "OpenAI Inc."
   ],
   "confidence": "medium",
   "format": {
    "default": "Usually a recruiter screen about your background, experience and timeline, then one or more technical or role screens, then a loop of several interviews with the team that usually includes a conversation about the mission and how you work. Comp and level are usually discussed with the recruiter after the loop. Many applicants report the process moving quickly once it starts.",
    "tech": "Engineering loops usually include practical coding (building something that works, often in a real environment, rather than algorithm puzzles), a system design interview for experienced levels (often about serving models or handling very large scale), and behavioral conversations about collaboration, ownership and the mission. Research roles add discussion of your past work and research questions.",
    "corporate": "Operations, go-to-market, policy and finance roles usually include a role-specific exercise or case alongside behavioral conversations and the mission discussion."
   },
   "questions": [
    {
     "q": "Build a working solution to this problem, then make it handle larger inputs and failures.",
     "why": "Practical coding. Get a correct, readable version first, then improve. Talk through tradeoffs as you go.",
     "audience": "tech"
    },
    {
     "q": "Design a system that serves a large model to many users with low latency.",
     "why": "System design in OpenAI's domain. Discuss batching, caching, scaling, rate limits and what fails first.",
     "audience": "tech"
    },
    {
     "q": "Why do you want to work here, and what do you think is hard about the mission?",
     "why": "Mission comes up in most loops. Be specific and honest; thoughtful concerns are usually welcome.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you shipped something important fast and how you kept it from breaking.",
     "why": "Pace and ownership are common themes. Show judgment about what you tested and what you deferred.",
     "audience": "all"
    },
    {
     "q": "Tell me about a time you worked with researchers or specialists in a field that was not yours.",
     "why": "Teams mix research, engineering and product. Show how you bridged the gap.",
     "audience": "all"
    }
   ],
   "tips": [
    "Practice building complete, working programs; the coding rounds are practical and time-boxed.",
    "Have a specific, honest view on the mission and what you would want to work on.",
    "Know the basics of how large models are trained and served if you are interviewing for engineering roles.",
    "Expect the process to move fast; be ready to schedule rounds on short notice."
   ],
   "ask_them": [
    "What does this team own, and how does its work reach users?"
   ]
  }
 ]
};
