import { redirect } from 'next/navigation'

// Redirect to admin-protected KDS route
export default function FoodDisplayPage() {
  redirect('/admin/kds/food')
}
