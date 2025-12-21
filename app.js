// app.js
import { smartSearch } from "./engine/searchEngine.js";
import { formatForAgent } from "./engine/agentFormatter.js";


const input = document.getElementById("input");
const citySelect = document.getElementById("city");
const sendBtn = document.getElementById("send");
const chat = document.getElementById("chat");

if (!input || !sendBtn || !chat) {
  console.error("Missing DOM elements: ensure index.html has #input #send #chat and app.js is loaded as module at the end of body.");
}


sendBtn.addEventListener("click", async () => {
  try {
    chat.textContent = "Searching…";
    const q = input.value || "";
    const city = citySelect ? citySelect.value : "MUM";
    if (!q.trim()) {
      chat.textContent = "Please enter a query (e.g. 'cbc, fbs, hba1c').";
      return;
    }
    const res = await smartSearch({ query: q, city });
    const out = formatForAgent(res);
    chat.textContent = out;
  } catch (e) {
    console.error("Search error", e);
    chat.textContent = "❌ Error while searching. Check console.";
  }
});
