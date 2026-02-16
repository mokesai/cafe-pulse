'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { changeStatus, deleteTenant } from '../actions';
import type { TenantStatus } from '@/lib/tenant/types';

export function StatusManager({
  tenantId,
  currentStatus,
  isDeleted,
}: {
  tenantId: string;
  currentStatus: TenantStatus;
  isDeleted: boolean;
}) {
  const router = useRouter();
  const [statusState, statusAction] = useActionState(
    (prev: any, formData: FormData) =>
      changeStatus(tenantId, formData.get('status') as TenantStatus, prev),
    { errors: {} }
  );
  const [deleteState, deleteAction] = useActionState(
    () => deleteTenant(tenantId, { errors: {} }),
    { errors: {} }
  );

  const handleStatusChange = (newStatus: TenantStatus) => {
    const formData = new FormData();
    formData.append('status', newStatus);
    statusAction(formData);
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this tenant? It can be restored within 30 days.')) {
      const result = await deleteAction();
      if (result.success) {
        router.push('/platform/tenants');
      }
    }
  };

  if (isDeleted) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4">
        <p className="text-red-800 mb-2">This tenant has been deleted.</p>
        {/* Restore functionality will be added in future */}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Change Status</h3>
        <div className="flex gap-2 flex-wrap">
          {currentStatus !== 'active' && (
            <Button
              onClick={() => handleStatusChange('active')}
              size="sm"
              variant="outline"
            >
              Set Active
            </Button>
          )}
          {currentStatus !== 'paused' && (
            <Button
              onClick={() => handleStatusChange('paused')}
              size="sm"
              variant="outline"
            >
              Pause
            </Button>
          )}
          {currentStatus !== 'suspended' && (
            <Button
              onClick={() => handleStatusChange('suspended')}
              size="sm"
              variant="destructive"
            >
              Suspend
            </Button>
          )}
        </div>
        {statusState.errors?._form && (
          <p className="text-red-500 text-sm mt-2">{statusState.errors._form[0]}</p>
        )}
        {statusState.success && (
          <p className="text-green-600 text-sm mt-2">Status updated successfully</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2 text-red-600">Danger Zone</h3>
        <Button onClick={handleDelete} variant="destructive" size="sm">
          Delete Tenant
        </Button>
        {deleteState.errors?._form && (
          <p className="text-red-500 text-sm mt-2">{deleteState.errors._form[0]}</p>
        )}
      </div>
    </div>
  );
}
