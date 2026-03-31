import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./pages/ExhibitionPage', () => ({
  ExhibitionPage: () => <div>Exhibition page body</div>,
}));

describe('App', () => {
  it('renders the exhibition page directly', () => {
    render(<App />);

    expect(screen.getByText('Exhibition page body')).toBeInTheDocument();
  });
});
