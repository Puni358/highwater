import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../components/Header.jsx';

describe('Header component', () => {
  it('renders DEMO MODE badge when dataMode is demo (FR-02)', () => {
    render(<Header dataMode="demo" studyArea="Bengaluru, Karnataka" />);
    expect(screen.getByText('DEMO MODE')).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru, Karnataka/)).toBeInTheDocument();
  });

  it('renders OPERATIONAL status when dataMode is not demo', () => {
    render(<Header dataMode="live" studyArea="Bengaluru, Karnataka" />);
    expect(screen.queryByText('DEMO MODE')).not.toBeInTheDocument();
    expect(screen.getByText('OPERATIONAL')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked (FR-03)', () => {
    const handleRefresh = vi.fn();
    render(<Header onRefresh={handleRefresh} loading={false} />);
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables refresh button when loading is true', () => {
    const handleRefresh = vi.fn();
    render(<Header onRefresh={handleRefresh} loading={true} />);
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    expect(refreshBtn).toBeDisabled();
    fireEvent.click(refreshBtn);
    expect(handleRefresh).not.toHaveBeenCalled();
  });
});
