# NovaNotes

An AI-powered note-taking app with a built-in AI assistant (**NovaAI**) that can search your notes, analyze files, summarize PDFs, and answer questions in multiple thinking modes.

> Screenshot coming soon — will be added here once available.

---

## Features

- **Smart Note Management** — create, edit, tag, color-code, and pin notes
- **NovaAI Chat Panel** with 3 intelligence modes:
  - **General** — fast, direct answers
  - **Thinking** — step-by-step reasoning
  - **Deep Think** — expert-level, in-depth analysis
- **AI Note Finder (RAG)** — ask in natural language and NovaAI searches your notes for you
- **File Intelligence**:
  - Upload and analyze code files
  - Summarize PDFs (via PDF.js)
  - Search across your notes
- **Domain-Aware Responses** — NovaAI adapts its tone and structure depending on the topic (e.g. medicine vs. software)
- **Dark / Light Theme** with smooth animations and a custom scrollbar
- **Mobile-Friendly** — responsive layout with a collapsible sidebar
- **PWA Support** — installable, works offline-ready via service worker

---

## Tech Stack

**Frontend**
- Vanilla JavaScript, HTML, CSS
- Progressive Web App (manifest + service worker)

**Backend**
- Node.js + Express
- Groq API (llama-3.3-70b-versatile) for AI responses
- Helmet, CORS, and rate limiting for security
- Retry logic for resilient API calls

**Storage**
- Browser localStorage (client-side, no external database required)

---

## Project Structure

DevNotes/
- client/
  - index.html
  - style.css
  - app.js
  - manifest.json
  - sw.js
- backend/
  - server.js
  - package.json
  - routes/ai.js
  - services/aiProvider.js

---

## Getting Started

### Prerequisites
- Node.js installed
- A free Groq API key (console.groq.com)

### Installation

1. Clone the repository
   git clone https://github.com/your-username/NovaNotes.git
   cd NovaNotes

2. Install backend dependencies
   cd backend
   npm install

3. Set up environment variables
   Create a .env file inside the backend/ folder:
   GROQ_API_KEY=your_groq_api_key_here

4. Run the backend server
   npm run dev
   The server will start on http://localhost:5000

5. Open the frontend
   Open client/index.html in your browser (or serve it with a local server, e.g. Live Server on 127.0.0.1:5500)

Note: If you're accessing the Groq API from a region where it's restricted, you may need a VPN during local development.

---

## Roadmap

- Voice notes (record to transcribe to save)
- Action-item extractor from notes
- Code transformer (e.g. Python to Node)
- Docker support
- Cloud deployment

---

## License

This project is open source. Feel free to fork and build on it.

---

## About

Built by a self-taught developer as a portfolio project while learning full-stack development and AI infrastructure engineering.
