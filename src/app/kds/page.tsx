import { redirect } from 'next/navigation'

// Bare /kds redirects to the v3 admin home (post-phase-7 cutover). Operators
// land here only via accidental URL trimming; Pis address
// /kds/v3/[deviceId]/[screenId] directly.
export default function KDSHomePage() {
  redirect('/admin/kds-v3/screens')
}
