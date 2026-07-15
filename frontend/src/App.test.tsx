import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./pages/ExhibitionPage', () => ({
  ExhibitionPage: () => <div>Exhibition page body</div>,
}));

vi.mock('./pages/UploadPage', () => ({
  UploadPage: () => <div>Upload page body</div>,
}));

describe('App', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders the exhibition page at the root path', () => {
    window.history.replaceState(null, '', '/');

    render(<App />);

    expect(screen.getByText('Exhibition page body')).toBeInTheDocument();
  });

  it('renders the upload page at the upload path', () => {
    window.history.replaceState(null, '', '/upload');

    render(<App />);

    expect(screen.getByText('Upload page body')).toBeInTheDocument();
  });
});
