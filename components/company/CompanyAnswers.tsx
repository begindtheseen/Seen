// The three answers at the top of a company page (lib/company/answers.js), in the server HTML. Each is one
// plain sentence with its numbers, then one small line saying what it counts. The FAQPage JSON-LD the layout
// publishes is these exact strings (question = the h2, answer = sentence + line). No colour: the numbers
// carry the answer, and a state colour would need its own word and icon (DESIGN.md §2).

import type { CompanyAnswersData } from './CompanyAnswersSeed'
import s from './CompanyAnswers.module.css'

export default function CompanyAnswers({ data }: { data: CompanyAnswersData }) {
  return (
    <section className={s.answers} aria-label={`What applicants ask about ${data.name}`} data-testid="company-answers">
      {data.answers.map((a) => (
        <article key={a.id} className={s.item} data-answer={a.id} data-known={a.known ? 'yes' : 'no'}>
          <h2 className={s.q}>{a.question}</h2>
          <p className={s.a}>{a.sentence}</p>
          <p className={s.d}>{a.detail}</p>
        </article>
      ))}
    </section>
  )
}
