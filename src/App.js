import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import './App.css';
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
const DEFAULT_CODE = `// Write JavaScript here
console.log("Hello from Aether IDE");`;

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

function App() {
  const groqApiKey = process.env.REACT_APP_GROQ_API_KEY;
  const compilerApiKey = process.env.REACT_APP_ONECOMPILER_API_KEY;
  const codeExplanationTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);

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
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(() => Number(localStorage.getItem('ide-font-size')) || 14);
  const [toastMessage, setToastMessage] = useState('');

  const hasGroqKey = Boolean(groqApiKey && !groqApiKey.includes('your_'));
  const hasCompilerKey = Boolean(compilerApiKey && !compilerApiKey.includes('your_'));
  const currentLanguage = languageConfig[selectedLanguage] || languageConfig.javascript;
  const isLightTheme = theme === 'light';
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

  const quickPrompts = useMemo(() => ([
    'Explain this code',
    'Find edge cases',
    'Improve readability',
  ]), []);

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
    setStatusMessage('Editing');

    if (codeExplanationTimeoutRef.current) {
      clearTimeout(codeExplanationTimeoutRef.current);
    }

    codeExplanationTimeoutRef.current = setTimeout(() => {
      getCodeExplanation(newCode);
    }, 900);
  }, [getCodeExplanation]);

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
    localStorage.setItem('ide-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ide-font-size', String(editorFontSize));
  }, [editorFontSize]);

  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value;
    setSelectedLanguage(nextLanguage);
    setCode(starterCode[nextLanguage] || '');
    setConsoleOutput('Ready. Run your code to see output here.');
    setCodeExplanation('Start editing to generate a short explanation.');
    setStatusMessage(`Switched to ${languageConfig[nextLanguage]?.label || nextLanguage}`);
  };

  const handleRun = useCallback(async () => {
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
      const response = await axios.post(url, payload, { headers, timeout: 30000 });
      setConsoleOutput(formatCompilerOutput(response.data));
      setStatusMessage('Run complete');
    } catch (error) {
      setConsoleOutput(`Error executing code:\n${getErrorMessage(error)}`);
      setStatusMessage('Run failed');
    } finally {
      setIsRunning(false);
    }
  }, [code, compilerApiKey, consoleInput, currentLanguage, formatCompilerOutput, getErrorMessage, hasCompilerKey]);

  useEffect(() => {
    const handleGlobalKeys = (event) => {
      const key = event.key.toLowerCase();

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
        setChatResponse(`AI: Generated ${currentLanguage.label} code and placed it in the editor.`);
        getCodeExplanation(generatedCode);
      } else {
        const aiResponse = await callGroq(
          `You are an AI coding assistant. Respond in ${chatLanguage}.\n\nCurrent language: ${selectedLanguage}\n\nCurrent code:\n\`\`\`\n${code}\n\`\`\`\n\nConsole output:\n\`\`\`\n${consoleOutput}\n\`\`\`\n\nUser question:\n${prompt}`,
        );
        setChatResponse(`AI: ${aiResponse}`);
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

  const downloadCode = () => {
    const fileName = `main.${currentLanguage.ext}`;
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
    showToast(`${fileName} downloaded`);
  };

  const applyQuickPrompt = (prompt) => {
    setChatMessage(prompt);
    setStatusMessage(`Prompt ready: ${prompt}`);
  };

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
    setStatusMessage(`${isLightTheme ? 'Dark' : 'Light'} mode enabled`);
    showToast(`${isLightTheme ? 'Dark' : 'Light'} mode enabled`);
  };

  const changeEditorFontSize = (amount) => {
    setEditorFontSize((currentSize) => Math.min(20, Math.max(12, currentSize + amount)));
    showToast(amount > 0 ? 'Editor text enlarged' : 'Editor text reduced');
  };

  const commandItems = [
    { label: 'Run code', hint: 'Compile and execute', action: handleRun },
    { label: 'Copy code', hint: 'Copy editor contents', action: copyCode },
    { label: 'Save file', hint: `Download main.${currentLanguage.ext}`, action: downloadCode },
    { label: 'Reset starter code', hint: 'Restore language template', action: resetStarterCode },
    { label: 'Toggle theme', hint: isLightTheme ? 'Switch to dark mode' : 'Switch to light mode', action: toggleTheme },
    { label: 'Toggle focus mode', hint: 'Hide extra panels around the editor', action: () => setIsFocusMode((currentValue) => !currentValue) },
    { label: 'Toggle AI panel', hint: isAssistantOpen ? 'Collapse assistant' : 'Show assistant', action: () => setIsAssistantOpen((currentValue) => !currentValue) },
  ];

  const runCommand = (command) => {
    command.action();
    setIsCommandPaletteOpen(false);
    showToast(command.label);
  };

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
          <span>{currentLanguage.label}</span>
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
            Commands
          </button>
          <span className={hasGroqKey ? 'health-pill is-ok' : 'health-pill is-warn'}>Groq</span>
          <span className={hasCompilerKey ? 'health-pill is-ok' : 'health-pill is-warn'}>Compiler</span>
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
        </div>
      </header>

      <main className={`main-content ${isAssistantOpen ? '' : 'assistant-collapsed'}`}>
        <section className="left-section" aria-label="Editor and console">
          <div className="code-area">
            <div className="section-header code-header">
              <div>
                <span className="eyebrow">Editor</span>
                <strong>{`main.${currentLanguage.ext}`}</strong>
              </div>
              <div className="toolbar">
                <select value={selectedLanguage} onChange={handleLanguageChange} className="language-select">
                  {languageOptions.map((language) => (
                    <option key={language.key} value={language.key}>{language.label}</option>
                  ))}
                </select>
                <button onClick={resetStarterCode} className="ghost-button">
                  Reset
                </button>
                <button onClick={copyCode} className="ghost-button">
                  Copy
                </button>
                <button onClick={downloadCode} className="ghost-button">
                  Save
                </button>
                <button onClick={() => changeEditorFontSize(-1)} className="ghost-button compact-button">
                  A-
                </button>
                <button onClick={() => changeEditorFontSize(1)} className="ghost-button compact-button">
                  A+
                </button>
                <button onClick={() => setIsFocusMode((currentValue) => !currentValue)} className="ghost-button">
                  {isFocusMode ? 'Exit Focus' : 'Focus'}
                </button>
                <button onClick={handleRun} disabled={isRunning} className="primary-button">
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              </div>
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
                <h2>Console/Terminal/Output</h2>
              </div>
              <div className="toolbar">
                <span className={`run-state ${consoleState}`}>{consoleState}</span>
                <button onClick={copyConsoleOutput} className="ghost-button">Copy</button>
                <button onClick={clearConsole} className="ghost-button">Clear</button>
                <button onClick={handleDebug} disabled={isDebugging} className="danger-button">
                  {isDebugging ? 'Debugging...' : 'Debug'}
                </button>
              </div>
            </div>
            <pre className="console-output">{consoleOutput}</pre>
            <div className="stdin-panel">
              <textarea
                value={consoleInput}
                onChange={(event) => setConsoleInput(event.target.value)}
                onKeyDown={handleConsoleInputSubmit}
                placeholder="stdin input"
                className="console-input"
              />
              <button onClick={handleRun} disabled={isRunning} className="console-run-input-button">
                {isRunning ? 'Running...' : 'Run with Input'}
              </button>
            </div>
          </div>
        </section>

        <button
          type="button"
          className="assistant-toggle"
          onClick={() => setIsAssistantOpen((currentValue) => !currentValue)}
          aria-expanded={isAssistantOpen}
          aria-controls="assistant-panel"
        >
          {isAssistantOpen ? 'Hide AI' : 'Show AI'}
        </button>

        <aside id="assistant-panel" className="right-section" aria-label="AI assistant">
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
                Add a Groq API key in .env to enable AI replies.
              </div>
            )}
            <div className="chat-response" dangerouslySetInnerHTML={renderMarkdown(chatResponse)} />
            <div className="quick-prompts" aria-label="Quick prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} onClick={() => applyQuickPrompt(prompt)} className="prompt-chip">
                  {prompt}
                </button>
              ))}
            </div>
            <div className="chat-input">
              <textarea
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                onKeyDown={handleSendMessage}
                placeholder="Ask about the current code"
              />
              <button onClick={sendChatMessage} disabled={isChatLoading || !chatMessage.trim()}>
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
