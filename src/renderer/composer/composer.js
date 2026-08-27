export function createComposer(elements, actions) {
  const updateShortcutHint = () => {
    if (!elements.shortcutHint) return;
    const visible = document.activeElement === elements.input && elements.input.value.trim().length > 0;
    elements.shortcutHint.classList.toggle("hidden", !visible);
  };
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = elements.input.value.trim();
    if (!text) return;
    const accepted = await actions.send(text);
    if (accepted) elements.input.value = "";
    elements.input.focus();
    updateShortcutHint();
  });

  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  elements.input.addEventListener("input", updateShortcutHint);
  elements.input.addEventListener("focus", updateShortcutHint);
  elements.input.addEventListener("blur", updateShortcutHint);
  elements.cancel.addEventListener("click", actions.cancel);
  elements.model.addEventListener("change", () => {
    const separator = elements.model.value.indexOf(":");
    if (separator <= 0 || elements.model.selectedOptions[0]?.disabled) return;
    actions.setModel(elements.model.value.slice(0, separator), elements.model.value.slice(separator + 1));
  });
  elements.permission.addEventListener("change", () => actions.setPermission(elements.permission.value));
  for (const suggestion of document.querySelectorAll("[data-suggestion]")) {
    suggestion.addEventListener("click", () => {
      elements.input.value = suggestion.dataset.suggestion ?? "";
      elements.input.focus();
      updateShortcutHint();
    });
  }

  return {
    currentWorkspaceMode() {
      return elements.workspaceMode?.value ?? "auto";
    },
    currentReviewPolicy() {
      return elements.reviewPolicy?.value ?? "auto";
    },
    render(session, providers = []) {
      const currentValue = `${session.selectedProviderId}:${session.selectedModel}`;
      elements.model.replaceChildren();
      for (const provider of providers.filter((item) => item.available)) {
        for (const model of provider.models) {
          const option = document.createElement("option");
          option.value = `${provider.id}:${model.id}`;
          option.textContent = `${provider.name} · ${model.label.replace(/^Demo · /u, "")}`;
          elements.model.append(option);
        }
      }
      if (![...elements.model.options].some((option) => option.value === currentValue)) {
        const unavailable = document.createElement("option");
        unavailable.value = currentValue;
        unavailable.textContent = `${session.selectedProviderId} · ${session.selectedModel} · 当前不可用`;
        unavailable.disabled = true;
        elements.model.prepend(unavailable);
      }
      elements.model.value = currentValue;
      elements.model.title = elements.model.selectedOptions[0]?.textContent ?? "当前 Provider / 模型不可用";
      elements.permission.value = session.permissionMode;
      if (elements.workspaceMode) {
        elements.workspaceMode.value = elements.workspaceMode.value || "auto";
        elements.workspaceMode.disabled = session.projectAccess?.enabled !== true || session.status === "running";
      }
      if (elements.reviewPolicy) elements.reviewPolicy.disabled = session.status === "running";
      elements.cancel.classList.toggle("hidden", session.status !== "running");
      const sendLabel = session.status === "running" ? "加入队列" : "发送任务";
      elements.sendLabel.textContent = sendLabel;
      elements.send.setAttribute("aria-label", sendLabel);
      elements.send.title = sendLabel;
      elements.send.dataset.tooltip = sendLabel;
      elements.queue.textContent = session.queue.length ? `${session.queue.length} 条任务排队中` : "队列为空";
      updateShortcutHint();
    },
  };
}

export function permissionAccessSelectionForSession(session, permissions = {}) {
  const access = permissions.access ?? {};
  const active = (access.activeRuns ?? []).find((grant) => grant.sessionId === session.id);
  const pending = (access.pendingRuns ?? []).find((grant) => grant.sessionId === session.id);
  const runtime = (access.runtimeSessions ?? []).find((grant) => grant.sessionId === session.id);
  const grant = active ?? pending ?? runtime;
  if (grant?.level === "computer-full") return grant.duration === "runtime" ? "computer-runtime" : "computer-run";
  if (grant?.level === "project-full") return "project-run";
  if (session.projectAccess?.enabled && (access.trustedProjects ?? []).some((root) => samePath(root, session.workingDirectory))) {
    return "project-trusted";
  }
  return "standard";
}

function samePath(left, right) {
  return String(left).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    === String(right).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
}
