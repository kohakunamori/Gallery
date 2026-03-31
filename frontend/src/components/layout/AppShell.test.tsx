import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('marks Albums active when the route is /albums', () => {
    render(
      <AppShell route="albums">
        <div>Albums content</div>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: 'Albums' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Photos' })).not.toHaveAttribute('aria-current', 'page');
  });
});
