
const ENDPOINT = "/feedback/submit";
export const MAX_MESSAGE_LENGTH = 1000;
const RESEND_COOLDOWN_MS = 2000;

export function validateMessage(message) {
  const trimmed = (message ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: "long" };
  return { ok: true, message: trimmed };
}
export function buildReport({ message, path, context, tech }) {
  const report = { message, path, context };
  if (tech) report.tech = tech;
  return Object.freeze(report);
}

export function parseAck(json) {
  return { id: typeof json?.id === "string" ? json.id.slice(0, 64) : null };
}

export function initFeedback(d = document, w = window) {
  const header = d.querySelector("header");
  if (!header || !d.body || typeof d.createElement !== "function") return null;

  const context =
    d.querySelector('meta[name="nownow-feedback-context"]')?.content ??
    new URL(
      d.querySelector('[rel="canonical"]')?.href ?? w.location.href,
    ).pathname;

  const trigger = d.createElement("button");
  trigger.type = "button";
  trigger.className = "feedback-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.textContent = "Feedback";
  header.appendChild(trigger);

  const dialog = d.createElement("dialog");
  dialog.className = "feedback-dialog";
  dialog.setAttribute("aria-labelledby", "feedback-title");
  dialog.innerHTML = `
    <form method="dialog" class="feedback-form" novalidate>
      <h2 id="feedback-title">Something wrong? Tell us.</h2>
      <p class="feedback-note">
        No account or email needed. We send your message, this page, and the
        game version — never your contacts, location, or a screenshot.
      </p>
      <label for="feedback-message">What happened?</label>
      <textarea
        id="feedback-message"
        maxlength="${MAX_MESSAGE_LENGTH}"
        rows="4"
      ></textarea>
      <label class="feedback-tech">
        <input id="feedback-tech" type="checkbox" />
        Include browser &amp; screen details to help us debug
      </label>
      <p id="feedback-status" role="status" aria-live="polite"></p>
      <div class="feedback-actions">
        <button type="button" id="feedback-cancel">Cancel</button>
        <button type="submit" id="feedback-send">Send</button>
      </div>
    </form>
  `;
  d.body.appendChild(dialog);

  const form = dialog.querySelector("form");
  const textarea = dialog.querySelector("#feedback-message");
  const techBox = dialog.querySelector("#feedback-tech");
  const status = dialog.querySelector("#feedback-status");
  const sendBtn = dialog.querySelector("#feedback-send");
  const cancelBtn = dialog.querySelector("#feedback-cancel");
  let sent = false;
  let away = false;

  ["keydown", "keyup"].forEach((type) =>
    dialog.addEventListener(type, (event) => event.stopPropagation()),
  );

  const setAway = (nextAway) => {
    const next = Boolean(nextAway);
    if (away === next) return;
    away = next;
    d.dispatchEvent(new CustomEvent("nownow-feedback", { detail: away }));
  };

  function reset() {
    sent = false;
    status.textContent = "";
    sendBtn.hidden = false;
    sendBtn.disabled = false;
    textarea.hidden = false;
    techBox.parentElement.hidden = false;
    cancelBtn.textContent = "Cancel";
  }

  function open() {
    reset();
    setAway(true);
    dialog.showModal();
    textarea.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
    setAway(false);
  }

  trigger.addEventListener("click", open);
  cancelBtn.addEventListener("click", close);
  dialog.addEventListener("cancel", () => setAway(false));
  dialog.addEventListener("close", () => setAway(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sent) return close();

    const check = validateMessage(textarea.value);
    if (!check.ok) {
      status.textContent =
        check.reason === "empty"
          ? "Type a message before sending."
          : `Keep it under ${MAX_MESSAGE_LENGTH} characters.`;
      return;
    }

    sendBtn.disabled = true;
    status.textContent = "Sending…";
    const report = buildReport({
      message: check.message,
      path: w.location.pathname,
      context,
      tech: techBox.checked
        ? {
            ua: w.navigator.userAgent,
            viewport: `${w.innerWidth}x${w.innerHeight}`,
            lang: w.navigator.language,
          }
        : undefined,
    });

    let failureStatus;
    try {
      const response = await w.fetch(ENDPOINT, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        failureStatus = response.status;
        throw new Error(String(response.status));
      }
      const ack = parseAck(await response.json().catch(() => ({})));
      sent = true;
      status.textContent = ack.id
        ? `Thanks — received (ref ${ack.id}).`
        : "Thanks — received.";
      sendBtn.hidden = true;
      textarea.hidden = true;
      techBox.parentElement.hidden = true;
      cancelBtn.textContent = "Done";
    } catch {
      status.textContent = failureStatus
        ? "Feedback service unavailable. Your draft is saved; try again shortly."
        : "Could not reach feedback service. Your draft is saved; check your connection and retry.";
      setTimeout(() => {
        sendBtn.disabled = false;
      }, RESEND_COOLDOWN_MS);
    }
  });

  return Object.freeze({ open, close });
}

if (typeof document !== "undefined") initFeedback();
