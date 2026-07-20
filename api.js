/* ==========================================================================
   Riksan AI — api.js
   Frontend logic. The Claude API key never touches this file or the browser —
   every request goes to our own serverless endpoint at /api/chat, which
   holds the key server-side on Vercel (see api/chat.js).
   ========================================================================== */

(() => {
  const ENDPOINT = "/api/chat";

  const els = {
    chatScroll:   document.getElementById("chatScroll"),
    messages:     document.getElementById("messages"),
    welcome:      document.getElementById("welcome"),
    form:         document.getElementById("composerForm"),
    input:        document.getElementById("promptInput"),
    sendBtn:      document.getElementById("sendBtn"),
    suggestions:  document.getElementById("suggestions"),
    newChatBtn:   document.getElementById("newChatBtn"),
    historyList:  document.getElementById("historyList"),
    statusDot:    document.getElementById("statusDot"),
    statusText:   document.getElementById("statusText"),
    menuToggle:   document.getElementById("menuToggle"),
    sidebar:      document.getElementById("sidebar"),
    sidebarScrim: document.getElementById("sidebarScrim"),
  };

  /** In-memory conversation state. Riksan AI keeps no server-side history —
   *  the full thread is resent with every request. */
  let thread = [];      // [{ role: 'user' | 'assistant', content: string }]
  let isSending = false;
  let sessions = [];     // [{ id, title, thread }]
  let activeSessionId = null;

  // ------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------
  function init() {
    autoResize();
    bindEvents();
    pingHealth();
    startNewSession(false);
  }

  function bindEvents() {
    els.form.addEventListener("submit", onSubmit);

    els.input.addEventListener("input", () => {
      autoResize();
      els.sendBtn.disabled = els.input.value.trim().length === 0 || isSending;
    });

    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!els.sendBtn.disabled) els.form.requestSubmit();
      }
    });

    els.suggestions.addEventListener("click", (e) => {
      const card = e.target.closest(".suggestion-card");
      if (!card) return;
      els.input.value = card.dataset.prompt;
      els.sendBtn.disabled = false;
      autoResize();
      els.form.requestSubmit();
    });

    els.newChatBtn.addEventListener("click", () => startNewSession(true));

    els.menuToggle?.addEventListener("click", () => els.sidebar.classList.add("open"));
    els.sidebarScrim.addEventListener("click", () => els.sidebar.classList.remove("open"));
  }

  function autoResize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
  }

  // ------------------------------------------------------------------------
  // Health check — lights up the sidebar status pill
  // ------------------------------------------------------------------------
  async function pingHealth() {
    try {
      const res = await fetch(ENDPOINT, { method: "GET" });
      if (res.ok) {
        setStatus("ok", "Terhubung");
      } else {
        setStatus("err", "Kunci API belum diatur");
      }
    } catch {
      setStatus("err", "Tidak dapat terhubung");
    }
  }

  function setStatus(kind, text) {
    els.statusDot.className = "dot " + kind;
    els.statusText.textContent = text;
  }

  // ------------------------------------------------------------------------
  // Sessions (sidebar history) — kept in memory for this tab
  // ------------------------------------------------------------------------
  function startNewSession(focusInput) {
    const session = { id: crypto.randomUUID(), title: "Obrolan baru", thread: [] };
    sessions.unshift(session);
    activeSessionId = session.id;
    thread = session.thread;

    els.messages.innerHTML = "";
    els.welcome.style.display = "";
    els.input.value = "";
    autoResize();
    els.sendBtn.disabled = true;
    renderHistory();
    if (focusInput) els.input.focus();
    els.sidebar.classList.remove("open");
  }

  function renderHistory() {
    if (sessions.length === 0) {
      els.historyList.innerHTML = `<p class="history-empty">Riwayat obrolan Anda akan muncul di sini.</p>`;
      return;
    }
    els.historyList.innerHTML = "";
    sessions.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = "history-item" + (s.id === activeSessionId ? " active" : "");
      btn.textContent = s.title;
      btn.addEventListener("click", () => switchSession(s.id));
      els.historyList.appendChild(btn);
    });
  }

  function switchSession(id) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    activeSessionId = id;
    thread = session.thread;

    els.messages.innerHTML = "";
    els.welcome.style.display = thread.length ? "none" : "";
    thread.forEach((m) => appendMessage(m.role, m.content));
    renderHistory();
    els.sidebar.classList.remove("open");
  }

  // ------------------------------------------------------------------------
  // Sending messages
  // ------------------------------------------------------------------------
  async function onSubmit(e) {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || isSending) return;

    els.welcome.style.display = "none";
    appendMessage("user", text);
    thread.push({ role: "user", content: text });

    const session = sessions.find((s) => s.id === activeSessionId);
    if (session && session.title === "Obrolan baru") {
      session.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
      renderHistory();
    }

    els.input.value = "";
    autoResize();
    els.sendBtn.disabled = true;
    isSending = true;

    const typingEl = appendTyping();

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: thread }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Permintaan gagal (${res.status})`);
      }

      const reply = data.reply || "Maaf, tidak ada jawaban yang diterima.";
      typingEl.remove();
      appendMessage("assistant", reply);
      thread.push({ role: "assistant", content: reply });
      setStatus("ok", "Terhubung");
    } catch (err) {
      typingEl.remove();
      appendMessage("error", err.message || "Terjadi kesalahan. Coba lagi.");
      setStatus("err", "Gangguan koneksi");
    } finally {
      isSending = false;
      els.sendBtn.disabled = els.input.value.trim().length === 0;
    }
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------
  function appendMessage(role, content) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    if (role === "user") {
      avatar.textContent = "Anda";
    } else if (role === "assistant") {
      avatar.innerHTML = `<span class="orb"></span>`;
    } else {
      avatar.innerHTML = `<span class="orb"></span>`;
    }

    const body = document.createElement("div");
    body.className = "msg-body";

    const roleLabel = document.createElement("div");
    roleLabel.className = "msg-role";
    roleLabel.textContent = role === "user" ? "Anda" : role === "assistant" ? "Riksan AI" : "Kesalahan";

    const text = document.createElement("div");
    text.className = "msg-text";
    text.innerHTML = renderMarkdownLite(content);

    body.appendChild(roleLabel);
    body.appendChild(text);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    els.messages.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function appendTyping() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    wrap.innerHTML = `
      <div class="msg-avatar"><span class="orb thinking"></span></div>
      <div class="msg-body">
        <div class="msg-role">Riksan AI</div>
        <div class="typing"><span></span><span></span><span></span></div>
      </div>`;
    els.messages.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function scrollToBottom() {
    els.chatScroll.scrollTo({ top: els.chatScroll.scrollHeight, behavior: "smooth" });
  }

  /** Minimal, dependency-free markdown: escapes HTML first, then supports
   *  fenced code blocks, inline code, bold, and paragraph breaks. */
  function renderMarkdownLite(raw) {
    const escape = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let text = escape(raw);

    text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    const blocks = text.split(/\n{2,}/).map((block) => {
      if (block.startsWith("<pre>")) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    });

    return blocks.join("");
  }

  init();
})();
