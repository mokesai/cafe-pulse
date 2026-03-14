# RENAME.md — cafe-web → cafe-pulse

> Apply this when the new `cafe-pulse` repo is live. Run changes in order. Delete this file after completing.

## 1. package.json

Change `"name": "website"` → `"name": "cafe-pulse"`

```json
{
  "name": "cafe-pulse"
}
```

---

## 2. README.md

Replace header and description:

**From:**
```
# Cafe Management System

A comprehensive cafe management platform built with Next.js 15...
```

**To:**
```
# Cafe Pulse

Operations platform for The Little Cafe — built on Next.js 15 with Square, Supabase, and AI-powered invoice processing.
```

---

## 3. CLAUDE.md (line ~114)

Change Supabase project label:

**From:**
```
`etihvnzzmtxsnbifftfh` (cafe-web-app-prod)
```

**To:**
```
`etihvnzzmtxsnbifftfh` (cafe-pulse-prod)
```

---

## 4. ecosystem.config.js (PM2 — Raspberry Pi)

Replace all occurrences of `/home/pi/cafe-web` with `/home/pi/cafe-pulse`:

```js
// Before
cwd: '/home/pi/cafe-web',

// After
cwd: '/home/pi/cafe-pulse',
```

---

## 5. doc/raspberry-pi-deployment.md

Replace all occurrences:

| Find | Replace |
|------|---------|
| `cafe-web` (path references) | `cafe-pulse` |
| `git clone ... cafe-web` | `git clone ... cafe-pulse` |
| `cd cafe-web` | `cd cafe-pulse` |
| `pm2 start npm --name "cafe-web"` | `pm2 start npm --name "cafe-pulse"` |
| `pm2 logs cafe-web` | `pm2 logs cafe-pulse` |
| `pm2 restart cafe-web` | `pm2 restart cafe-pulse` |

---

## 6. doc/raspberry-pi-secure-setup.md

Replace systemd service name references:

| Find | Replace |
|------|---------|
| `cafe-web` (sudoers + systemctl lines) | `cafe-pulse` |

---

## 7. Verify — no remaining references

```bash
grep -r "cafe-web" . --include="*.json" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.git
```

Expected output: nothing (or only legitimate URL references to the old GitHub repo if kept for history).

---

## 8. Commit

```bash
git add -A
git commit -m "chore: rename cafe-web → cafe-pulse"
```

---

## After This File Is Applied

- Delete `RENAME.md` from the repo
- Update Raspberry Pi deployments: pull new repo, update PM2 process names, restart
- Vercel project name can be updated in the Vercel dashboard (cosmetic, doesn't affect deployment)
- Supabase project display names can be updated in the Supabase dashboard (also cosmetic)
