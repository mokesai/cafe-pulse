'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { resendInvite } from '../actions';

export function ResendInviteButton({ tenantId, inviteId }: { tenantId: string; inviteId: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    setStatus('sending');
    setError(null);
    const result = await resendInvite(tenantId, inviteId);
    if (result.success) {
      setStatus('sent');
    } else {
      setStatus('error');
      setError(result.error ?? 'Failed to resend invite');
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleResend}
        isLoading={status === 'sending'}
        size="sm"
        variant="outline"
        disabled={status === 'sent'}
      >
        {status === 'sent' ? 'Invite Sent' : 'Resend Invite'}
      </Button>
      {status === 'sent' && (
        <span className="text-green-600 text-sm">Invite email sent successfully</span>
      )}
      {status === 'error' && error && (
        <span className="text-red-600 text-sm">{error}</span>
      )}
    </div>
  );
}
