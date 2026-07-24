require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/api/ai", require("./routes/ai"));

app.get("/health", (req, res) => {
  res.json({
    status: "✅ DevNotes Backend Running",
    groq: process.env.GROQ_API_KEY
      ? "🔑 API Key Loaded"
      : "❌ API Key Missing"
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
