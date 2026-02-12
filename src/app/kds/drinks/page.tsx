import { redirect } from 'next/navigation'

// Redirect to admin-protected KDS route
export default function DrinksDisplayPage() {
  redirect('/admin/kds/drinks')
}
