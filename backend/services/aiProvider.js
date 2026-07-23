const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = "llama-3.3-70b-versatile";

// Temperature map — mode অনুযায়ী variation
const TEMPERATURE = {
  general: 0.4,   // Fast, focused
  thinking: 0.7,  // More reasoning
  deep: 0.8,      // Creative + analytical
  default: 0.4,
};

async function analyzeWithGroq(systemPrompt, userContext, mode = "default", retries = 3) {
  const temperature = TEMPERATURE[mode] ?? TEMPERATURE.default;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await groq.chat.completions.create({
        model: MODEL,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContext },
        ],
      });
      return response.choices[0].message.content;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      console.log(`Retry ${i + 1}...`);
    }
  }
}

module.exports = { analyzeWithGroq };