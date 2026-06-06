import { render, screen, waitFor } from '@testing-library/react';

// Mock axios to prevent Jest from attempting to load and compile the ESM package
jest.mock('axios', () => ({
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
}));

// Mock supabase client to support auth states in testing
jest.mock('./supabaseClient', () => {
  const mockSession = {
    data: {
      session: {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          user_metadata: { name: 'Test User' }
        }
      }
    }
  };
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve(mockSession),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } }
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null })
          })
        }),
        upsert: () => Promise.resolve({ error: null })
      })
    }
  };
});

import App from './App';

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

test('renders Intelligent IDE interface elements', async () => {
  localStorage.setItem('aether-ide-current-user', 'test@example.com');
  localStorage.setItem('aether-ide-users', JSON.stringify({
    'test@example.com': {
      email: 'test@example.com',
      name: 'Test User',
      password: 'password',
    },
  }));

  render(<App />);

  await waitFor(() => expect(screen.getByRole('heading', { name: /Aether IDE/i })).toBeInTheDocument());

  // Verify main workspace controls
  expect(screen.getByRole('heading', { name: /Aether IDE/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Commands/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Run$/i })).toBeInTheDocument();

  // Verify terminal/console section
  expect(screen.getByRole('heading', { name: /^Console$/i })).toBeInTheDocument();

  // Verify AI Chat component
  expect(screen.getByText(/AI Chat/i)).toBeInTheDocument();

  // Verify Live Code Explanation section
  expect(screen.getByText(/Live Code Explanation/i)).toBeInTheDocument();

  // Verify upgraded IDE shell pieces
  expect(screen.getByRole('heading', { name: /Explorer/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /problems/i })).toBeInTheDocument();
});
