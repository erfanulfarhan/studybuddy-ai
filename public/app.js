/* StudyBuddy front-end. PDF text is extracted in-browser (pdf.js); everything
   else goes through /api/study, which holds the Gemini key server-side. */
const $ = (id) => document.getElementById(id);
const notes = $("notes"), out = $("out");

// ---- tiny, safe markdown (headings, bold, bullets) ----
function md(t) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const lines = esc(t).split("\n");
  let html = "", inList = false;
  for (let line of lines) {
    const b = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + b(line.replace(/^\s*[-*]\s+/, "")) + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) html += `<h${h[1].length}>${b(h[2])}</h${h[1].length}>`;
      else if (line.trim()) html += `<p>${b(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

const updateCount = () => { $("count").textContent = `${notes.value.length.toLocaleString()} characters`; };
notes.addEventListener("input", updateCount);

function loading(label) { out.innerHTML = `<div class="placeholder"><span class="spin"></span> ${label}</div>`; }
function error(msg) { out.innerHTML = `<div class="msg err">⚠️ ${msg}</div>`; }

async function api(mode, question) {
  const r = await fetch("/api/study", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: notes.value, mode, question }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ---- actions ----
$("sumBtn").onclick = async () => {
  if (!notes.value.trim()) return error("Paste some notes or drop a PDF first.");
  loading("Summarising your notes…");
  try { out.innerHTML = `<div class="prose">${md((await api("summary")).text)}</div>`; }
  catch (e) { error(e.message); }
};

$("askBtn").onclick = async () => {
  const q = $("question").value.trim();
  if (!q) return error("Type a question first.");
  loading("Thinking…");
  try {
    const d = await api("ask", q);
    out.innerHTML = `<div class="prose"><p><strong>Q:</strong> ${q}</p>${md(d.text)}</div>`;
  } catch (e) { error(e.message); }
};
$("question").addEventListener("keydown", (e) => { if (e.key === "Enter") $("askBtn").click(); });

$("quizBtn").onclick = async () => {
  if (!notes.value.trim()) return error("Paste some notes or drop a PDF first.");
  loading("Building your quiz…");
  try { renderQuiz((await api("quiz", 5)).quiz.questions); }
  catch (e) { error(e.message); }
};

function renderQuiz(questions) {
  let answered = 0, score = 0;
  out.innerHTML = `<div class="score" id="score">0 / ${questions.length}</div>` +
    questions.map((q, i) => `
      <div class="q" data-i="${i}">
        <div class="qt">${i + 1}. ${q.q}</div>
        ${q.options.map((o, j) =>
          `<button class="opt" data-q="${i}" data-o="${j}">${String.fromCharCode(65 + j)}. ${o}</button>`
        ).join("")}
        <div class="expl" hidden>💡 ${q.explanation || ""}</div>
      </div>`).join("");

  out.querySelectorAll(".opt").forEach((btn) => {
    btn.onclick = () => {
      const qi = +btn.dataset.q, oi = +btn.dataset.o, q = questions[qi];
      const box = out.querySelector(`.q[data-i="${qi}"]`);
      if (box.dataset.done) return;            // one answer per question
      box.dataset.done = "1";
      box.querySelectorAll(".opt").forEach((b, j) => {
        b.disabled = true;
        if (j === q.answer) b.classList.add("correct");
        else if (j === oi) b.classList.add("wrong");
      });
      box.querySelector(".expl").hidden = false;
      answered++; if (oi === q.answer) score++;
      $("score").textContent = `${score} / ${questions.length}`;
      if (answered === questions.length) {
        const pct = Math.round((score / questions.length) * 100);
        $("score").textContent = `${score} / ${questions.length}  (${pct}%) ` +
          (pct >= 80 ? "🎉 Excellent!" : pct >= 50 ? "👍 Keep going!" : "📚 Review & retry");
      }
    };
  });
}

// ---- PDF drop (pdf.js) ----
const drop = $("drop"), file = $("file");
drop.onclick = () => file.click();
file.onchange = () => file.files[0] && readPdf(file.files[0]);
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readPdf(f); });

async function readPdf(f) {
  if (f.type !== "application/pdf") return error("That's not a PDF.");
  drop.textContent = "📄 Reading " + f.name + "…";
  try {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument(await f.arrayBuffer()).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const c = await (await pdf.getPage(p)).getTextContent();
      text += c.items.map((i) => i.str).join(" ") + "\n";
    }
    notes.value = text.trim(); updateCount();
    drop.textContent = `✅ Loaded ${f.name} (${pdf.numPages} pages) — edit above or hit Summarise`;
  } catch (e) {
    drop.textContent = "📄 Drop a PDF here, or click to choose one";
    error("Couldn't read that PDF: " + e.message);
  }
}
