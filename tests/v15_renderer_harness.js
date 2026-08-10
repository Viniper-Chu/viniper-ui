const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const viewport = String(process.argv[2] || "900x700").split("x").map(Number);
  const width = Number.isFinite(viewport[0]) ? viewport[0] : 900;
  const height = Number.isFinite(viewport[1]) ? viewport[1] : 700;
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true });
  await win.loadFile(path.join(root, "static", "index.html"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
  const source = fs.readFileSync(path.join(root, "static", "app.js"), "utf8");
  await win.webContents.executeJavaScript(
    source
      + "\n;globalThis.__V15_INTERNAL__ = { bindEvents, applySession, loadSessionList, switchSession };\n"
      + ";void 0;\n//# sourceURL=viniper-v15-app.js"
  );

  const runner = async function () {
    const api = globalThis.__VINIPER_TEST_API__;
    const internal = globalThis.__V15_INTERNAL__;
    const calls = [];
    const chatBodies = [];
    const fullPathA = "D:/Viniper/projects/alpha/very-long-working-directory/with-a-complete-readable-path";
    const fullPathB = "D:/Viniper/projects/beta";
    const sessions = {
      A: {
        id: "A", mode: "agent", name: "会话 Alpha", workdir: fullPathA,
        messages: [], runtime_state: "idle", context_usage: {}, revision: "a",
        pinned: false, unread: false
      },
      B: {
        id: "B", mode: "agent", name: "会话 Beta", workdir: fullPathB,
        messages: [], runtime_state: "idle", context_usage: {}, revision: "b",
        pinned: false, unread: false
      }
    };

    const jsonResponse = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload
    });
    const usagePayload = (count) => {
      const days = [];
      for (let index = 0; index < count; index += 1) {
        const stamp = new Date(Date.UTC(2026, 7, 10 - count + index));
        const active = index === count - 1
          ? {
              input_tokens: 8000,
              output_tokens: 3000,
              cache_creation_input_tokens: 1000,
              cache_read_input_tokens: 345,
              total_tokens: 12345,
              run_count: 2
            }
          : (index === Math.max(0, count - 8)
            ? {
                input_tokens: 1200,
                output_tokens: 500,
                cache_creation_input_tokens: 200,
                cache_read_input_tokens: 100,
                total_tokens: 2000,
                run_count: 1
              }
            : {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                total_tokens: 0,
                run_count: 0
              });
        days.push({ date: stamp.toISOString().slice(0, 10), ...active });
      }
      const totals = days.reduce((result, day) => {
        for (const field of [
          "input_tokens",
          "output_tokens",
          "cache_creation_input_tokens",
          "cache_read_input_tokens",
          "total_tokens",
          "run_count"
        ]) result[field] += day[field];
        return result;
      }, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        total_tokens: 0,
        run_count: 0
      });
      return {
        ok: true,
        source: "claude-code-stream-json-local",
        timezone: { name: "Asia/Shanghai", utc_offset: "+08:00" },
        days,
        totals,
        total_tokens: totals.total_tokens,
        run_count: totals.run_count
      };
    };
    window.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = options.method || "GET";
      calls.push({ url: href, method, body: options.body || "" });
      if (href.startsWith("/api/usage/daily")) {
        const count = Number(new URL(href, "http://viniper.local").searchParams.get("days")) || 30;
        return jsonResponse(usagePayload(count));
      }
      if (/\/api\/sessions\/[^/]+\/peers$/.test(href)) {
        return jsonResponse({ ok: true, peer: { available: false, verified: false, targets: [] } });
      }
      if (href === "/api/sessions" && method === "GET") {
        return jsonResponse({ sessions: Object.values(sessions) });
      }
      if (href.startsWith("/api/chat/") && method === "POST") {
        const body = JSON.parse(options.body || "{}");
        chatBodies.push(body);
        const stream = "data: " + JSON.stringify({ type: "text", content: "完成" })
          + "\n\ndata: " + JSON.stringify({ type: "done" }) + "\n\n";
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" }
        });
      }
      const match = href.match(/^\/api\/sessions\/([^/?]+)$/);
      if (match && method === "GET") {
        const session = sessions[decodeURIComponent(match[1])];
        return session ? jsonResponse({ ...session }) : jsonResponse({ detail: "missing" }, 404);
      }
      if (match && method === "PUT") {
        const id = decodeURIComponent(match[1]);
        const update = JSON.parse(options.body || "{}");
        sessions[id] = { ...sessions[id], ...update };
        return jsonResponse({ ok: true, session: sessions[id] });
      }
      if (match && method === "DELETE") {
        const id = decodeURIComponent(match[1]);
        const deleted = Boolean(sessions[id]);
        delete sessions[id];
        return jsonResponse({ ok: true, deleted });
      }
      return jsonResponse({ ok: true });
    };

    api.state.status = {
      version: "5.0.0",
      runtime: { status: "ready", ready: true, capabilities: {} },
      permission_modes: []
    };
    api.state.settings = {
      runtime: {
        enable_auto_mode: false,
        allow_bypass_permissions: false
      }
    };
    api.state.sessionIndex = Object.values(sessions);
    internal.bindEvents();
    internal.applySession("A", sessions.A);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const usagePanel = document.querySelector("#agent-daily-usage");
    const initialUsage = {
      status: usagePanel.dataset.usageStatus,
      actualCells: usagePanel.querySelectorAll(".daily-usage-day:not(.daily-usage-day-blank)").length,
      deepestCells: usagePanel.querySelectorAll(".usage-level-4").length,
      hasBar: Boolean(usagePanel.querySelector(".daily-usage-bar")),
      exactTitle: Array.from(usagePanel.querySelectorAll(".daily-usage-day[title]"))
        .some((item) => item.title.includes("12,345")),
      sourceText: usagePanel.querySelector(".daily-usage-source").textContent.trim(),
      activeDaysText: Array.from(usagePanel.querySelectorAll(".daily-usage-metrics > div"))
        .find((item) => item.textContent.includes("活跃天数"))?.textContent.trim() || "",
      intensities: [
        api.usageIntensity(0, 100),
        api.usageIntensity(20, 100),
        api.usageIntensity(60, 100),
        api.usageIntensity(100, 100)
      ],
      range30Pressed: usagePanel.querySelector('[data-usage-range="30"]').getAttribute("aria-pressed")
    };

    usagePanel.querySelector('[data-usage-range="7"]').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const rangeUsage = {
      range7Pressed: document.querySelector('[data-usage-range="7"]').getAttribute("aria-pressed"),
      actualCells: document.querySelectorAll("#agent-daily-usage .daily-usage-day:not(.daily-usage-day-blank)").length,
      requested7: calls.some((call) => call.url === "/api/usage/daily?days=7")
    };

    const titleButton = document.querySelector("#session-title-button");
    const pathNode = document.querySelector("#workdir-display");
    const headerBefore = {
      hidden: document.querySelector("#agent-session-header").classList.contains("hidden"),
      title: document.querySelector("#session-title").textContent,
      path: pathNode.textContent,
      pathDisplay: getComputedStyle(pathNode).display,
      fullPathTitle: pathNode.title,
      fullPathAria: pathNode.getAttribute("aria-label")
    };
    const rectOf = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerY: rect.top + (rect.height / 2)
      };
    };
    const surfaceBandRect = rectOf("#workspace-mode-bar");
    const tabsRect = rectOf("#view-tabs");
    const headerRect = rectOf("#agent-session-header");
    const mainRect = rectOf("#main");
    const sidebarRect = rectOf("#sidebar");
    const surfaceGeometry = {
      headerParent: document.querySelector("#agent-session-header").parentElement?.id || "",
      tabsParent: document.querySelector("#view-tabs").parentElement?.id || "",
      topbarContainsHeader: document.querySelector("#topbar").contains(document.querySelector("#agent-session-header")),
      sidebarContainsTabs: document.querySelector("#sidebar").contains(document.querySelector("#view-tabs")),
      sameHorizontalBand: Math.abs(tabsRect.centerY - headerRect.centerY) <= 1,
      headerAfterTabs: headerRect.left >= tabsRect.right,
      bandCenterDelta: Math.abs(surfaceBandRect.centerY - headerRect.centerY),
      mainTopDelta: Math.abs(mainRect.top - surfaceBandRect.bottom),
      sidebarTopDelta: Math.abs(sidebarRect.top - surfaceBandRect.bottom),
      headerOverflowsViewport: headerRect.left < 0 || headerRect.right > window.innerWidth
    };
    const pathShortening = {
      windows: api.shortenPath("C:\\Users\\Alice\\work\\project"),
      wsl: api.shortenPath("/home/alice/work/project"),
      other: api.shortenPath("D:/shared/work/project")
    };
    titleButton.click();
    await Promise.resolve();
    const renameClick = {
      modalOpen: !document.querySelector("#rename-session-modal").classList.contains("hidden"),
      inputValue: document.querySelector("#rename-session-name").value,
      putCallsBeforeConfirm: calls.filter((call) => call.method === "PUT").length
    };
    document.querySelector("#cancel-rename-session-btn").click();
    await Promise.resolve();

    const headerMenuButton = document.querySelector("#session-header-menu-button");
    headerMenuButton.click();
    const sharedMenu = document.querySelector("#session-context-menu");
    const headerMenu = {
      open: !sharedMenu.classList.contains("hidden"),
      target: api.state.sessionMenuSessionId,
      expanded: headerMenuButton.getAttribute("aria-expanded"),
      projectLabel: sharedMenu.querySelector('[data-session-action="project"] [data-session-action-label]').textContent,
      icons: sharedMenu.querySelectorAll(".session-menu-icon").length,
      shortcuts: Array.from(sharedMenu.querySelectorAll("kbd")).map((item) => item.textContent.trim())
    };
    api.closeSessionMenu();
    await internal.loadSessionList();
    headerMenuButton.click();
    const headerMenuAfterSessionRender = {
      open: !sharedMenu.classList.contains("hidden"),
      target: api.state.sessionMenuSessionId,
      expanded: headerMenuButton.getAttribute("aria-expanded")
    };
    api.closeSessionMenu();
    const sidebarMore = document.querySelector('.session-more[data-session-menu="A"]');
    sidebarMore.click();
    const sidebarMenu = {
      open: !sharedMenu.classList.contains("hidden"),
      sameElement: sharedMenu === document.querySelector("#session-context-menu"),
      target: api.state.sessionMenuSessionId
    };
    api.closeSessionMenu();

    const openSidebarMenu = async (sessionId) => {
      await internal.loadSessionList();
      const button = document.querySelector(`.session-more[data-session-menu="${sessionId}"]`);
      button.click();
      await Promise.resolve();
    };
    await openSidebarMenu("B");
    await api.executeSessionMenuAction("pin");
    const pinAction = {
      currentSessionId: api.state.sessionId,
      targetPinned: sessions.B.pinned,
      currentPinned: sessions.A.pinned
    };
    await openSidebarMenu("B");
    await api.executeSessionMenuAction("unread");
    const unreadAction = {
      currentSessionId: api.state.sessionId,
      targetUnread: sessions.B.unread,
      currentUnread: sessions.A.unread
    };
    await openSidebarMenu("B");
    const renameActionPromise = api.executeSessionMenuAction("rename");
    await Promise.resolve();
    document.querySelector("#rename-session-name").value = "会话 Beta 已重命名";
    document.querySelector("#confirm-rename-session-btn").click();
    await renameActionPromise;
    const renameAction = {
      currentSessionId: api.state.sessionId,
      targetName: sessions.B.name,
      currentName: sessions.A.name
    };

    await api.openSessionProjectMapping("B");
    const projectMapping = {
      sessionId: api.state.sessionId,
      modalOpen: !document.querySelector("#workdir-modal").classList.contains("hidden"),
      inputValue: document.querySelector("#workdir-input").value
    };
    document.querySelector("#workdir-input").value = `${fullPathB}/mapped-project`;
    document.querySelector("#save-workdir-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    projectMapping.savedWorkdir = sessions.B.workdir;
    projectMapping.currentWorkdir = api.state.workdir;

    api.renderPermissionSelect();
    const permissionOptions = Array.from(document.querySelectorAll("#permission-menu [data-permission-mode]")).map((item) => ({
      id: item.dataset.permissionMode,
      label: item.querySelector("strong").textContent,
      description: item.querySelector("small")?.textContent || "",
      title: item.title
    }));
    api.selectPermissionMode("plan");
    const input = document.querySelector("#user-input");
    input.value = "计划任务";
    await api.sendMessage();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const requests = {
      agent: chatBodies[0],
      chat: api.buildChatRequestBody("chat", "普通消息", "fake", "plan", [{ name: "secret.txt" }])
    };

    await internal.switchSession("A", { quiet: true, history: false });
    await openSidebarMenu("B");
    const deleteActionPromise = api.executeSessionMenuAction("delete");
    await Promise.resolve();
    document.querySelector("#confirm-delete-session-btn").click();
    await deleteActionPromise;
    const menuActions = {
      pin: pinAction,
      unread: unreadAction,
      rename: renameAction,
      delete: {
        currentSessionId: api.state.sessionId,
        targetExists: Boolean(sessions.B),
        currentExists: Boolean(sessions.A)
      },
      putTargets: calls
        .filter((call) => call.method === "PUT")
        .map((call) => ({ url: call.url, body: JSON.parse(call.body || "{}") })),
      deleteTargets: calls.filter((call) => call.method === "DELETE").map((call) => call.url)
    };

    const zeroDays = usagePayload(30).days.map((day) => ({
      ...day,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      total_tokens: 0,
      run_count: 0
    }));
    api.state.dailyUsage = {
      ...api.normalizeDailyUsage({
        ok: true,
        source: "claude-code-stream-json-local",
        timezone: "Asia/Shanghai",
        days: zeroDays
      }),
      rangeDays: 30,
      loadedRangeDays: 30
    };
    api.renderDailyUsagePanel();
    const zeroUsage = {
      guidance: document.querySelector(".daily-usage-empty-guidance").textContent.trim(),
      zeroCells: document.querySelectorAll(".daily-usage-day.usage-level-0:not(.daily-usage-day-blank)").length
    };
    api.state.dailyUsage = {
      ...api.normalizeDailyUsage({}),
      status: "error",
      rangeDays: 30,
      loadedRangeDays: 0
    };
    api.renderDailyUsagePanel();
    const errorUsage = document.querySelector(".daily-usage-error").textContent.trim();

    api.setViewMode("chat");
    const chatHeader = {
      hidden: document.querySelector("#agent-session-header").classList.contains("hidden"),
      bodyMode: document.body.dataset.viewMode
    };
    const tabs = {
      chatIcon: Boolean(document.querySelector("#chat-view-btn .view-tab-icon")),
      agentIcon: Boolean(document.querySelector("#agent-view-btn .view-tab-icon")),
      labels: [
        document.querySelector("#chat-view-btn span").textContent,
        document.querySelector("#agent-view-btn span").textContent
      ]
    };
    const geometry = {
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    };
    return {
      initialUsage,
      rangeUsage,
      zeroUsage,
      errorUsage,
      headerBefore,
      surfaceGeometry,
      pathShortening,
      renameClick,
      headerMenu,
      headerMenuAfterSessionRender,
      sidebarMenu,
      menuActions,
      projectMapping,
      permissionOptions,
      requests,
      chatHeader,
      tabs,
      geometry
    };
  };

  const result = await win.webContents.executeJavaScript(
    "(" + runner.toString() + ")().catch((error) => ({ __harnessError: error && error.stack || String(error) }))"
  );
  process.stdout.write(JSON.stringify(result));
  await win.close();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
