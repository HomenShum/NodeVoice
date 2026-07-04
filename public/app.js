const $ = (selector) => document.querySelector(selector);
const state = {
  models: [],
  voiceModels: [],
  nodeModels: [],
  mode: "compare",
};

async function init() {
  await loadModels();
  wireEvents();
  await runCompare();
}

async function loadModels() {
  const res = await fetch("/api/models");
  const payload = await res.json();
  state.models = payload.all;
  state.voiceModels = payload.voice.filter((m) => m.recommendedFor.includes("voice"));
  state.nodeModels = payload.nodeagent.filter((m) => m.recommendedFor.includes("nodeagent"));
  populateSelect($("#voice-model"), state.voiceModels, payload.defaults.voice);
  populateSelect($("#node-model"), state.nodeModels, payload.defaults.nodeagent);
  renderModelNote();
}

function populateSelect(select, models, defaultId) {
  select.innerHTML = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    const prefix = model.bucket === "latest_edge" || model.bucket === "latest_local" ? "LATEST · " : model.bucket === "practical_stable" ? "STABLE · " : "";
    option.textContent = `${prefix}${model.label}`;
    if (model.id === defaultId) option.selected = true;
    select.appendChild(option);
  }
}

function selectedModel(kind) {
  const id = kind === "voice" ? $("#voice-model").value : $("#node-model").value;
  return state.models.find((model) => model.id === id) ?? state.models[0];
}

function renderModelNote() {
  const model = selectedModel("voice");
  $("#voice-model-note").textContent = `${model.ollamaModel} · ${model.parameterSize} · ${model.hardwareTier} · ${model.availability}`;
}

function wireEvents() {
  $("#run-compare").addEventListener("click", () => switchMode("compare"));
  $("#mode-compare").addEventListener("click", () => switchMode("compare"));
  $("#mode-node").addEventListener("click", () => switchMode("node"));
  $("#intake-send").addEventListener("click", handleSend);
  $("#intake-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });
  $("#voice-model").addEventListener("change", renderModelNote);
}

function switchMode(mode) {
  state.mode = mode;
  $("#mode-compare").classList.toggle("active", mode === "compare");
  $("#mode-node").classList.toggle("active", mode === "node");
  const input = $("#intake-input");
  if (mode === "compare") {
    input.placeholder = "Press Run to start the side-by-side comparison demo…";
  } else {
    input.placeholder = "Type a goal for the NodeAgent artifact chain…";
    input.value = "Build a local-first agent room that prevents acknowledgement loops and emits cited artifacts.";
  }
  input.focus();
}

async function handleSend() {
  if (state.mode === "compare") {
    await runCompare();
  } else {
    await runNode($("#intake-input").value.trim());
  }
}

function clearTraces() {
  $("#traces").innerHTML = "";
}

function appendSection(title, badgeClass, badgeText) {
  const root = $("#traces");
  const section = document.createElement("div");
  section.className = "trace-section";
  section.innerHTML = `
    <div class="trace-section-header">
      <h2>${escapeHtml(title)}</h2>
      <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
    </div>
    <div class="trace-lines"></div>
  `;
  root.appendChild(section);
  return section.querySelector(".trace-lines");
}

function appendTraceLine(container, tag, tagClass, actor, text, act, stateSummary) {
  const line = document.createElement("div");
  line.className = "trace-line";
  line.innerHTML = `
    <span class="trace-tag ${tagClass}">${escapeHtml(tag)}</span>
    <span class="trace-actor">${escapeHtml(actor)}</span>
    <span class="trace-text">${escapeHtml(text)}</span>
    ${act ? `<span class="trace-act">${escapeHtml(act)}</span>` : ""}
    ${stateSummary ? `<span class="trace-state">${escapeHtml(stateSummary)}</span>` : ""}
  `;
  container.appendChild(line);
}

function appendArtifact(container, kind, title, body) {
  const el = document.createElement("div");
  el.className = "trace-artifact";
  el.innerHTML = `
    <strong>${escapeHtml(kind)}: ${escapeHtml(title)}</strong>
    <p>${escapeHtml(body)}</p>
  `;
  container.appendChild(el);
}

function appendInfo(text) {
  const root = $("#traces");
  const line = document.createElement("div");
  line.className = "trace-line";
  line.innerHTML = `<span class="trace-tag info">info</span><span class="trace-text">${escapeHtml(text)}</span>`;
  root.appendChild(line);
}

function scrollTracesToBottom() {
  const traces = $("#traces");
  traces.scrollTop = traces.scrollHeight;
}

async function runCompare() {
  clearTraces();
  const payload = {
    target: Number($("#target").value),
    turns: Number($("#turns").value),
    useOllama: $("#use-ollama").checked,
    model: $("#voice-model").value,
  };
  appendInfo("Running comparison demo…");
  const res = await fetch("/compare/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  $("#traces").innerHTML = "";

  const badContainer = appendSection("Bad — raw transcript reaction", "badge-error", "loop risk");
  for (const step of data.bad) {
    appendTraceLine(badContainer, "bad", "bad", `${step.turn}. ${step.actorId}`, step.text, step.speechAct, step.roomStateSummary);
  }

  const goodContainer = appendSection("Good — room-state continuation", "badge-success", "task advances");
  for (const step of data.good) {
    appendTraceLine(goodContainer, "good", "good", `${step.turn}. ${step.actorId}`, step.text, step.speechAct, step.roomStateSummary);
  }

  scrollTracesToBottom();
}

async function runNode(goal) {
  if (!goal) {
    appendInfo("Enter a goal for the NodeAgent.");
    return;
  }
  clearTraces();
  const container = appendSection("NodeAgent artifact chain", "badge-neutral", "running");
  appendTraceLine(container, "node", "node", "user", goal, "goal", "");

  const payload = {
    goal,
    useOllama: $("#use-ollama").checked,
    model: $("#node-model").value,
  };
  const res = await fetch("/nodeagents/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    appendTraceLine(container, "node", "bad", "error", JSON.stringify(data), "error", "");
    scrollTracesToBottom();
    return;
  }
  container.innerHTML = "";
  for (const artifact of data.artifacts) {
    const memo = artifact.kind === "notebook_memo" ? artifact.payload?.markdown ?? "" : "";
    appendArtifact(container, artifact.kind, artifact.title, memo || artifact.title);
  }
  const memo = data.artifacts.find((a) => a.kind === "notebook_memo")?.payload?.markdown ?? "No memo produced.";
  appendTraceLine(container, "node", "node", "memo", memo.slice(0, 200) + (memo.length > 200 ? "…" : ""), "output", "");
  scrollTracesToBottom();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML("afterbegin", `<pre>${escapeHtml(error.stack || error.message || error)}</pre>`);
});
