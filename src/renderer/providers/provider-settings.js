import { setActionButtonPresentation } from "../ui/action-button.js";

const capabilityLabels = {
  stream: "流式",
  tools: "工具",
  reasoning: "推理",
  cache: "缓存",
  usage: "Token 对账",
};

export function createProviderSettings(elements, actions) {
  let latestState = null;
  let latestSession = null;
  let category = "international";
  let selectedProfileId = "openai";

  elements.search.addEventListener("input", () => renderCurrent());
  elements.categories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider-category]");
    if (!button) return;
    category = button.dataset.providerCategory;
    const first = filteredProfiles()[0];
    if (first) selectedProfileId = first.profile.id;
    renderCurrent();
  });
  elements.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider-profile]");
    if (!button) return;
    selectedProfileId = button.dataset.providerProfile;
    renderCurrent();
    elements.detail.querySelector("h3")?.focus();
  });
  elements.detail.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-provider-action]");
    if (!button) return;
    const state = selectedState();
    if (!state) return;
    const profileId = state.profile.id;
    const action = button.dataset.providerAction;
    button.disabled = true;
    try {
      if (action === "save-secret" || action === "delete-secret") {
        const fieldId = button.dataset.fieldId;
        const input = elements.detail.querySelector(`[data-secret-input="${fieldId}"]`);
        const result = action === "save-secret"
          ? await actions.saveSecret(profileId, fieldId, input.value)
          : await actions.deleteSecret(profileId, fieldId);
        if (input) input.value = "";
        showMessage(result?.message ?? "凭据状态已更新。");
      } else if (action === "save-endpoint") {
        const endpoint = elements.detail.querySelector("[data-provider-endpoint]").value;
        showMessage(await actions.setEndpoint(profileId, endpoint) ? "端点已保存。" : "请输入有效的 http(s) 完整地址。");
      } else if (action === "save-model") {
        const model = elements.detail.querySelector("[data-provider-model]").value;
        showMessage(await actions.setManualModel(profileId, model) ? "模型 ID 已保存。" : "请输入模型 ID。");
      } else if (action === "test-connection") {
        const result = await actions.testConnection(profileId);
        showMessage(result?.message ?? "连接检查完成。");
      } else if (action === "use-session") {
        const model = state.configuration.selectedModel ?? state.configuration.models[0];
        showMessage(await actions.useForSession(profileId, model) ? "已用于当前会话。" : "当前运行中或配置尚未就绪，未切换。" );
      } else if (action === "save-custom" || action === "save-capabilities") {
        const capabilities = Object.fromEntries(
          [...elements.detail.querySelectorAll("[data-provider-capability]")]
            .map((input) => [input.dataset.providerCapability, input.checked]),
        );
        if (action === "save-custom") {
          const authMode = elements.detail.querySelector("[data-custom-auth]").value;
          await actions.setCustomOptions({ authMode, capabilities });
        } else {
          await actions.setCapabilities(profileId, capabilities);
        }
        showMessage("能力已保存。");
      }
    } catch (cause) {
      showMessage(cause instanceof Error ? cause.message : "操作未完成。");
    } finally {
      button.disabled = false;
    }
  });

  function render(state, session) {
    latestState = state;
    latestSession = session;
    if (!state.providerCatalog.profiles.some((item) => item.profile.id === selectedProfileId)) {
      selectedProfileId = state.providerCatalog.profiles[0]?.profile.id;
    }
    renderCurrent();
  }

  function renderCurrent() {
    if (!latestState) return;
    renderCategories();
    renderList();
    renderDetail();
  }

  function filteredProfiles() {
    const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
    return latestState.providerCatalog.profiles.filter((state) => {
      if (state.profile.category !== category) return false;
      if (!query) return true;
      return [state.profile.label, state.profile.vendor, state.profile.id, state.profile.protocol]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    });
  }

  function renderCategories() {
    elements.categories.replaceChildren();
    for (const item of latestState.providerCatalog.categories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `provider-category${item.id === category ? " active" : ""}`;
      button.dataset.providerCategory = item.id;
      button.setAttribute("aria-pressed", String(item.id === category));
      button.textContent = `${item.label} ${item.count}`;
      elements.categories.append(button);
    }
  }

  function renderList() {
    const profiles = filteredProfiles();
    if (!profiles.some((state) => state.profile.id === selectedProfileId)) selectedProfileId = profiles[0]?.profile.id;
    elements.list.replaceChildren();
    for (const state of profiles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `provider-profile-row${state.profile.id === selectedProfileId ? " active" : ""}`;
      button.dataset.providerProfile = state.profile.id;
      button.setAttribute("aria-current", state.profile.id === selectedProfileId ? "true" : "false");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = state.profile.label;
      const meta = document.createElement("small");
      meta.textContent = state.profile.id;
      copy.append(title, meta);
      const status = document.createElement("span");
      status.className = `provider-state${state.selectable ? " available" : ""}`;
      status.textContent = state.selectable ? "可用" : state.credentialsReady ? "待模型" : "待配置";
      button.append(copy, status);
      elements.list.append(button);
    }
    if (!profiles.length) {
      const empty = document.createElement("p");
      empty.className = "provider-empty";
      empty.textContent = "此分类中没有匹配项。";
      elements.list.append(empty);
    }
  }

  function renderDetail() {
    const state = selectedState();
    elements.detail.replaceChildren();
    if (!state) return;
    const profile = state.profile;
    const heading = document.createElement("div");
    heading.className = "provider-detail-heading";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.tabIndex = -1;
    title.textContent = profile.label;
    const profileStatus = document.createElement("span");
    profileStatus.className = `provider-detail-status${state.selectable ? " available" : ""}`;
    profileStatus.textContent = state.selectable ? "可用" : state.credentialsReady ? "待模型" : "待配置";
    copy.append(title, profileStatus);
    const use = actionButton("用于当前会话", "use-session", "primary-button", { icon: "check", iconOnly: true });
    use.disabled = !state.selectable || latestSession?.status === "running";
    heading.append(copy, use);
    elements.detail.append(heading);

    const credentials = section("凭据");
    for (const field of profile.auth) credentials.body.append(secretField(field, state));
    elements.detail.append(credentials.element);

    const modelSection = section("模型");
    const modelRow = document.createElement("div");
    modelRow.className = "provider-form-row";
    const modelInput = document.createElement("input");
    modelInput.dataset.providerModel = "";
    modelInput.placeholder = "模型 ID";
    modelInput.value = state.configuration.selectedModel ?? "";
    modelInput.setAttribute("aria-label", "模型 ID");
    modelRow.append(modelInput, actionButton("保存模型", "save-model", "quiet-button"), actionButton(
      profile.modelDiscovery.mode === "openai-models" ? "读取模型列表" : "检查配置",
      "test-connection",
      "quiet-button",
      { icon: "refresh", iconOnly: true },
    ));
    modelSection.body.append(modelRow);
    elements.detail.append(modelSection.element);

    if (profile.id === "openai-compatible" || Object.values(profile.capabilities)
      .some((evidence) => evidence === "profile-dependent" || evidence === "manual-unconfirmed")) {
      elements.detail.append(capabilityOptions(state));
    }

    const advanced = document.createElement("details");
    advanced.className = "provider-advanced";
    const summary = document.createElement("summary");
    summary.textContent = "高级";
    const endpointRow = document.createElement("div");
    endpointRow.className = "provider-form-row";
    const endpoint = document.createElement("input");
    endpoint.type = "url";
    endpoint.dataset.providerEndpoint = "";
    endpoint.value = state.configuration.endpoint ?? profile.endpoint.defaultUrl ?? "";
    endpoint.placeholder = profile.endpoint.placeholder;
    endpoint.setAttribute("aria-label", "Provider 完整端点");
    endpointRow.append(endpoint, actionButton("保存端点", "save-endpoint", "quiet-button"));
    const badges = document.createElement("div");
    badges.className = "capability-badges";
    for (const [name, evidence] of Object.entries(profile.capabilities)) {
      const badge = document.createElement("span");
      badge.className = `capability-badge ${evidence}`;
      const enabled = state.enabledCapabilities[name] ? "已启用" : "未启用";
      badge.textContent = `${capabilityLabels[name]} · ${enabled}`;
      badges.append(badge);
    }
    advanced.append(summary, endpointRow, badges);
    elements.detail.append(advanced);
  }

  function secretField(field, state) {
    const row = document.createElement("div");
    row.className = "provider-secret-field";
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "new-password";
    input.placeholder = "输入新值；保存后清空且不回显";
    input.dataset.secretInput = field.id;
    label.append(input);
    const status = document.createElement("span");
    const configured = state.configuredFields.find((item) => item.fieldId === field.id)?.configured;
    status.className = `secret-state${configured ? " configured" : ""}`;
    status.textContent = configured ? "已配置 · 明文不可读取" : "未配置";
    const actionsRow = document.createElement("span");
    actionsRow.className = "row-actions";
    const remove = actionButton("删除", "delete-secret", "quiet-button");
    remove.dataset.fieldId = field.id;
    remove.disabled = !configured;
    const save = actionButton("安全保存", "save-secret", "quiet-button");
    save.dataset.fieldId = field.id;
    save.disabled = !latestState.secrets.encryptionAvailable;
    actionsRow.append(remove, save);
    row.append(label, status, actionsRow);
    return row;
  }

  function capabilityOptions(state) {
    const wrapper = document.createElement("section");
    wrapper.className = "provider-section";
    const title = document.createElement("h4");
    title.textContent = state.profile.id === "openai-compatible" ? "自定义接入" : "能力";
    const note = document.createElement("p");
    note.textContent = state.configuration.selectedModel ? "当前模型" : "默认模型";
    wrapper.append(title, note);
    if (state.profile.id === "openai-compatible") {
      const auth = document.createElement("select");
      auth.dataset.customAuth = "";
      auth.setAttribute("aria-label", "自定义鉴权方式");
      for (const [value, label] of [["bearer", "Bearer"], ["x-api-key", "x-api-key"], ["api-key", "api-key"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        auth.append(option);
      }
      auth.value = state.configuration.customAuthMode ?? "bearer";
      wrapper.append(auth);
    }
    const checks = document.createElement("div");
    checks.className = "custom-capabilities";
    for (const name of ["stream", "tools", "reasoning", "cache", "usage"]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.providerCapability = name;
      input.checked = Boolean(state.enabledCapabilities[name]);
      input.disabled = state.profile.capabilities[name] === "unsupported";
      label.append(input, document.createTextNode(capabilityLabels[name]));
      checks.append(label);
    }
    const action = state.profile.id === "openai-compatible" ? "save-custom" : "save-capabilities";
    wrapper.append(checks, actionButton("保存能力开关", action, "quiet-button"));
    return wrapper;
  }

  function selectedState() {
    return latestState?.providerCatalog.profiles.find((item) => item.profile.id === selectedProfileId);
  }

  function showMessage(message) {
    elements.message.textContent = message;
  }

  return { render };
}

function section(titleText) {
  const element = document.createElement("section");
  element.className = "provider-section";
  const title = document.createElement("h4");
  title.textContent = titleText;
  const body = document.createElement("div");
  body.className = "provider-section-body";
  element.append(title, body);
  return { element, body };
}

function actionButton(label, action, className, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.providerAction = action;
  setActionButtonPresentation(button, label, options);
  return button;
}
