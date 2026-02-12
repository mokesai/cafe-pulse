import { redirect } from 'next/navigation'

// Redirect to admin-protected KDS selector
export default function KDSHomePage() {
  redirect('/admin/kds')
}
