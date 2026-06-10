'use client'

const KEY = 'seen_recent_v1'

export interface RecentSearch {
  name: string
  loc?: string
}

export const RecentSearchesStore = {
  get(): RecentSearch[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  },

  push(name: string, loc?: string): void {
    const list = this.get().filter(r => r.name.toLowerCase() !== name.toLowerCase())
    list.unshift({ name, loc })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6)))
  },

  clear(): void {
    localStorage.removeItem(KEY)
  },
}
