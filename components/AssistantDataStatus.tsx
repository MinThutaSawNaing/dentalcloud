import React from 'react';
import { Loader2 } from 'lucide-react';

interface AssistantDataStatusProps {
  ready: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export default function AssistantDataStatus({ ready, error, onRetry }: AssistantDataStatusProps) {
  if (ready) return null;
  return (
    <div role={error ? 'alert' : 'status'} className="flex shrink-0 items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
      {!error && <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />}
      <p className="min-w-0 flex-1">{error || 'Loading complete clinic data. You can view chats and draft a message; sending will be available when loading finishes.'}</p>
      {error && onRetry && <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-indigo-300 px-3 font-medium">Retry</button>}
    </div>
  );
}