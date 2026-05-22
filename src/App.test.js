import { render, screen } from '@testing-library/react';
import App from './App';

// Mock axios to prevent Jest from attempting to load and compile the ESM package
jest.mock('axios', () => ({
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
}));

// Mock CodeMirror language packages to bypass Jest ESM parsing errors
jest.mock('@codemirror/lang-javascript', () => ({ javascript: () => [] }));
jest.mock('@codemirror/lang-python', () => ({ python: () => [] }));
jest.mock('@codemirror/lang-java', () => ({ java: () => [] }));
jest.mock('@codemirror/lang-cpp', () => ({ cpp: () => [] }));
jest.mock('@codemirror/lang-html', () => ({ html: () => [] }));
jest.mock('@codemirror/lang-css', () => ({ css: () => [] }));
jest.mock('@codemirror/lang-markdown', () => ({ markdown: () => [] }));

// Mock CodeMirror to avoid JSDOM range selection/layout limitations in tests
jest.mock('@uiw/react-codemirror', () => {
  return function MockCodeMirror({ value, onChange }) {
    return (
      <textarea
        data-testid="codemirror-mock"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };
});

test('renders Intelligent IDE interface elements', () => {
  render(<App />);

  // Verify main workspace controls
  expect(screen.getByRole('heading', { name: /Aether IDE/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Commands/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Run$/i })).toBeInTheDocument();

  // Verify terminal/console section
  expect(screen.getByText(/Console\/Terminal\/Output/i)).toBeInTheDocument();

  // Verify AI Chat component
  expect(screen.getByText(/AI Chat/i)).toBeInTheDocument();

  // Verify Live Code Explanation section
  expect(screen.getByText(/Live Code Explanation/i)).toBeInTheDocument();
});
