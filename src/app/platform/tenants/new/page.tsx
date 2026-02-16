import { requirePlatformAdmin } from '@/lib/platform/auth';

export default async function OnboardTenantPage() {
  await requirePlatformAdmin();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Onboard New Tenant</h1>
      <p className="text-gray-600">Onboarding wizard coming in Plan 60-05</p>
    </div>
  );
}
