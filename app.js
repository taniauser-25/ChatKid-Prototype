const CONFIG = {
  apiUrl: "http://127.0.0.1:11434/api/chat",
  model: "llama3.2:1b",
  maxHistoryMessages: 8,
};

const BOT_NAME = "ChatKid";

const RESTRICTED_TERMS = [
  "harm","hurt","hurt myself","hurt someone","lonely","alone","bully","bullying","unsafe","dead",
  "worry","worried","scared","afraid","kill","suicide","self harm","die","dying","death","mean",
  "rude","adult content","unfair", "fair","private parts","drugs","drug","weapon","weapons","gun","knife","bomb","abuse",
  "abused","sad","crying","depressed","depression","unsafe","danger","dangerous","fight","fighting","bleeding",
  "blood","touching","bad touch","secret","threat","threaten","angry","mad", "hate", "body","private","inappropriate",
];

const WELCOME_MESSAGE =
  `Hi! I’m ${BOT_NAME}, your friendly chatbot 😊. You can ask me questions and learn new things! ` +
  `If something is important or needs a parent’s help, I’ll let you know and we can ask them together.`;
const state = {
  loading: false,
  pendingUnsafe: null,
  history: [],
  flagged: [],
  userAvatar: "📚",
  particlesEnabled: false,
};

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const moodButtons = Array.from(document.querySelectorAll(".mood-btn"));
const suggestionButtons = Array.from(document.querySelectorAll(".suggestion-btn"));
const avatarButtons = Array.from(document.querySelectorAll(".avatar-btn"));
const unsafePromptEl = document.getElementById("unsafePrompt");
const unsafeTextEl = document.getElementById("unsafeText");
const notifyYesBtn = document.getElementById("notifyYesBtn");
const notifyNoBtn = document.getElementById("notifyNoBtn");
const notifyModalEl = document.getElementById("notifyModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const copyrightYearEl = document.getElementById("copyrightYear");

// ===== Flagged messages UI =====
const flaggedFabEl = document.getElementById("flaggedFab");
const flaggedCountEl = document.getElementById("flaggedCount");
const flaggedModalEl = document.getElementById("flaggedModal");
const flaggedListEl = document.getElementById("flaggedList");
const clearFlaggedBtn = document.getElementById("clearFlaggedBtn");
const closeFlaggedBtn = document.getElementById("closeFlaggedBtn");

const FLAGGED_STORAGE_KEY = "kidsafe_flagged_v1";

const modalTitleEl = notifyModalEl?.querySelector("h2");
const modalTextEl = notifyModalEl?.querySelector("p");
const modalCardEl = notifyModalEl?.querySelector(".modal-card");
const modalIconEl = notifyModalEl?.querySelector(".modal-icon");

copyrightYearEl.textContent = new Date().getFullYear();

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanModelText(text) {
  let cleaned = String(text || "").trim();

  cleaned = cleaned
    .replace(/<\|start_header_id\|>.*?<\|end_header_id\|>/gis, "")
    .replace(/<\|eot_id\|>/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .replace(/^\s*assistant\s*:\s*/i, "")
    .replace(/^\s*ASSISTANT\s*:\s*/i, "")
    .trim();

  if (
    cleaned.startsWith("USER:") ||
    cleaned.startsWith("ASSISTANT:") ||
    cleaned.startsWith("Recent conversation:") ||
    cleaned.startsWith("Sensitive topic:")
  ) {
    return "";
  }

  return cleaned;
}

function addToHistory(role, content) {
  state.history.push({ role, content });

  const maxStored = CONFIG.maxHistoryMessages * 2;
  if (state.history.length > maxStored) {
    state.history = state.history.slice(-maxStored);
  }
}

function getRecentHistory() {
  return state.history.slice(-CONFIG.maxHistoryMessages);
}


// ===== Flagged storage + rendering =====
function loadFlaggedFromStorage() {
  try {
    const raw = localStorage.getItem(FLAGGED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // basic validation
    return parsed
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: String(x.id || ""),
        text: String(x.text || ""),
        term: String(x.term || ""),
        createdAt: Number(x.createdAt || Date.now()),
        status: String(x.status || "pending"),
      }))
      .filter((x) => x.id && x.text && x.term);
  } catch (e) {
    return [];
  }
}

