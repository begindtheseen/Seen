'use client'

export function showToast(message: string): void {
  if (typeof document === 'undefined') return
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = message
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3200)
}
