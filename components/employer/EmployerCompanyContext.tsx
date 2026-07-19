'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// Shared company context for the /employers portal (seen-command#113).
//
// Seen has no employer login, so every employer surface — reputation, listings, dashboard,
// analytics, notifications — identifies a company by NAME via ?company= (see each page's
// comment header). This context is the portal's short-term memory of the company an employer
// is working with: look your company up once (in the reputation or listings card), and the
// jump-off links to the deep-dive surfaces (EmployerSurfaces) carry it through without a
// re-type. It holds nothing durable and writes nothing — it's client-only UI state.
//
// The default value is a safe no-op so the consuming cards keep working if they're ever
// rendered outside a provider.

type EmployerCompanyValue = { company: string; setCompany: (name: string) => void }

const EmployerCompanyContext = createContext<EmployerCompanyValue>({ company: '', setCompany: () => {} })

export function EmployerCompanyProvider({ initial = '', children }: { initial?: string; children: ReactNode }) {
  const [company, setCompany] = useState(initial)
  return (
    <EmployerCompanyContext.Provider value={{ company, setCompany }}>
      {children}
    </EmployerCompanyContext.Provider>
  )
}

export function useEmployerCompany() {
  return useContext(EmployerCompanyContext)
}
