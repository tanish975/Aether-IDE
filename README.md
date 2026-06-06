# Aether IDE 🌌

Aether IDE is a modern, responsive, browser-based coding workspace designed to combine powerful editor capabilities, instant code compilation, and integrated AI assistance into a single unified dashboard.

Designed for developers, learners, and educators, Aether IDE provides everything needed to write, execute, debug, and understand code in real-time.

---

## 🚀 Key Features

- **Intuitive Code Editor**: Powered by CodeMirror 6 with dynamic language syntax highlighting for JavaScript, Python, Java, C++, TypeScript, HTML, CSS, and Markdown.
- **Online Code Compilation**: Connects to the OneCompiler API for compiling and executing 15+ major programming languages (including C, Go, Rust, PHP, Ruby, and Kotlin) directly in-browser.
- **Multi-Line Stdin Support**: Run programs with custom input parameters using the interactive terminal pane.
- **AI Chat Assistant**: Ask programming questions, request refactoring advice, or generate entire code scripts using natural language instructions.
- **Deep Code Explanations**: Features a dedicated background parser that automatically explains your code using simple, readable lists.
- **One-Click AI Debugging**: Feed runtime errors directly into the AI helper to automatically correct, rewrite, and explain the code solution.
- **Command Palette & Focus Mode**: Quick controls (`Ctrl + K`) for custom commands, font resizing, dark/light theme switching, and minimalist focus mode views.

---

## 🛠️ Technology Stack

- **Frontend Core**: React 19, React DOM, and Create React App structure
- **Editor Core**: CodeMirror 6 (`@uiw/react-codemirror` and custom lang-packs)
- **Networking**: Axios Client Integration
- **LLM Reasoning**: Llama-3.1 via Groq API
- **Compilation Engine**: OneCompiler REST API

---

## ⚙️ Setting Up Environment Variables

To activate the compiler and AI features, create a `.env` file in the root of the project:

```env
# Groq API Key for AI features (https://console.groq.com/)
REACT_APP_GROQ_API_KEY=your_groq_api_key_here

# OneCompiler API Key for compiling code (https://rapidapi.com/)
REACT_APP_ONECOMPILER_API_KEY=your_onecompiler_api_key_here
```

> [!NOTE]
> Ensure that both keys are valid. The AI Chat, live explanations, and code execution flows will display instructions in their respective panels if their keys are missing or invalid.

---

## 🏃 Running Aether IDE Locally

Follow these standard commands to get Aether IDE running in your local workspace:

### 1. Install Project Dependencies
Use npm to download and link all required libraries:
```bash
npm install
```

### 2. Launch Development Server
Start the React application dev server:
```bash
npm start
```
After building, the IDE will be accessible locally at `http://localhost:3000`.

### 3. Run Quality Control Tests
Execute component smoke tests to verify interface elements and rendering logic:
```bash
npm test
```

### 4. Compile Production Bundle
Build optimized static assets ready for production deployment:
```bash
npm run build
```

---

## 🎨 Customizable Controls

- **Command Palette**: Trigger using `Ctrl + K` or by clicking the `Commands` button in the navbar.
- **Theme Switching**: Toggle between dark VS Code theme and light workspace theme with a single click.
- **Font Resizing**: Quickly scale code editor size up (`A+`) or down (`A-`) in the editor toolbar.
- **Focus Mode**: Hide extraneous chat and side panels to maximize writing space.
