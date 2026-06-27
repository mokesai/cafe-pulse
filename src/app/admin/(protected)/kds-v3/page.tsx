import { redirect } from 'next/navigation'

// Index for the KDS v3 admin surface. Tabs live in this directory's layout;
// the default landing tab is Screens.
export default function KdsV3IndexPage() {
  redirect('/admin/kds-v3/screens')
}
