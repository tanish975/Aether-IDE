import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './App.css';
import { supabase } from './supabaseClient';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const AUTH_USERS_KEY = 'aether-ide-users';
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY?.trim();
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_CONFIG_ERROR = !SUPABASE_URL
  ? 'Missing REACT_APP_SUPABASE_URL in .env. Restart the dev server after adding it.'
  : !SUPABASE_ANON_KEY
    ? 'Missing REACT_APP_SUPABASE_ANON_KEY in .env. Restart the dev server after adding it.'
    : '';
const DEFAULT_CODE = `// Write JavaScript here
console.log("Hello from Aether IDE");`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const starterCode = {
  javascript: DEFAULT_CODE,
  python: 'print("Hello from Aether IDE")',
  java: `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello from Aether IDE");
  }
}`,
  cpp: `#include <iostream>
using namespace std;

int main() {
  cout << "Hello from Aether IDE" << endl;
  return 0;
}`,
  c: `#include <stdio.h>

int main() {
  printf("Hello from Aether IDE\\n");
  return 0;
}`,
  typescript: 'const message: string = "Hello from Aether IDE";\nconsole.log(message);',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n  fmt.Println("Hello from Aether IDE")\n}',
  rust: 'fn main() {\n  println!("Hello from Aether IDE");\n}',
  php: '<?php\necho "Hello from Aether IDE\\n";\n?>',
  ruby: 'puts "Hello from Aether IDE"',
  csharp: `using System;

class Program {
  static void Main() {
    Console.WriteLine("Hello from Aether IDE");
  }
}`,
  kotlin: 'fun main() {\n  println("Hello from Aether IDE")\n}',
  html: '<main>\n  <h1>Hello from Aether IDE</h1>\n</main>',
  css: 'body {\n  font-family: system-ui, sans-serif;\n  color: #e5e7eb;\n}',
  markdown: '# Hello from Aether IDE\n\nStart writing notes here.',
};

const createDefaultFiles = () => ([
  { id: 'main-js', name: 'main.js', language: 'javascript', content: starterCode.javascript, isDirty: false },
  { id: 'script-py', name: 'script.py', language: 'python', content: starterCode.python, isDirty: false },
  { id: 'index-html', name: 'index.html', language: 'html', content: starterCode.html, isDirty: false },
]);

const normalizeAccountId = (value) => value.trim().toLowerCase();

const getWorkspaceKey = (accountId) => `aether-ide-workspace:${accountId}`;

const readJsonStorage = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
};

const getSavedUsers = () => readJsonStorage(AUTH_USERS_KEY, {});

const getSavedWorkspace = (accountId) => readJsonStorage(getWorkspaceKey(accountId), null);

const saveWorkspace = (accountId, workspace) => {
  localStorage.setItem(getWorkspaceKey(accountId), JSON.stringify(workspace));
};

const renderMarkdown = (text) => {
  if (!text) return { __html: '' };

  // Escape basic HTML tags to prevent arbitrary injection, but allow our own tags
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Format headers
  escaped = escaped.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  escaped = escaped.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  escaped = escaped.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // Format bold
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Format inline code
  escaped = escaped.replace(/`(.*?)`/g, '<code>$1</code>');

  // Format unordered lists
  const lines = escaped.split('\n');
  let inList = false;
  const newLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const content = trimmed.substring(2);
      if (!inList) {
        inList = true;
        newLines.push('<ul class="markdown-list">');
      }
      newLines.push(`<li>${content}</li>`);
    } else {
      if (inList) {
        inList = false;
        newLines.push('</ul>');
      }
      newLines.push(line);
    }
  }
  if (inList) {
    newLines.push('</ul>');
  }

  // Format paragraphs/newlines
  const finalHtml = newLines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="markdown-spacing"></div>';
      // If it's a block level tag, return as-is
      if (
        trimmed.startsWith('<h') ||
        trimmed.startsWith('</h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('</ul') ||
        trimmed.startsWith('<li') ||
        trimmed.startsWith('</li')
      ) {
        return line;
      }
      return `<p class="markdown-paragraph">${line}</p>`;
    })
    .join('\n');

  return { __html: finalHtml };
};

const getConsoleTone = (output, state) => {
  const lowered = output.toLowerCase();
  if (state === 'running') return 'running';
  if (lowered.includes('error') || lowered.includes('exception') || lowered.includes('failed')) return 'error';
  if (state === 'success') return 'success';
  return 'idle';
};

