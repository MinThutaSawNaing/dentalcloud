import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssistantDataStatus from './AssistantDataStatus';

describe('Assistant data readiness status', () => {
  it('explains that drafts/history are available but sending must wait', () => {
    const html = renderToStaticMarkup(<AssistantDataStatus ready={false} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('draft a message');
    expect(html).toContain('sending will be available when loading finishes');
    expect(html).not.toContain('Retry');
  });

  it('renders escaped errors with an explicit retry control', () => {
    const html = renderToStaticMarkup(<AssistantDataStatus ready={false} error="<script>failed</script>" onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;script&gt;failed&lt;/script&gt;');
    expect(html).toContain('type="button"');
    expect(html).toContain('Retry');
  });

  it('removes the loading status when complete data is ready', () => {
    expect(renderToStaticMarkup(<AssistantDataStatus ready />)).toBe('');
  });
});