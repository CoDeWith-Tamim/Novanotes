const express = require("express");
const router = express.Router();
const { analyzeWithGroq } = require("../services/aiProvider");

// ==========================================
// NovaAI Brain v2.5
// Intent-Aware, Topic-Adaptive Intelligence
// ==========================================

// =====================
// SHARED PERSONA (সব mode এ base হিসেবে কাজ করে)
// =====================
const NOVA_PERSONA = `You are NovaAI, an intelligent assistant inside NovaNotes.

Core principles:
- Prefer accuracy over confidence
- If uncertain, explicitly say so
- Never invent facts or pretend to know something you don't
- Never summarize a file unless the user asks for it
- Adjust explanation depth to match the complexity of the question`;

// =====================
// INTENT DETECTION INSTRUCTION
// =====================
const INTENT_INSTRUCTION = `
Before answering, internally determine:
1. What is the user's intent? (definition, tutorial, comparison, debugging, review, MCQ, summary, translation, general question, note search, etc.)
2. What domain is this? (software/code, science, medicine, math, business, history, creative, general, etc.)
3. What depth does this require? (quick answer, moderate explanation, deep analysis)

Then choose the best response structure for THIS specific question.
Never expose these internal reasoning steps in your answer.
Never force a predefined structure. Let the answer shape itself naturally.
Only use markdown headers if they genuinely improve readability for this specific response.`;

// ==========================================
// CHAT ENDPOINT
// ==========================================
router.post("/chat", async (req, res) => {
  try {
    const { message, mode = "general", notes = [], file = null } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, error: "Message empty" });
    }

    let modeInstruction = "";

    if (mode === "general") {
      modeInstruction = `
Response style: Fast, clear, and direct.
Give the most useful answer without unnecessary elaboration.
If the question is simple — keep the answer simple.
If the question needs a list or code — use it. Otherwise, plain text is fine.`;
    }

    else if (mode === "thinking") {
      modeInstruction = `
Response style: Thoughtful and well-reasoned.
Break down the problem. Think through it step by step.
Show your reasoning clearly but without unnecessary filler.
Give a structured answer that builds understanding, not just facts.`;
    }

    else if (mode === "deep") {
      modeInstruction = `
Response style: Expert-level, deep analysis.
You are a world-class expert in whatever domain this question belongs to.
Go beyond the surface. Identify nuances, edge cases, risks, and non-obvious insights.
If it's code → think like a senior architect.
If it's medicine → think like a clinical expert (always recommend professional consultation).
If it's science → think like a researcher or professor.
If it's business → think like a senior consultant.
Give depth, specificity, and real value. Avoid generic advice.`;
    }

    // Notes context (only if relevant)
    const notesContext = notes.length > 0
      ? `\n\nUser's saved notes (reference only if relevant to the question):\n${JSON.stringify(notes).slice(0, 5000)}`
      : "";

    // File context
    let fileContext = "";
    if (file && file.content) {
      fileContext = `\n\nAttached file — treat as primary context. Analyze only if relevant to the user's request:\n=== FILE: ${file.name} ===\n${file.content.slice(0, 12000)}\n=== END ===`;
    }

    const system = `${NOVA_PERSONA}

${INTENT_INSTRUCTION}

${modeInstruction}${notesContext}${fileContext}`;

    const reply = await analyzeWithGroq(system, message, mode);

    res.json({ success: true, mode, reply });

  } catch (err) {
    console.error("[NovaAI Chat Error]", err.message);
    res.status(500).json({ success: false, error: "NovaAI failed. Please try again." });
  }
});

// ==========================================
// Note Finder — RAG Layer 1
// ==========================================
router.post("/find", async (req, res) => {
  try {
    const { query, notes } = req.body;

    if (!query?.trim()) {
      return res.status(400).json({ success: false, error: "Query cannot be empty" });
    }

    if (!notes || notes.length === 0) {
      return res.json({ success: true, reply: "No notes found. Start writing some notes first!" });
    }

    const system = `${NOVA_PERSONA}

You are NovaAI's note search engine.
Find the most relevant notes matching the user's query.
Search by meaning, not just keywords.

If found: mention the exact Title and ID, give a 1-2 line reason why it matches.
If multiple match: list by relevance.
If nothing matches: say clearly and suggest alternative search terms.`;

    let context = "=== USER'S NOTES ===\n\n";
    notes.forEach((note, i) => {
      context += `[${i + 1}] ID: ${note.id} | Title: ${note.title || "Untitled"} | Tag: ${note.tag || "None"}\n${note.content || "(empty)"}\n---\n`;
    });
    context += `\nSearch Query: ${query}`;

    const reply = await analyzeWithGroq(system, context, "general");
    res.json({ success: true, reply });

  } catch (err) {
    console.error("[AI Find Error]:", err.message);
    res.status(500).json({ success: false, error: "Note search failed." });
  }
});

// ==========================================
// Note Summary
// ==========================================
router.post("/summary", async (req, res) => {
  try {
    const { noteId, notes } = req.body;

    if (!noteId) {
      return res.status(400).json({ success: false, error: "Note ID required" });
    }

    const note = notes?.find((n) => n.id === String(noteId));
    if (!note) {
      return res.status(404).json({ success: false, error: "Note not found" });
    }

    const system = `${NOVA_PERSONA}

Summarize the provided note clearly and concisely.
Extract the key points. Keep it shorter than the original.
Match your format to the content type — use bullet points for facts, code blocks for code, etc.`;

    const context = `Title: ${note.title}\n\nContent:\n${note.content}`;

    const reply = await analyzeWithGroq(system, context, "general");
    res.json({ success: true, reply });

  } catch (err) {
    console.error("[AI Summary Error]:", err.message);
    res.status(500).json({ success: false, error: "Summary generation failed." });
  }
});

module.exports = router;