function App() {
  const groqApiKey = process.env.REACT_APP_GROQ_API_KEY;
  const compilerApiKey = process.env.REACT_APP_ONECOMPILER_API_KEY;
  const codeExplanationTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const abortRunRef = useRef(null);
  const resizeStateRef = useRef(null);

  const languageConfig = useMemo(() => ({
    javascript: { label: 'JavaScript', apiLang: 'nodejs', ext: 'js', extension: javascript() },
    python: { label: 'Python', apiLang: 'python', ext: 'py', extension: python() },
    java: { label: 'Java', apiLang: 'java', ext: 'java', extension: java() },
    cpp: { label: 'C++', apiLang: 'cpp', ext: 'cpp', extension: cpp() },
    c: { label: 'C', apiLang: 'c', ext: 'c', extension: cpp() },
    typescript: { label: 'TypeScript', apiLang: 'typescript', ext: 'ts', extension: javascript({ typescript: true }) },
    go: { label: 'Go', apiLang: 'go', ext: 'go', extension: null },
    rust: { label: 'Rust', apiLang: 'rust', ext: 'rs', extension: null },
    php: { label: 'PHP', apiLang: 'php', ext: 'php', extension: null },
    ruby: { label: 'Ruby', apiLang: 'ruby', ext: 'rb', extension: null },
    csharp: { label: 'C#', apiLang: 'csharp', ext: 'cs', extension: null },
    kotlin: { label: 'Kotlin', apiLang: 'kotlin', ext: 'kt', extension: null },
    html: { label: 'HTML', apiLang: 'html', ext: 'html', extension: html() },
    css: { label: 'CSS', apiLang: 'css', ext: 'css', extension: css() },
    markdown: { label: 'Markdown', apiLang: 'markdown', ext: 'md', extension: markdown() },
  }), []);

  const languageOptions = useMemo(
    () => Object.entries(languageConfig).map(([key, value]) => ({ key, ...value })),
    [languageConfig],
  );

  const [code, setCode] = useState(DEFAULT_CODE);
  const [consoleOutput, setConsoleOutput] = useState('Ready. Run your code to see output here.');
  const [chatMessage, setChatMessage] = useState('');
  const [chatResponse, setChatResponse] = useState('Ask about your code, request a solution, or use Debug after running.');
  const [codeExplanation, setCodeExplanation] = useState('Start editing to generate a short explanation.');
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');
  const [consoleInput, setConsoleInput] = useState('');
  const [chatLanguage, setChatLanguage] = useState('english');
  const [isRunning, setIsRunning] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Workspace ready');
  const [theme, setTheme] = useState(() => localStorage.getItem('ide-theme') || 'dark');
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isEditorOptionsOpen, setIsEditorOptionsOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(() => Number(localStorage.getItem('ide-font-size')) || 14);
  const [explorerWidth, setExplorerWidth] = useState(190);
  const [assistantWidth, setAssistantWidth] = useState(320);
  const [toastMessage, setToastMessage] = useState('');
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('aether-ide-current-user');
    return savedUser ? normalizeAccountId(savedUser) : '';
  });
  const [currentUserId, setCurrentUserId] = useState('');
  const [supabaseUserMetadata, setSupabaseUserMetadata] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authSuccess, setAuthSuccess] = useState('');
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [projectFiles, setProjectFiles] = useState(() => createDefaultFiles());
  const [activeFileId, setActiveFileId] = useState('main-js');
  const [activeMobilePanel, setActiveMobilePanel] = useState('editor');
  const [consoleTab, setConsoleTab] = useState('output');
  const [consoleHistory, setConsoleHistory] = useState([]);
  const [assistantSuggestion, setAssistantSuggestion] = useState('');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const hasGroqKey = Boolean(groqApiKey && !groqApiKey.includes('your_'));
  const hasCompilerKey = Boolean(compilerApiKey && !compilerApiKey.includes('your_'));
  const currentLanguage = languageConfig[selectedLanguage] || languageConfig.javascript;
  const isLightTheme = theme === 'light';
  const activeFile = projectFiles.find((file) => file.id === activeFileId) || projectFiles[0];
  const hasDirtyFiles = projectFiles.some((file) => file.isDirty);
  const consoleState = useMemo(() => {
    const normalizedOutput = consoleOutput.toLowerCase();
    if (isRunning) return 'running';
    if (normalizedOutput.includes('error') || normalizedOutput.includes('exception') || statusMessage.toLowerCase().includes('failed')) {
      return 'error';
    }
    if (statusMessage.toLowerCase().includes('complete')) return 'success';
    return 'idle';
  }, [consoleOutput, isRunning, statusMessage]);

  const codeStats = useMemo(() => {
    const lines = code ? code.split('\n').length : 0;
    const characters = code.length;
    const bytes = new Blob([code]).size;

    return { lines, characters, bytes };
  }, [code]);

  const activeAccount = useMemo(() => {
    if (!currentUser) return null;
    if (supabaseUserMetadata) {
      return { name: supabaseUserMetadata.name || currentUser.split('@')[0], email: currentUser };
    }
    const users = getSavedUsers();
    return users[currentUser] || { name: currentUser.split('@')[0], email: currentUser };
  }, [currentUser, supabaseUserMetadata]);

  const statusTone = consoleState === 'error' ? 'error' : consoleState === 'success' ? 'success' : hasDirtyFiles ? 'warning' : 'info';
  const problems = useMemo(() => {
    const lines = consoleOutput.split('\n').filter((line) => /error|exception|failed|traceback/i.test(line));
    return lines.length ? lines : ['No problems detected from the latest run.'];
  }, [consoleOutput]);

  const apiStatusText = isOnline
    ? `${hasGroqKey ? 'Groq ready' : 'Groq key missing'} · ${hasCompilerKey ? 'Compiler ready' : 'Compiler key missing'}`
    : 'Offline';

  const showToast = useCallback((message) => {
    setToastMessage(message);
    window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToastMessage(''), 2200);
  }, []);

  const getErrorMessage = useCallback((error) => {
    return (
      error.response?.data?.stderr ||
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'Unknown request error'
    );
  }, []);

  const extractCodeBlock = (text) => {
    const match = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    return match ? match[1].trim() : text.trim();
  };

  const formatCompilerOutput = useCallback((data) => {
    const output = [
      data?.stdout,
      data?.stderr && `Error:\n${data.stderr}`,
      data?.exception && `Exception:\n${data.exception}`,
    ].filter(Boolean).join('\n');

    return output || 'Program finished with no output.';
  }, []);

  const callGroq = useCallback(async (content) => {
    if (!hasGroqKey) {
      throw new Error('Missing REACT_APP_GROQ_API_KEY. Add a valid Groq key in .env and restart the dev server.');
    }

    const response = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content }],
        temperature: 0.25,
      },
      {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data?.choices?.[0]?.message?.content?.trim() || 'No response returned.';
  }, [groqApiKey, hasGroqKey]);

  const getCodeExplanation = useCallback(async (currentCode) => {
    if (!currentCode.trim()) {
      setCodeExplanation('Start writing code to see an explanation.');
      return;
    }

    if (!hasGroqKey) {
      setCodeExplanation('Add REACT_APP_GROQ_API_KEY to enable live explanations.');
      return;
    }

    setIsExplaining(true);
    try {
      const aiResponse = await callGroq(
        `Explain this ${selectedLanguage} code in clear bullet points. Keep it concise and practical:\n\n\`\`\`\n${currentCode}\n\`\`\``,
      );
      setCodeExplanation(aiResponse);
    } catch (error) {
      setCodeExplanation(`Explanation failed: ${getErrorMessage(error)}`);
    } finally {
      setIsExplaining(false);
    }
  }, [callGroq, getErrorMessage, hasGroqKey, selectedLanguage]);

  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    setProjectFiles((files) => files.map((file) => (
      file.id === activeFileId ? { ...file, content: newCode, isDirty: true } : file
    )));
    setStatusMessage('Editing');

    if (codeExplanationTimeoutRef.current) {
      clearTimeout(codeExplanationTimeoutRef.current);
    }

    codeExplanationTimeoutRef.current = setTimeout(() => {
      getCodeExplanation(newCode);
    }, 900);
  }, [activeFileId, getCodeExplanation]);

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  useEffect(() => {
    return () => {
      if (codeExplanationTimeoutRef.current) {
        clearTimeout(codeExplanationTimeoutRef.current);
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleResizeMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const deltaX = event.clientX - resizeState.startX;
      if (resizeState.panel === 'explorer') {
        setExplorerWidth(clamp(resizeState.startWidth + deltaX, 150, 320));
      } else {
        setAssistantWidth(clamp(resizeState.startWidth - deltaX, 280, 520));
      }
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      document.body.classList.remove('is-resizing-panel');
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', stopResize);

    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', stopResize);
      document.body.classList.remove('is-resizing-panel');
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!HAS_SUPABASE_CONFIG) {
      return undefined;
    }

    // Check session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const email = normalizeAccountId(session.user.email);
        setCurrentUser(email);
        setCurrentUserId(session.user.id);
        setSupabaseUserMetadata(session.user.user_metadata || null);
        localStorage.setItem('aether-ide-current-user', email);
      }
    });

    // Listen to changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const email = normalizeAccountId(session.user.email);
        setCurrentUser(email);
        setCurrentUserId(session.user.id);
        setSupabaseUserMetadata(session.user.user_metadata || null);
        localStorage.setItem('aether-ide-current-user', email);
      } else {
        setCurrentUser('');
        setCurrentUserId('');
        setSupabaseUserMetadata(null);
        setIsWorkspaceReady(false);
        localStorage.removeItem('aether-ide-current-user');
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('ide-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ide-font-size', String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    if (!currentUser) {
      setIsWorkspaceReady(false);
      return;
    }

    const loadWorkspaceData = async () => {
      let workspace = null;
      let loadedFromCloud = false;

      if (currentUserId) {
        try {
          const { data, error } = await supabase
            .from('workspaces')
            .select('workspace_data')
            .eq('user_id', currentUserId)
            .maybeSingle();

          if (error) {
            console.warn('Could not load workspace from Supabase:', error.message);
          } else if (data && data.workspace_data) {
            workspace = data.workspace_data;
            loadedFromCloud = true;
          }
        } catch (dbError) {
          console.warn('Supabase DB error while loading:', dbError);
        }
      }

      // If we couldn't load from cloud, fall back to local storage
      if (!workspace) {
        workspace = getSavedWorkspace(currentUser);
      }

      if (workspace) {
        const savedFiles = Array.isArray(workspace.projectFiles) && workspace.projectFiles.length
          ? workspace.projectFiles
          : [{ id: 'main-js', name: `main.${languageConfig[workspace.selectedLanguage || 'javascript']?.ext || 'js'}`, language: workspace.selectedLanguage || 'javascript', content: workspace.code ?? DEFAULT_CODE, isDirty: false }];
        const savedActiveFile = savedFiles.find((file) => file.id === workspace.activeFileId) || savedFiles[0];
        setProjectFiles(savedFiles);
        setActiveFileId(savedActiveFile.id);
        setCode(savedActiveFile.content ?? workspace.code ?? starterCode[savedActiveFile.language] ?? DEFAULT_CODE);
        setSelectedLanguage(savedActiveFile.language || workspace.selectedLanguage || 'javascript');
        setConsoleInput(workspace.consoleInput || '');
        setConsoleOutput(workspace.consoleOutput || 'Ready. Run your code to see output here.');
        setChatResponse(workspace.chatResponse || 'Ask about your code, request a solution, or use Debug after running.');
        setCodeExplanation(workspace.codeExplanation || 'Start editing to generate a short explanation.');
        setChatLanguage(workspace.chatLanguage || 'english');
        setTheme(workspace.theme || 'dark');
        setEditorFontSize(Number(workspace.editorFontSize) || 14);
        setIsAssistantOpen(false);
        setIsExplorerOpen(workspace.isExplorerOpen ?? true);
        setExplorerWidth(clamp(Number(workspace.explorerWidth) || 190, 150, 320));
        setAssistantWidth(clamp(Number(workspace.assistantWidth) || 320, 280, 520));
        setConsoleHistory(workspace.consoleHistory || []);
        setAssistantSuggestion(workspace.assistantSuggestion || '');
        
        setStatusMessage(loadedFromCloud 
          ? `Synced workspace from cloud for ${activeAccount?.name || currentUser}`
          : `Welcome back, ${activeAccount?.name || currentUser} (local cache)`
        );
      } else {
        const defaultFiles = createDefaultFiles();
        setProjectFiles(defaultFiles);
        setActiveFileId(defaultFiles[0].id);
        setCode(DEFAULT_CODE);
        setSelectedLanguage('javascript');
        setConsoleInput('');
        setConsoleOutput('Ready. Run your code to see output here.');
        setChatResponse('Ask about your code, request a solution, or use Debug after running.');
        setCodeExplanation('Start editing to generate a short explanation.');
        setChatLanguage('english');
        setConsoleHistory([]);
        setAssistantSuggestion('');
        setStatusMessage(`Workspace ready for ${activeAccount?.name || currentUser}`);
      }

      setIsWorkspaceReady(true);
    };

    loadWorkspaceData();
  }, [activeAccount?.name, currentUser, currentUserId, languageConfig]);

  useEffect(() => {
    if (!currentUser || !isWorkspaceReady) return;
    if (!HAS_SUPABASE_CONFIG) return;

    const workspaceData = {
      code,
      selectedLanguage,
      consoleInput,
      consoleOutput,
      chatResponse,
      codeExplanation,
      chatLanguage,
      theme,
      editorFontSize,
      isAssistantOpen,
      isExplorerOpen,
      explorerWidth,
      assistantWidth,
      projectFiles,
      activeFileId,
      consoleHistory,
      assistantSuggestion,
      updatedAt: new Date().toISOString(),
    };

    // 1. Always save synchronously to local storage for instant recovery
    saveWorkspace(currentUser, workspaceData);

    // 2. Debounce cloud save to Supabase to prevent spamming queries
    if (!currentUserId) return;

    const syncToSupabase = async () => {
      try {
        const { error } = await supabase
          .from('workspaces')
          .upsert(
            {
              user_id: currentUserId,
              workspace_data: workspaceData,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );

        if (error) {
          console.warn('Supabase autosave failed (expected if table not created):', error.message);
        }
      } catch (dbError) {
        console.warn('Supabase DB error while autosaving:', dbError);
      }
    };

    const debounceTimeout = setTimeout(syncToSupabase, 2000); // 2 second debounce

    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [
    activeFileId,
    assistantSuggestion,
    assistantWidth,
    chatLanguage,
    chatResponse,
    code,
    codeExplanation,
    consoleInput,
    consoleOutput,
    currentUser,
    currentUserId,
    consoleHistory,
    editorFontSize,
    explorerWidth,
    isAssistantOpen,
    isExplorerOpen,
    isWorkspaceReady,
    projectFiles,
    selectedLanguage,
    theme,
  ]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    if (!HAS_SUPABASE_CONFIG) {
      setAuthError(SUPABASE_CONFIG_ERROR || 'Supabase is not configured for this app.');
      setAuthSuccess('');
      setStatusMessage('Authentication unavailable');
      return;
    }

    const email = normalizeAccountId(authEmail);
    const password = authPassword.trim();
    const name = authName.trim() || email.split('@')[0];

    if (!email) {
      setAuthError('Please enter your email address.');
      return;
    }
    if (!password) {
      setAuthError('Please enter your password.');
      return;
    }
    if (authMode === 'signup' && password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    setIsAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');
    setStatusMessage('Authenticating...');

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (error) throw error;

        // If a session was returned immediately, user is logged in (email confirmation disabled)
        if (data?.session) {
          showToast('Account created! Welcome to Aether IDE!');
          setAuthEmail('');
          setAuthName('');
          setAuthPassword('');
          setShowAuthPassword(false);
        } else {
          // Email confirmation is required — inform the user clearly
          setAuthSuccess('Account created! Check your email to confirm before logging in.');
          setAuthMode('login');
          setAuthEmail(email);
          setAuthPassword('');
          setShowAuthPassword(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const errorMessage = error.message || '';

          if (/failed to fetch|networkerror|load failed/i.test(errorMessage)) {
            throw new Error('Supabase could not be reached from this browser. Check your Supabase URL, anon key, and network/CORS settings.');
          }

          // Give user-friendly messages for common Supabase error codes
          if (errorMessage.includes('Invalid login credentials') || errorMessage.includes('invalid_credentials')) {
            throw new Error('Incorrect email or password. Please try again.');
          }
          if (errorMessage.includes('Email not confirmed')) {
            throw new Error('Please confirm your email address first. Check your inbox.');
          }
          throw error;
        }
        showToast('Welcome back to Aether IDE!');
        setAuthEmail('');
        setAuthPassword('');
        setShowAuthPassword(false);
      }
    } catch (error) {
      setAuthError(error.message || 'Authentication failed. Please try again.');
      setStatusMessage('Authentication failed');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
    setCurrentUser('');
    setCurrentUserId('');
    setSupabaseUserMetadata(null);
    setIsWorkspaceReady(false);
    setIsCommandPaletteOpen(false);
    setIsFocusMode(false);
    setStatusMessage('Signed out');
  };

  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value;
    setSelectedLanguage(nextLanguage);
    const nextCode = starterCode[nextLanguage] || '';
    setCode(nextCode);
    setProjectFiles((files) => files.map((file) => (
      file.id === activeFileId
        ? { ...file, language: nextLanguage, name: `main.${languageConfig[nextLanguage]?.ext || 'txt'}`, content: nextCode, isDirty: true }
        : file
    )));
    setConsoleOutput('Ready. Run your code to see output here.');
    setCodeExplanation('Start editing to generate a short explanation.');
    setStatusMessage(`Switched to ${languageConfig[nextLanguage]?.label || nextLanguage}`);
  };

  const handleRun = useCallback(async () => {
    setActiveMobilePanel('console');
    setConsoleTab('output');

    if (!hasCompilerKey) {
      setConsoleOutput('Missing REACT_APP_ONECOMPILER_API_KEY. Add a valid key in .env and restart the dev server.');
      setStatusMessage('Compiler key missing');
      return;
    }

    if (!code.trim()) {
      setConsoleOutput('There is no code to run.');
      setStatusMessage('Nothing to run');
      return;
    }

    setIsRunning(true);
    setStatusMessage(`Running ${currentLanguage.label}`);
    setConsoleOutput('Executing code...');
    setConsoleHistory((items) => [
      { id: Date.now(), command: `run ${activeFile?.name || `main.${currentLanguage.ext}`}`, input: consoleInput, time: new Date().toLocaleTimeString() },
      ...items.slice(0, 7),
    ]);

    const fileName = `main.${currentLanguage.ext}`;
    const payload = {
      language: currentLanguage.apiLang,
      stdin: consoleInput,
      files: [{ name: fileName, content: code }],
    };

    const isDirectKey = compilerApiKey.startsWith('oc_');
    const url = isDirectKey ? '/v1/run' : 'https://onecompiler-apis.p.rapidapi.com/api/v1/run';
    const headers = isDirectKey
      ? { 'X-API-Key': compilerApiKey, 'Content-Type': 'application/json' }
      : {
          'X-RapidAPI-Key': compilerApiKey,
          'X-RapidAPI-Host': 'onecompiler-apis.p.rapidapi.com',
          'Content-Type': 'application/json',
        };

    try {
      const controller = new AbortController();
      abortRunRef.current = controller;
      const response = await axios.post(url, payload, { headers, timeout: 30000, signal: controller.signal });
      setConsoleOutput(formatCompilerOutput(response.data));
      setStatusMessage('Run complete');
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        setConsoleOutput('Run stopped by user.');
        setStatusMessage('Run stopped');
      } else {
        setConsoleOutput(`Error executing code:\n${getErrorMessage(error)}`);
        setStatusMessage('Run failed');
      }
    } finally {
      abortRunRef.current = null;
      setIsRunning(false);
    }
  }, [activeFile?.name, code, compilerApiKey, consoleInput, currentLanguage, formatCompilerOutput, getErrorMessage, hasCompilerKey]);

  useEffect(() => {
    const handleGlobalKeys = (event) => {
      const key = event.key?.toLowerCase();
      if (!key) return;

      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((currentValue) => !currentValue);
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        handleRun();
      }

      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalKeys, true);
    return () => window.removeEventListener('keydown', handleGlobalKeys, true);
  }, [handleRun]);

  const handleDebug = async () => {
    setActiveMobilePanel('assistant');

    if (!code.trim()) {
      setChatResponse('AI: Write some code first, then I can help debug it.');
      return;
    }

    setIsDebugging(true);
    setStatusMessage('Debugging with AI');
    setChatResponse('Debugging your code...');

    try {
      const aiResponse = await callGroq(
        `You are a senior programming mentor. Debug this ${selectedLanguage} code using the console output. Return corrected code in one fenced code block, then a short "Explanation:" section.\n\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nConsole output:\n\`\`\`\n${consoleOutput}\n\`\`\``,
      );
      const correctedCode = extractCodeBlock(aiResponse);
      const explanation = aiResponse.match(/Explanation:[\s\S]*/)?.[0]?.trim() || 'Explanation: Updated the code based on the detected issue.';

      if (correctedCode) {
        setCode(correctedCode);
        setAssistantSuggestion(correctedCode);
        setProjectFiles((files) => files.map((file) => (
          file.id === activeFileId ? { ...file, content: correctedCode, isDirty: true } : file
        )));
        getCodeExplanation(correctedCode);
      }

      setChatResponse(`AI: ${explanation}`);
      setStatusMessage('Debug suggestion applied');
    } catch (error) {
      setChatResponse(`AI debugging failed: ${getErrorMessage(error)}`);
      setStatusMessage('Debug failed');
    } finally {
      setIsDebugging(false);
    }
  };

  const sendChatMessage = async () => {
    const prompt = chatMessage.trim();
    if (!prompt) return;

    setIsChatLoading(true);
    setActiveMobilePanel('assistant');
    setStatusMessage('Asking AI');
    setChatResponse('Thinking...');

    const isCodeRequest = /\b(write|create|generate|give|make|build)\b/i.test(prompt);

    try {
      if (isCodeRequest) {
        const aiResponse = await callGroq(
          `Generate ${selectedLanguage} code for this request. Return only one fenced code block and no explanation.\n\nRequest: ${prompt}`,
        );
        const generatedCode = extractCodeBlock(aiResponse);
        setCode(generatedCode);
        setAssistantSuggestion(generatedCode);
        setProjectFiles((files) => files.map((file) => (
          file.id === activeFileId ? { ...file, content: generatedCode, isDirty: true } : file
        )));
        setChatResponse(`AI: Generated ${currentLanguage.label} code and placed it in the editor.`);
        getCodeExplanation(generatedCode);
      } else {
        const aiResponse = await callGroq(
          `You are an AI coding assistant. Respond in ${chatLanguage}.\n\nCurrent language: ${selectedLanguage}\n\nCurrent code:\n\`\`\`\n${code}\n\`\`\`\n\nConsole output:\n\`\`\`\n${consoleOutput}\n\`\`\`\n\nUser question:\n${prompt}`,
        );
        setChatResponse(`AI: ${aiResponse}`);
        setAssistantSuggestion(extractCodeBlock(aiResponse) !== aiResponse.trim() ? extractCodeBlock(aiResponse) : '');
      }
      setStatusMessage('AI response ready');
    } catch (error) {
      setChatResponse(`AI request failed: ${getErrorMessage(error)}`);
      setStatusMessage('AI request failed');
    } finally {
      setChatMessage('');
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = (event) => {
    if (event?.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  };

  const handleConsoleInputSubmit = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleRun();
    }
  };

  const clearConsole = () => {
    setConsoleOutput('Console cleared.');
    setStatusMessage('Console cleared');
    showToast('Console cleared');
  };

  const resetStarterCode = () => {
    const nextCode = starterCode[selectedLanguage] || DEFAULT_CODE;
    setCode(nextCode);
    setProjectFiles((files) => files.map((file) => (
      file.id === activeFileId ? { ...file, content: nextCode, isDirty: true } : file
    )));
    setConsoleOutput('Starter code restored.');
    setCodeExplanation('Start editing to generate a short explanation.');
    setStatusMessage('Starter code restored');
    showToast('Starter code restored');
  };

  const copyConsoleOutput = async () => {
    try {
      await copyText(consoleOutput);
      setStatusMessage('Console output copied');
      showToast('Console output copied');
    } catch (error) {
      setStatusMessage('Copy failed');
      showToast('Copy failed');
    }
  };

  const copyCode = async () => {
    try {
      await copyText(code);
      setStatusMessage('Code copied');
      showToast('Code copied');
    } catch (error) {
      setStatusMessage('Copy failed');
      showToast('Copy failed');
    }
  };

  const selectFile = (fileId) => {
    const nextFile = projectFiles.find((file) => file.id === fileId);
    if (!nextFile) return;

    setActiveFileId(fileId);
    setSelectedLanguage(nextFile.language);
    setCode(nextFile.content);
    setCodeExplanation('Start editing to generate a short explanation.');
    setStatusMessage(`Opened ${nextFile.name}`);
  };

  const createFileFromTemplate = (language) => {
    const config = languageConfig[language] || languageConfig.javascript;
    const count = projectFiles.filter((file) => file.language === language).length + 1;
    const newFile = {
      id: `${language}-${Date.now()}`,
      name: count === 1 ? `main.${config.ext}` : `${language}-${count}.${config.ext}`,
      language,
      content: starterCode[language] || '',
      isDirty: true,
    };

    setProjectFiles((files) => [...files, newFile]);
    setActiveFileId(newFile.id);
    setSelectedLanguage(language);
    setCode(newFile.content);
    setActiveMobilePanel('editor');
    setStatusMessage(`Created ${newFile.name}`);
  };

  const removeFile = (fileId) => {
    if (projectFiles.length <= 1) {
      setStatusMessage('Keep at least one file in the workspace');
      showToast('Keep at least one file');
      return;
    }

    const fileToRemove = projectFiles.find((file) => file.id === fileId);
    if (!fileToRemove) return;

    const remainingFiles = projectFiles.filter((file) => file.id !== fileId);
    setProjectFiles(remainingFiles);

    if (fileId === activeFileId) {
      const nextFile = remainingFiles[0];
      setActiveFileId(nextFile.id);
      setSelectedLanguage(nextFile.language);
      setCode(nextFile.content);
      setCodeExplanation('Start editing to generate a short explanation.');
    }

    setStatusMessage(`Removed ${fileToRemove.name}`);
    showToast(`Removed ${fileToRemove.name}`);
  };

  const markCurrentFileSaved = () => {
    setProjectFiles((files) => files.map((file) => (
      file.id === activeFileId ? { ...file, isDirty: false } : file
    )));
  };

  const downloadCode = () => {
    const fileName = activeFile?.name || `main.${currentLanguage.ext}`;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage(`${fileName} downloaded`);
    markCurrentFileSaved();
    showToast(`${fileName} downloaded`);
  };

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
    setStatusMessage(`${isLightTheme ? 'Dark' : 'Light'} mode enabled`);
    showToast(`${isLightTheme ? 'Dark' : 'Light'} mode enabled`);
  };

  const startPanelResize = (panel, event) => {
    event.preventDefault();
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === 'explorer' ? explorerWidth : assistantWidth,
    };
    document.body.classList.add('is-resizing-panel');
  };

  const runEditorOption = (action) => {
    action();
    setIsEditorOptionsOpen(false);
  };

  const changeEditorFontSize = (amount) => {
    setEditorFontSize((currentSize) => Math.min(20, Math.max(12, currentSize + amount)));
    showToast(amount > 0 ? 'Editor text enlarged' : 'Editor text reduced');
  };

  const stopRun = () => {
    abortRunRef.current?.abort();
    setStatusMessage('Stopping run');
  };

  const applySuggestionToEditor = () => {
    if (!assistantSuggestion) return;
    handleCodeChange(assistantSuggestion);
    setActiveMobilePanel('editor');
    setStatusMessage('Suggestion applied');
  };

  const commandItems = [
    { label: 'Run code', hint: 'Compile and execute', action: handleRun },
    { label: 'Copy code', hint: 'Copy editor contents', action: copyCode },
    { label: 'Save file', hint: `Download main.${currentLanguage.ext}`, action: downloadCode },
    { label: 'Reset starter code', hint: 'Restore language template', action: resetStarterCode },
    { label: 'Toggle theme', hint: isLightTheme ? 'Switch to dark mode' : 'Switch to light mode', action: toggleTheme },
    { label: 'Toggle focus mode', hint: 'Hide extra panels around the editor', action: () => setIsFocusMode((currentValue) => !currentValue) },
    { label: 'Toggle AI panel', hint: isAssistantOpen ? 'Collapse assistant' : 'Show assistant', action: () => setIsAssistantOpen((currentValue) => !currentValue) },
    { label: 'Open console', hint: 'Switch mobile layout to runtime', action: () => setActiveMobilePanel('console') },
    { label: 'Open assistant', hint: 'Switch mobile layout to AI tools', action: () => setActiveMobilePanel('assistant') },
    { label: 'Sign out', hint: 'Return to the login page', action: handleLogout },
  ];

  const runCommand = (command) => {
    command.action();
    setIsCommandPaletteOpen(false);
    showToast(command.label);
  };

  if (!currentUser) {
    return (
      <div className="ide-container auth-shell" data-theme={theme}>
        <main className="auth-page">
          <section className="auth-panel" aria-label="Account sign in">
            <div className="auth-brand">
              <div className="brand-mark">IDE</div>
              <div>
                <h1>Aether IDE</h1>
                <p>Your intelligent coding workspace</p>
              </div>
            </div>

            {!HAS_SUPABASE_CONFIG && (
              <div className="auth-error" role="alert">
                ⚠ {SUPABASE_CONFIG_ERROR || 'Supabase is not configured for this app.'}
              </div>
            )}

            <div className="auth-mode" role="tablist" aria-label="Account mode">
              <button
                type="button"
                className={authMode === 'login' ? 'is-active' : ''}
                disabled={isAuthLoading}
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                  setAuthSuccess('');
                  setShowAuthPassword(false);
                }}
              >
                Login
              </button>
              <button
                type="button"
                className={authMode === 'signup' ? 'is-active' : ''}
                disabled={isAuthLoading}
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError('');
                  setAuthSuccess('');
                  setShowAuthPassword(false);
                }}
              >
                Create Account
              </button>
            </div>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'signup' && (
                <label>
                  <span>Name <small style={{fontWeight:400, color:'var(--faint)'}}>(optional)</small></span>
                  <input
                    type="text"
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    disabled={isAuthLoading}
                  />
                </label>
              )}
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => { setAuthEmail(event.target.value); setAuthError(''); }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={isAuthLoading}
                  required
                />
              </label>
              <label>
                <span>Password {authMode === 'signup' && <small style={{fontWeight:400, color:'var(--faint)'}}>min 6 chars</small>}</span>
                <div className="auth-password-field">
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    value={authPassword}
                    onChange={(event) => { setAuthPassword(event.target.value); setAuthError(''); }}
                    placeholder={authMode === 'signup' ? 'Create a password' : 'Enter your password'}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    disabled={isAuthLoading}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle ghost-button compact-button"
                    onClick={() => setShowAuthPassword((value) => !value)}
                    disabled={isAuthLoading}
                    aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                  >
                    {showAuthPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
              {authError && (
                <div className="auth-error" role="alert">
                  ⚠ {authError}
                </div>
              )}
              {authSuccess && (
                <div className="auth-success" role="status">
                  ✓ {authSuccess}
                </div>
              )}
              <button type="submit" className="auth-submit" disabled={isAuthLoading}>
                {isAuthLoading
                  ? (authMode === 'signup' ? 'Creating account...' : 'Logging in...')
                  : (authMode === 'signup' ? 'Create Account' : 'Login')
                }
              </button>
            </form>

            <div className="auth-footnote">
              {HAS_SUPABASE_CONFIG
                ? (authMode === 'signup'
                ? 'Your workspace is saved to the cloud and synced across devices.'
                : 'Your code and settings will be restored automatically.'
                )
                : 'Add the Supabase env vars in .env, then restart npm start to enable account login and cloud sync.'
              }
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={`ide-container ${isFocusMode ? 'focus-mode' : ''}`} data-theme={theme}>
      <header className="top-navbar">
        <div className="brand-area">
          <div className="brand-mark">IDE</div>
          <div>
            <h1>Aether IDE</h1>
            <p>Code, run, debug, and learn in one workspace</p>
          </div>
        </div>
        <div className="workspace-summary" aria-label="Workspace summary">
          <span>{activeFile?.name || currentLanguage.label}</span>
          <span>{codeStats.lines} lines</span>
          <span>{statusMessage}</span>
        </div>
        <div className="api-health">
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            className="command-button"
            title="Open command palette"
          >
            Commands <small>Ctrl+K</small>
          </button>
          <span className={isOnline ? 'health-pill is-ok' : 'health-pill is-warn'}>{isOnline ? 'Online' : 'Offline'}</span>
          <span className={hasGroqKey ? 'health-pill is-ok' : 'health-pill is-warn'}>Groq</span>
          <span className={hasCompilerKey ? 'health-pill is-ok' : 'health-pill is-warn'}>Compiler</span>
          <span className="account-pill">{activeAccount?.name || currentUser}</span>
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${isLightTheme ? 'dark' : 'light'} mode`}
            title={`Switch to ${isLightTheme ? 'dark' : 'light'} mode`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">{isLightTheme ? 'L' : 'D'}</span>
            <span>{isLightTheme ? 'Light' : 'Dark'}</span>
          </button>
          <button type="button" onClick={handleLogout} className="ghost-button">
            Logout
          </button>
        </div>
      </header>

      <div className="layout-switch" role="tablist" aria-label="Workspace layout">
        {['editor', 'console', 'assistant'].map((panel) => (
          <button
            key={panel}
            type="button"
            className={activeMobilePanel === panel ? 'is-active' : ''}
            onClick={() => {
              setActiveMobilePanel(panel);
              if (panel === 'assistant') setIsAssistantOpen(true);
            }}
          >
            {panel}
          </button>
        ))}
        <span>Ctrl+K for commands</span>
      </div>

      <main
        className={`main-content ${isExplorerOpen ? '' : 'explorer-collapsed'} ${isAssistantOpen ? '' : 'assistant-collapsed'}`}
        data-active-panel={activeMobilePanel}
        style={{ '--explorer-width': `${explorerWidth}px`, '--assistant-width': `${assistantWidth}px` }}
      >
        <aside id="explorer-panel" className="project-explorer" aria-label="Project explorer">
          <button
            type="button"
            className="panel-resize-handle explorer-resize-handle"
            onMouseDown={(event) => startPanelResize('explorer', event)}
            aria-label="Resize Explorer"
            title="Drag to resize Explorer"
          />
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Project</span>
              <h2>Explorer</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => createFileFromTemplate('javascript')} aria-label="New JavaScript file">
              +
            </button>
          </div>
          <div className="breadcrumb" aria-label="Current workspace">
            {activeAccount?.name || currentUser} / {activeFile?.name || 'main.js'}
          </div>
          <div className="file-tree" role="list">
            {projectFiles.map((file) => (
              <div key={file.id} className={file.id === activeFileId ? 'file-row is-active' : 'file-row'} role="listitem">
                <button
                  type="button"
                  className="file-item"
                  onClick={() => selectFile(file.id)}
                >
                  <span>{file.name}</span>
                  {file.isDirty && <strong aria-label="Unsaved changes">*</strong>}
                </button>
                <button
                  type="button"
                  className="file-delete-button"
                  onClick={() => removeFile(file.id)}
                  disabled={projectFiles.length <= 1}
                  aria-label={`Remove ${file.name}`}
                  title={projectFiles.length <= 1 ? 'Keep at least one file' : `Remove ${file.name}`}
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <div className="shortcut-card" aria-label="Keyboard shortcuts">
            <strong>Shortcuts</strong>
            <span>Ctrl+Enter Run</span>
            <span>Ctrl+K Commands</span>
            <span>Esc Close Palette</span>
          </div>
        </aside>

        <button
          type="button"
          className="side-panel-toggle explorer-toggle"
          onClick={() => setIsExplorerOpen((currentValue) => !currentValue)}
          aria-expanded={isExplorerOpen}
          aria-controls="explorer-panel"
        >
          {isExplorerOpen ? 'Hide Explorer' : 'Show Explorer'}
        </button>

        <section className="left-section" aria-label="Editor and console">
          <div className={`status-banner ${statusTone}`} role="status">
            <strong>{statusMessage}</strong>
            <span>{apiStatusText}</span>
          </div>

          <div className="code-area">
            <div className="section-header code-header">
              <div>
                <span className="eyebrow">Editor</span>
                <strong>{activeFile?.name || `main.${currentLanguage.ext}`}{activeFile?.isDirty ? ' *' : ''}</strong>
              </div>
              <div className="toolbar">
                <select value={selectedLanguage} onChange={handleLanguageChange} className="language-select">
                  {languageOptions.map((language) => (
                    <option key={language.key} value={language.key}>{language.label}</option>
                  ))}
                </select>
                <div className="editor-options">
                  <button
                    type="button"
                    onClick={() => setIsEditorOptionsOpen((currentValue) => !currentValue)}
                    className="ghost-button"
                    aria-expanded={isEditorOptionsOpen}
                    aria-haspopup="menu"
                  >
                    Options
                  </button>
                  {isEditorOptionsOpen && (
                    <div className="editor-options-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => runEditorOption(resetStarterCode)}>
                        Reset
                      </button>
                      <button type="button" role="menuitem" onClick={() => runEditorOption(copyCode)}>
                        Copy
                      </button>
                      <button type="button" role="menuitem" onClick={() => runEditorOption(downloadCode)}>
                        Save
                      </button>
                      <button type="button" role="menuitem" onClick={() => runEditorOption(() => changeEditorFontSize(-1))}>
                        A-
                      </button>
                      <button type="button" role="menuitem" onClick={() => runEditorOption(() => changeEditorFontSize(1))}>
                        A+
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={() => setIsFocusMode((currentValue) => !currentValue)} className="ghost-button">
                  {isFocusMode ? 'Exit Focus' : 'Focus'}
                </button>
                <button onClick={handleRun} disabled={isRunning || !hasCompilerKey || !code.trim()} className="primary-button" title={!hasCompilerKey ? 'Add compiler API key to run code' : 'Run code'}>
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>

            <div className="file-tabs" role="tablist" aria-label="Open files">
              {projectFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className={file.id === activeFileId ? 'file-tab is-active' : 'file-tab'}
                  onClick={() => selectFile(file.id)}
                >
                  {file.name}{file.isDirty ? ' *' : ''}
                </button>
              ))}
            </div>

            <div className="editor-meta" aria-label="Editor details">
              <span>{currentLanguage.label}</span>
              <span>{codeStats.lines} lines</span>
              <span>{codeStats.characters} chars</span>
              <span>{editorFontSize}px</span>
              <span>Ctrl+Enter runs stdin</span>
              <span>Ctrl+K commands</span>
            </div>

            <CodeMirror
              value={code}
              height="100%"
              extensions={currentLanguage.extension ? [currentLanguage.extension] : []}
              onChange={handleCodeChange}
              className="code-mirror-editor"
              basicSetup={{
                foldGutter: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
              }}
              style={{ '--editor-font-size': `${editorFontSize}px` }}
            />
          </div>

          <div className="console-area">
            <div className="section-header console-header">
              <div>
                <span className="eyebrow">Runtime</span>
                <h2>Console</h2>
              </div>
              <div className="toolbar">
                <span className={`run-state ${consoleState}`}>{consoleState}</span>
                {isRunning && <button onClick={stopRun} className="danger-button">Stop</button>}
                <button onClick={handleRun} disabled={isRunning || !hasCompilerKey || !code.trim()} className="ghost-button">Run again</button>
                <button onClick={copyConsoleOutput} className="ghost-button">Copy</button>
                <button onClick={clearConsole} className="ghost-button">Clear</button>
                <button onClick={handleDebug} disabled={isDebugging || !hasGroqKey || !code.trim()} className="danger-button">
                  {isDebugging ? 'Debugging...' : 'Debug'}
                </button>
              </div>
            </div>
            <div className="console-tabs" role="tablist" aria-label="Console views">
              {['output', 'problems', 'terminal', 'input'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={consoleTab === tab ? 'is-active' : ''}
                  onClick={() => setConsoleTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="console-body">
              <div className="console-content">
                {isRunning && <div className="loading-strip"><span /> Running code...</div>}
                {consoleTab === 'output' && (
                  <pre className={`console-output ${getConsoleTone(consoleOutput, consoleState)}`}>{consoleOutput}</pre>
                )}
                {consoleTab === 'problems' && (
                  <div className="problems-list">
                    {problems.map((problem, index) => (
                      <div key={`${problem}-${index}`} className={problem.startsWith('No problems') ? 'problem-item success' : 'problem-item error'}>
                        {problem}
                      </div>
                    ))}
                  </div>
                )}
                {consoleTab === 'terminal' && (
                  <div className="terminal-history">
                    {consoleHistory.length === 0 && <span>No commands yet. Run code to build history.</span>}
                    {consoleHistory.map((item) => (
                      <div key={item.id}>
                        <strong>{item.time}</strong>
                        <code>{item.command}</code>
                        {item.input && <small>stdin: {item.input}</small>}
                      </div>
                    ))}
                  </div>
                )}
                {consoleTab === 'input' && (
                  <div className="stdin-panel-tab">
                    <div className="stdin-panel-header-tab">
                      <span className="eyebrow">Standard Input</span>
                      <span>Enter input for your program below.</span>
                    </div>
                    <textarea
                      value={consoleInput}
                      onChange={(event) => setConsoleInput(event.target.value)}
                      onKeyDown={handleConsoleInputSubmit}
                      placeholder={'stdin input, for example:\n5\nhello world'}
                      className="console-input"
                      aria-label="Standard input"
                    />
                    <button onClick={handleRun} disabled={isRunning || !hasCompilerKey || !code.trim()} className="console-run-input-button">
                      {isRunning ? 'Running...' : 'Run with Input'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <button
          type="button"
          className="side-panel-toggle assistant-toggle"
          onClick={() => setIsAssistantOpen((currentValue) => !currentValue)}
          aria-expanded={isAssistantOpen}
          aria-controls="assistant-panel"
        >
          {isAssistantOpen ? 'Hide AI' : 'Show AI'}
        </button>

        <aside id="assistant-panel" className="right-section" aria-label="AI assistant">
          <button
            type="button"
            className="panel-resize-handle assistant-resize-handle"
            onMouseDown={(event) => startPanelResize('assistant', event)}
            aria-label="Resize AI panel"
            title="Drag to resize AI panel"
          />
              <div className="chat-section">
                <div className="section-header chat-header">
                  <div>
                    <span className="eyebrow">Assistant</span>
                    <h2>AI Chat</h2>
                  </div>
                  <select
                    value={chatLanguage}
                    onChange={(event) => setChatLanguage(event.target.value)}
                    className="chat-language-select"
                  >
                    <option value="english">English</option>
                    <option value="hindi">Hindi</option>
                    <option value="assamese">Assamese</option>
                    <option value="bengali">Bengali</option>
                    <option value="gujarati">Gujarati</option>
                    <option value="german">German</option>
                    <option value="spanish">Spanish</option>
                    <option value="french">French</option>
                  </select>
                </div>
            {!hasGroqKey && (
              <div className="notice-bar">
                Add REACT_APP_GROQ_API_KEY in .env, restart the server, then AI explain/debug/chat will unlock.
              </div>
            )}
            {isChatLoading && <div className="loading-strip"><span /> Assistant is thinking...</div>}
            <div className="chat-output-area">
              <div className="chat-response" dangerouslySetInnerHTML={renderMarkdown(chatResponse)} />
            </div>
            {assistantSuggestion && (
              <div className="code-suggestion">
                <div className="panel-title-row">
                  <div>
                    <span className="eyebrow">Code Suggestion</span>
                    <strong>Generated snippet</strong>
                  </div>
                  <button type="button" className="primary-button" onClick={applySuggestionToEditor}>Apply</button>
                </div>
                <pre>{assistantSuggestion}</pre>
              </div>
              )}
              <div className="chat-input">
              <textarea
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                onKeyDown={handleSendMessage}
                placeholder="Ask about the current code"
                aria-label="Assistant prompt"
              />
              <button onClick={sendChatMessage} disabled={isChatLoading || !hasGroqKey || !chatMessage.trim()}>
                {isChatLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>

          <div className="explanation-section">
            <div className="section-header">
              <div>
                <span className="eyebrow">Learning</span>
                <h2>Live Code Explanation</h2>
              </div>
              {isExplaining && <span className="saving-indicator">Updating</span>}
            </div>
            {isExplaining && <div className="skeleton-block" aria-label="Loading explanation" />}
            <div className="explanation-content" dangerouslySetInnerHTML={renderMarkdown(codeExplanation)} />
          </div>
        </aside>
      </main>

      <footer className="status-bar">
        <span>{statusMessage}</span>
        <span>{currentLanguage.label}</span>
        <span>{codeStats.lines} lines</span>
        <span>{codeStats.characters} chars</span>
        <span>{codeStats.bytes} bytes</span>
      </footer>

      {isCommandPaletteOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={() => setIsCommandPaletteOpen(false)}>
          <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-palette-header">
              <div>
                <span className="eyebrow">Command Palette</span>
                <h2>Quick actions</h2>
              </div>
              <span>Ctrl+K</span>
            </div>
            <div className="command-list">
              {commandItems.map((command) => (
                <button key={command.label} type="button" onClick={() => runCommand(command)} className="command-item">
                  <span>{command.label}</span>
                  <small>{command.hint}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-message">{toastMessage}</div>}
    </div>
  );
}

export default App;