function saveFlaggedToStorage() {
  try {
    localStorage.setItem(FLAGGED_STORAGE_KEY, JSON.stringify(state.flagged));
  } catch (e) {}
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function setFlaggedCount() {
  if (!flaggedCountEl) return;
  const count = state.flagged.length;
  flaggedCountEl.textContent = String(count);
  flaggedCountEl.classList.toggle("hidden", count === 0);
}

function renderFlaggedList() {
  setFlaggedCount();
  if (!flaggedListEl) return;

  if (!state.flagged.length) {
    flaggedListEl.innerHTML = '<div class="flagged-empty">No flagged messages yet.</div>';
    return;
  }

  const statusLabel = {
    pending: "Waiting",
    notified: "Notified",
    "not-notified": "Not notified",
  };

  flaggedListEl.innerHTML = state.flagged
    .map((item) => {
      const status = statusLabel[item.status] || item.status;
      const statusClass = item.status === "notified" ? "status-good" : item.status === "not-notified" ? "status-bad" : "status-pending";

      return `
        <div class="flagged-item">
          <div class="flagged-item-top">
            <span class="flagged-term">${escapeHtml(item.term)}</span>
            <span class="flagged-status ${statusClass}">${escapeHtml(status)}</span>
          </div>
          <div class="flagged-text">${escapeHtml(item.text)}</div>
          <div class="flagged-time">${escapeHtml(formatTime(item.createdAt))}</div>
        </div>
      `;
    })
    .join("");
}

function addFlaggedMessage(text, term) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const item = {
    id,
    text: String(text || "").trim(),
    term: String(term || "").trim(),
    createdAt: Date.now(),
    status: "pending",
  };

  // newest first
  state.flagged.unshift(item);

  // keep list reasonable
  if (state.flagged.length > 100) state.flagged = state.flagged.slice(0, 100);

  saveFlaggedToStorage();
  renderFlaggedList();
  return id;
}

function updateFlaggedStatus(id, status) {
  if (!id) return;
  const idx = state.flagged.findIndex((x) => x.id === id);
  if (idx === -1) return;
  state.flagged[idx].status = status;
  saveFlaggedToStorage();
  renderFlaggedList();
}

function anyModalOpen() {
  const notifyOpen = notifyModalEl && !notifyModalEl.classList.contains("hidden");
  const flaggedOpen = flaggedModalEl && !flaggedModalEl.classList.contains("hidden");
  return Boolean(notifyOpen || flaggedOpen);
}

function showFlaggedModal() {
  if (!flaggedModalEl) return;
  // don't stack modals
  if (notifyModalEl && !notifyModalEl.classList.contains("hidden")) return;

  renderFlaggedList();
  document.body.classList.add("modal-open");
  flaggedModalEl.classList.remove("hidden");
}

function hideFlaggedModal() {
  if (!flaggedModalEl) return;
  flaggedModalEl.classList.add("hidden");
  if (!anyModalOpen()) document.body.classList.remove("modal-open");
}

function clearFlaggedMessages() {
  state.flagged = [];
  saveFlaggedToStorage();
  renderFlaggedList();
}

