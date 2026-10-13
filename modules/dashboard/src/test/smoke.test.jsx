import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../app/App.jsx';

describe('Smoke test', () => {
  it('renders App component without crashing', () => {
    render(<App />);
    expect(screen.getByText('HighWater Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Phase 1 Setup Verification')).toBeInTheDocument();
  });
});
