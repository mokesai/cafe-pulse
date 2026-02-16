import { requirePlatformAdmin } from '@/lib/platform/auth';

export default async function TenantDetailPage({
  params,
}: {
  params: { tenantId: string };
}) {
  await requirePlatformAdmin();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Tenant Details</h1>
      <p className="text-gray-600">Tenant ID: {params.tenantId}</p>
      <p className="text-gray-600">Detail page coming in Plan 60-06</p>
    </div>
  );
}
