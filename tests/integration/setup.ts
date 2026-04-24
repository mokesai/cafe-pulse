import { vi, afterEach } from 'vitest'
import { config as loadDotenv } from 'dotenv'
import path from 'node:path'

loadDotenv({
  path: path.resolve(__dirname, '../../.env.local'),
  quiet: true,
  override: true,
})

process.env.SKIP_MFA_FOR_TESTING = 'true'
process.env.NEXT_PUBLIC_SKIP_MFA_FOR_TESTING = 'true'

const { cookieStore, headerStore } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  headerStore: new Map<string, string>(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    getAll: () =>
      Array.from(cookieStore.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      cookieStore.set(name, value)
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
    has: (name: string) => cookieStore.has(name),
  }),
  headers: async () => ({
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
    has: (name: string) => headerStore.has(name.toLowerCase()),
    entries: () => headerStore.entries(),
    forEach: (cb: (value: string, key: string) => void) => {
      headerStore.forEach((v, k) => cb(v, k))
    },
  }),
}))

afterEach(() => {
  cookieStore.clear()
  headerStore.clear()
})

export function setTestCookies(entries: Record<string, string>) {
  cookieStore.clear()
  for (const [k, v] of Object.entries(entries)) cookieStore.set(k, v)
}

export function setTestHeaders(entries: Record<string, string>) {
  headerStore.clear()
  for (const [k, v] of Object.entries(entries)) headerStore.set(k.toLowerCase(), v)
}
