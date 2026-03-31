import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('keeps Photos active and future sections disabled on the photos route', () => {
    render(<Sidebar route="photos" />);

    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Albums' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Sharing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trash' })).toBeDisabled();
  });

  it('marks Albums active on the albums route', () => {
    render(<Sidebar route="albums" />);

    expect(screen.getByRole('link', { name: 'Albums' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Photos' })).not.toHaveAttribute('aria-current');
  });
});
