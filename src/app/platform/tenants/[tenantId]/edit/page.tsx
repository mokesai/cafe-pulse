import { requirePlatformAdmin } from '@/lib/platform/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import EditTenantForm from './EditTenantForm';

export default async function EditTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requirePlatformAdmin();

  const { tenantId } = await params;
  const supabase = createServiceClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, business_name, logo_url, primary_color, secondary_color, is_active')
    .eq('id', tenantId)
    .single();

  if (error || !tenant) {
    notFound();
  }

  return <EditTenantForm tenant={tenant} />;
}
