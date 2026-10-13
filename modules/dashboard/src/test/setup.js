import '@testing-library/jest-dom';

// Polyfill ResizeObserver for jsdom test environment
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