function findRestrictedTerm(text) {
  const cleaned = normalize(text);

  return (
    RESTRICTED_TERMS.find((term) => {
      const normalizedTerm = normalize(term);
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(\\s|$)`, "i");
      return pattern.test(cleaned);
    }) || null
  );
}

function addMessage(role, content, options = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;

  if (options.warning) {
    bubble.classList.add("warning-bubble");
  }

  if (options.typing) {
    bubble.innerHTML = `
      <div class="label bot-label">
        <img src="Logo.png" alt="Bot Logo" class="bot-logo">
      </div>
      <div class="typing">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    `;
  } else if (role === "assistant") {
    bubble.innerHTML = `
      <div class="label bot-label">
        <img src="Logo.png" alt="Bot Logo" class="bot-logo">
      </div>
      <div>${escapeHtml(content)}</div>
    `;
  } else {
    const avatar = options.avatar || state.userAvatar || "📚";
    bubble.innerHTML = `
    <div class="message-inline user-inline">
      <span class="user-avatar" aria-hidden="true">${escapeHtml(avatar)}</span>
      <span class="user-text"><strong>YOU:</strong> ${escapeHtml(content)}</span>
    </div>
    `;
  }

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  return row;
}

function removeTypingRow() {
  const typing = document.getElementById("typingRow");
  if (typing) typing.remove();
}

function setLoading(isLoading) {
  state.loading = isLoading;
  sendBtn.disabled = isLoading;
  inputEl.disabled = isLoading;

  removeTypingRow();

  if (isLoading) {
    const typingRow = addMessage("assistant", "", { typing: true });
    typingRow.id = "typingRow";
  }
}

function showUnsafePrompt(topic) {
  if (!topic) return;

  unsafeTextEl.textContent =
    `This topic may need help from a trusted grown-up. ` +
    `Do you want me to notify your parents so they can help you with "${topic}"?`;

  unsafePromptEl.classList.remove("hidden");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideUnsafePrompt() {
  unsafePromptEl.classList.add("hidden");
}

function setModalVariant(variant) {
  if (!modalCardEl || !modalIconEl) return;

  modalCardEl.classList.remove("modal-success", "modal-danger");
  modalIconEl.classList.remove("modal-icon-success", "modal-icon-danger");

  if (variant === "success") {
    modalCardEl.classList.add("modal-success");
    modalIconEl.classList.add("modal-icon-success");
  } else if (variant === "danger") {
    modalCardEl.classList.add("modal-danger");
    modalIconEl.classList.add("modal-icon-danger");
  }
}

function showDecisionModal(title, message, variant = "success") {
  if (modalTitleEl) modalTitleEl.textContent = title;
  if (modalTextEl) modalTextEl.textContent = message;

  setModalVariant(variant);

  document.body.classList.add("modal-open");
  notifyModalEl.classList.remove("hidden");
}

function hideNotifyModal() {
  notifyModalEl.classList.add("hidden");
  if (!anyModalOpen()) document.body.classList.remove("modal-open");
}

function clearRestrictedState() {
  state.pendingUnsafe = null;
  hideUnsafePrompt();
}

async function postToModel(messages) {
  let response;

  try {
    response = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.model,
        stream: false,
        messages,
      }),
    });
  } catch (error) {
    throw new Error(
      "I could not reach Ollama. Make sure Ollama is running locally and the model is installed."
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${response.status})${errorText ? `: ${errorText.slice(0, 160)}` : ""}`
    );
  }

  const data = await response.json();
  const text = data?.message?.content?.trim();

  return cleanModelText(text || "");
}

async function callChatApi(userText) {
  const messages = [
    {
      role: "system",
      content:
        `You are ${BOT_NAME}, a friendly chatbot for children. ` +
        `${BOT_NAME} is your name. ` +
        `If someone asks who you are, what your name is, or what ${BOT_NAME} is, say that you are a chatbot named ${BOT_NAME}. ` +
        `Keep responses concise, kind, easy to understand, and safe for kids. ` +
        `Use simple words. Do not include any special tokens, headers, or role labels in your answer.`
    },
    ...getRecentHistory(),
    {
      role: "user",
      content: userText,
    },
  ];

  const text = await postToModel(messages);
  return text || "I could not read a response from the local model.";
}

function setMood(mood) {
  document.body.dataset.mood = mood;
  try {
    localStorage.setItem("kidsafe_mood", mood);
  } catch (e) {}

  moodButtons.forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.mood || "default") === mood);
  });
}

function setAvatar(avatar) {
  state.userAvatar = avatar;
  try {
    localStorage.setItem("kidsafe_avatar", avatar);
  } catch (e) {}

  avatarButtons.forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.avatar || "📚") === avatar);
  });
}

async function sendMessage(textOverride) {
  if (state.loading) return;

  const text = (textOverride ?? inputEl.value).trim();
  if (!text) return;

  hideUnsafePrompt();

  const restricted = findRestrictedTerm(text);

  if (restricted) {
    // Do not add restricted text to chat or history
    const flaggedId = addFlaggedMessage(text, restricted);

    inputEl.value = "";

    state.pendingUnsafe = {
      text,
      topic: restricted,
      flaggedId,
    };

    showUnsafePrompt(restricted);
    inputEl.focus();
    return;
  }

  addMessage("user", text, { avatar: state.userAvatar });
  addToHistory("user", text);
  inputEl.value = "";

  setLoading(true);

  try {
    const reply = await callChatApi(text);
    removeTypingRow();
    hideUnsafePrompt();
    addMessage("assistant", reply);
    addToHistory("assistant", reply);
    clearRestrictedState();
  } catch (error) {
    removeTypingRow();
    const errorMessage = `Sorry — ${error.message}`;
    addMessage("assistant", errorMessage);
    addToHistory("assistant", errorMessage);
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", () => sendMessage());

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});

suggestionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.suggestion || button.textContent || "");
  });
});

notifyYesBtn.addEventListener("click", () => {
  const topic = state.pendingUnsafe?.topic || "this topic";
  const flaggedId = state.pendingUnsafe?.flaggedId;
  clearRestrictedState();

  if (flaggedId) updateFlaggedStatus(flaggedId, "notified");

  showDecisionModal(
    "Parents notified",
    `Parents have been notified about "${topic}".`,
    "success"
  );
});

notifyNoBtn.addEventListener("click", () => {
  const topic = state.pendingUnsafe?.topic || "this topic";
  const flaggedId = state.pendingUnsafe?.flaggedId;
  clearRestrictedState();

  if (flaggedId) updateFlaggedStatus(flaggedId, "not-notified");

  showDecisionModal(
    "Parents not notified",
    `Parents have not been notified about "${topic}". We will avoid this topic for now.`,
    "danger"
  );

  inputEl.focus();
});

closeModalBtn.addEventListener("click", () => {
  hideNotifyModal();
  inputEl.focus();
});

// Click outside will not close the popup; use the Close button.

// ===== Flagged button + modal =====
if (flaggedFabEl) {
  flaggedFabEl.addEventListener("click", () => {
    showFlaggedModal();
  });
}

if (closeFlaggedBtn) {
  closeFlaggedBtn.addEventListener("click", () => {
    hideFlaggedModal();
    inputEl.focus();
  });
}

if (clearFlaggedBtn) {
  clearFlaggedBtn.addEventListener("click", () => {
    clearFlaggedMessages();
  });
}

// ===== Mood selector =====
(function initMood() {
  let mood = "default";
  try {
    mood = localStorage.getItem("kidsafe_mood") || "default";
  } catch (e) {}

  if (!["default", "happy", "sad", "angry", "crying", "confused"].includes(mood)) {
    mood = "default";
  }

  setMood(mood);
})();

moodButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMood(btn.dataset.mood || "default"));
});

// ===== Avatar picker =====
(function initAvatar() {
  let avatar = "📚";
  try {
    avatar = localStorage.getItem("kidsafe_avatar") || "📚";
  } catch (e) {}
  setAvatar(avatar);
})();

avatarButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setAvatar(btn.dataset.avatar || "📚");
  });
});

// ===== Microphone (speech-to-text) =====
let recognition = null;
let listening = false;

function supportsSpeechRecognition() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function ensureRecognition() {
  if (recognition) return recognition;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result?.[0]?.transcript || "";
    if (transcript) {
      inputEl.value = transcript.trim();
    }
    if (result?.isFinal) {
      inputEl.focus();
    }
  };

  recognition.onend = () => {
    listening = false;
    micBtn?.classList.remove("listening");
  };

  recognition.onerror = () => {
    listening = false;
    micBtn?.classList.remove("listening");
  };

  return recognition;
}

if (micBtn) {
  micBtn.addEventListener("click", () => {
    if (!supportsSpeechRecognition()) {
      const msg = "Voice input is not supported in this browser.";
      addMessage("assistant", msg);
      addToHistory("assistant", msg);
      return;
    }

    const rec = ensureRecognition();

    if (listening) {
      listening = false;
      micBtn.classList.remove("listening");
      try {
        rec.stop();
      } catch (e) {}
      return;
    }

    listening = true;
    micBtn.classList.add("listening");
    try {
      rec.start();
    } catch (e) {
      listening = false;
      micBtn.classList.remove("listening");
    }
  });
}

// ===== Particle background =====
(function initParticleBackground() {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let animationId = null;

  const mouse = {
    x: -9999,
    y: -9999,
    radius: 120,
  };

  const particles = [];
  const PARTICLE_COUNT = 70;

  function resizeCanvas() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getParticleStyles() {
    const styles = getComputedStyle(document.body);
    return {
      dot: styles.getPropertyValue("--particle-dot").trim() || "rgba(0, 51, 160, 0.28)",
      line: styles.getPropertyValue("--particle-line").trim() || "rgba(0, 51, 160, 0.08)",
    };
  }

  function createParticle() {
    return {
      x: random(0, width),
      y: random(0, height),
      vx: random(-0.35, 0.35),
      vy: random(-0.35, 0.35),
      size: random(2, 5),
    };
  }

  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      particles.push(createParticle());
    }
  }

  function drawParticle(p, styles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = styles.dot;
    ctx.fill();
  }

  function connectParticles(styles) {
    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = styles.line;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  function updateParticle(p) {
    const dx = mouse.x - p.x;
    const dy = mouse.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < mouse.radius && dist > 0) {
      const force = (mouse.radius - dist) / mouse.radius;
      const angle = Math.atan2(dy, dx);

      p.x -= Math.cos(angle) * force * 2.2;
      p.y -= Math.sin(angle) * force * 2.2;
    } else {
      p.x += p.vx;
      p.y += p.vy;
    }

    if (p.x < -20) p.x = width + 20;
    if (p.x > width + 20) p.x = -20;
    if (p.y < -20) p.y = height + 20;
    if (p.y > height + 20) p.y = -20;
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    if (state.particlesEnabled) {
      const styles = getParticleStyles();

      for (const p of particles) {
        updateParticle(p);
        drawParticle(p, styles);
      }

      connectParticles(styles);
    }

    animationId = requestAnimationFrame(animate);
  }

  window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });

  window.addEventListener("mouseleave", () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    initParticles();
  });

  resizeCanvas();
  initParticles();
  animate();

  window.addEventListener("beforeunload", () => {
    if (animationId) cancelAnimationFrame(animationId);
  });
})();

// Initialize flagged messages
state.flagged = loadFlaggedFromStorage();
renderFlaggedList();

// Show welcome message on screen
addMessage("assistant", WELCOME_MESSAGE);
addToHistory("assistant", WELCOME_MESSAGE);