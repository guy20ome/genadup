// ==UserScript==
// @name         genadup Geneanet guided importer
// @namespace    https://github.com/guy20ome/genadup
// @version      0.2.0
// @description  Guided queue for importing Geneanet linked-tree ancestors with "Importer dans mon arbre".
// @match        https://gw.geneanet.org/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "genadup.queue.v1";
  const PANEL_ID = "genadup-panel";

  const state = loadState();
  const current = readCurrentPerson();
  const parents = readParents();

  renderPanel();
  if (state.agent?.running) {
    setTimeout(agentStep, 900);
  }

  function renderPanel() {
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 14px;
          bottom: 14px;
          z-index: 2147483647;
          width: 360px;
          max-width: calc(100vw - 28px);
          color: #1f2933;
          background: #ffffff;
          border: 1px solid #b8c2cc;
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
          font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${PANEL_ID} header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          color: #ffffff;
          background: #0f5f58;
          border-radius: 7px 7px 0 0;
          font-weight: 700;
        }
        #${PANEL_ID} main { padding: 10px 12px 12px; }
        #${PANEL_ID} button {
          border: 1px solid #9aa5b1;
          background: #f5f7fa;
          color: #1f2933;
          border-radius: 6px;
          padding: 6px 8px;
          cursor: pointer;
          font: inherit;
        }
        #${PANEL_ID} button.primary {
          background: #0f5f58;
          border-color: #0f5f58;
          color: #ffffff;
        }
        #${PANEL_ID} button.danger {
          background: #fff5f5;
          border-color: #d64545;
          color: #9b1c1c;
        }
        #${PANEL_ID} .row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        #${PANEL_ID} .muted { color: #52606d; }
        #${PANEL_ID} .status {
          margin-top: 8px;
          padding: 7px 8px;
          background: #eef8f7;
          border: 1px solid #b9e3df;
          border-radius: 6px;
        }
        #${PANEL_ID} .person {
          font-weight: 700;
          margin-bottom: 4px;
        }
        #${PANEL_ID} ul {
          margin: 6px 0 0 18px;
          padding: 0;
          max-height: 90px;
          overflow: auto;
        }
        #${PANEL_ID} textarea {
          width: 100%;
          min-height: 120px;
          box-sizing: border-box;
          margin-top: 8px;
          font: 12px ui-monospace, SFMono-Regular, Consolas, monospace;
        }
      </style>
      <header>
        <span>genadup</span>
        <button type="button" data-action="hide" title="Hide">x</button>
      </header>
      <main>
        <div class="muted">Current person</div>
        <div class="person">${escapeHtml(current.name || "Unknown page")}</div>
        <div class="muted">Parents found: ${parents.length}</div>
        ${parents.length ? `<ul>${parents.map((parent) => `<li>${escapeHtml(parent.name)}</li>`).join("")}</ul>` : ""}
        <div class="muted" style="margin-top:8px">
          Queue: ${state.queue.length} waiting, ${Object.keys(state.done).length} done
        </div>
        <div class="row">
          <button type="button" class="primary" data-action="start">Start/reset here</button>
          <button type="button" class="primary" data-action="agent-start">Run agent</button>
          <button type="button" data-action="agent-stop">Stop</button>
          <button type="button" data-action="import">Open import</button>
          <button type="button" data-action="done">Done + next</button>
          <button type="button" data-action="skip">Skip + next</button>
        </div>
        <div class="row">
          <button type="button" data-action="next">Open next</button>
          <button type="button" data-action="debug">Debug</button>
          <button type="button" data-action="export">Export report</button>
          <button type="button" class="danger" data-action="clear">Clear queue</button>
        </div>
        <div data-output></div>
      </main>
    `;

    panel.addEventListener("click", onPanelClick);
    document.body.append(panel);
  }

  function onPanelClick(event) {
    const action = event.target?.closest("[data-action]")?.dataset?.action;
    if (!action) return;

    if (action === "hide") document.getElementById(PANEL_ID)?.remove();
    if (action === "start") startHere();
    if (action === "agent-start") startAgent();
    if (action === "agent-stop") stopAgent("Agent stopped.");
    if (action === "import") openImport();
    if (action === "done") finishCurrent("imported");
    if (action === "skip") finishCurrent("skipped");
    if (action === "next") openNext();
    if (action === "debug") showDebug();
    if (action === "export") exportReport();
    if (action === "clear") clearQueue();
  }

  function startHere() {
    state.queue = [{ ...current, generation: 0, relation: "start" }];
    state.done = {};
    state.current = null;
    state.report = [];
    state.agent = { running: false, autoValidate: false, steps: 0, log: [] };
    saveState();
    openNext();
  }

  function startAgent() {
    const autoValidate = confirm(
      "Let genadup click Geneanet validation buttons automatically?\n\nOK = agent may validate imports.\nCancel = agent opens/imports fields, then stops before final validation."
    );
    state.agent = {
      running: true,
      autoValidate,
      steps: 0,
      log: [],
      currentKey: personKey(location.href),
    };
    saveState();
    agentLog(`Agent started. Auto-validate: ${autoValidate ? "yes" : "no"}.`);
    setTimeout(agentStep, 250);
  }

  function stopAgent(message) {
    state.agent = { ...(state.agent || {}), running: false };
    saveState();
    setStatus(message);
  }

  function agentStep() {
    if (!state.agent?.running) return;
    state.agent.steps = Number(state.agent.steps || 0) + 1;
    state.agent.currentKey = personKey(location.href);
    if (state.agent.steps > 250) {
      stopAgent("Agent stopped after 250 steps to avoid looping.");
      return;
    }

    if (consumeAgentPostValidate()) return;

    const pageUrl = new URL(location.href);
    if (pageUrl.searchParams.has("type")) {
      pageUrl.searchParams.delete("type");
      agentNavigate(pageUrl.href, "Opening person fiche.");
      return;
    }

    if (isGeneanetImportPage()) {
      handleImportPage();
      return;
    }

    const importLink = findImportLink();
    if (importLink) {
      agentLog("Opening import command.");
      activateImportElement(importLink);
      return;
    }

    const plus = findMenuButton("Plus");
    if (plus) {
      agentLog('Opening "Plus" menu.');
      plus.click();
      setTimeout(() => {
        const delayedImportLink = findImportLink();
        if (delayedImportLink) {
          agentLog("Import command found after opening Plus.");
          activateImportElement(delayedImportLink);
        } else {
          stopAgent('Agent stopped: "Plus" opened, but no import command was found.');
        }
      }, 900);
      return;
    }

    stopAgent("Agent stopped: no import command or Plus menu found on this page.");
  }

  function handleImportPage() {
    const importControls = findImportFieldControls();
    if (importControls.length) {
      agentLog(`Clicking ${importControls.length} import field control(s).`);
      for (const control of importControls.slice(0, 20)) {
        control.click();
      }
      setTimeout(agentStep, 900);
      return;
    }

    const validateControl = findValidateControl();
    if (!validateControl) {
      stopAgent("Agent stopped: import page detected, but no field or validation controls were found.");
      return;
    }

    if (!state.agent.autoValidate) {
      stopAgent("Agent paused before final validation. Review Geneanet, then click validation manually or rerun with auto-validation.");
      return;
    }

    state.agent.awaitingPostValidate = {
      person: state.current || current,
      parents,
      url: normalizePersonUrl(location.href),
    };
    saveState();
    agentLog("Clicking validation control.");
    validateControl.click();
  }

  function consumeAgentPostValidate() {
    if (!state.agent?.awaitingPostValidate) return false;
    const imported = state.agent.awaitingPostValidate.person || state.current || current;
    state.agent.awaitingPostValidate = null;
    saveState();
    finishCurrent("agent-imported");
    if (!state.agent?.running) return true;
    setTimeout(agentStep, 1200);
    return true;
  }

  function openImport() {
    setStatus("Looking for Geneanet's import command...");
    state.current = {
      ...current,
      parents,
      openedAt: new Date().toISOString(),
    };
    saveState();

    const pageUrl = new URL(location.href);
    if (pageUrl.searchParams.has("type")) {
      pageUrl.searchParams.delete("type");
      saveState();
      setStatus("Opening the person fiche. When it loads, click Open import again.");
      location.href = pageUrl.href;
      return;
    }

    const importLink = findImportLink();
    if (importLink) {
      activateImportElement(importLink);
      return;
    }

    const plus = findMenuButton("Plus");
    if (plus) {
      plus.click();
      setStatus('Opened "Plus"; looking for the import entry...');
      setTimeout(() => {
        const delayedImportLink = findImportLink();
        if (delayedImportLink) {
          activateImportElement(delayedImportLink);
        } else {
          setStatus(
            'I opened "Plus" but did not find an import command. Open "Importer dans mon arbre" manually, then use Done + next.'
          );
        }
      }, 900);
      return;
    }

    setStatus(
      'Could not find "Plus" or an import command on this page. Open "Importer dans mon arbre" manually, then use Done + next.'
    );
  }

  function finishCurrent(status) {
    const imported = state.current || { ...current, parents };
    const key = personKey(imported.url);
    state.done[key] = true;
    state.report.push({
      status,
      generation: imported.generation ?? current.generation ?? "",
      name: imported.name,
      url: imported.url,
      parents: (imported.parents || parents).map((parent) => parent.name).join(" | "),
      time: new Date().toISOString(),
    });

    for (const parent of imported.parents || parents) {
      const parentKey = personKey(parent.url);
      if (state.done[parentKey]) continue;
      if (state.queue.some((item) => personKey(item.url) === parentKey)) continue;
      state.queue.push({
        ...parent,
        generation: Number(imported.generation || 0) + 1,
        relation: `parent of ${imported.name}`,
      });
    }

    state.current = null;
    saveState();
    openNext();
  }

  function openNext() {
    while (state.queue.length) {
      const next = state.queue.shift();
      if (state.done[personKey(next.url)]) continue;
      state.current = next;
      saveState();
      location.href = next.url;
      return;
    }
    saveState();
    alert("Queue is empty. Use Export report to save the log.");
    renderPanel();
  }

  function exportReport() {
    const output = document.querySelector(`#${PANEL_ID} [data-output]`);
    output.innerHTML = `<textarea readonly>${escapeHtml(toCsv(state.report))}</textarea>`;
  }

  function showDebug() {
    const output = document.querySelector(`#${PANEL_ID} [data-output]`);
    const candidates = findActionCandidates();
    const debug = {
      version: "0.2.0",
      agent: state.agent || null,
      url: location.href,
      normalizedUrl: normalizePersonUrl(location.href),
      current,
      parents,
      queueLength: state.queue.length,
      doneCount: Object.keys(state.done).length,
      candidates,
    };
    output.innerHTML = `<textarea readonly>${escapeHtml(JSON.stringify(debug, null, 2))}</textarea>`;
  }

  function clearQueue() {
    if (!confirm("Clear the genadup queue and report?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  function readCurrentPerson() {
    const heading = document.querySelector("h1");
    const name =
      cleanText(heading?.textContent).replace(/^(Homme|Femme)\s+/i, "") ||
      cleanText(document.title.split(":")[0]);
    return {
      name,
      url: normalizePersonUrl(location.href),
      generation: state.current?.generation || 0,
      relation: state.current?.relation || "",
    };
  }

  function readParents() {
    const parentHeading = Array.from(document.querySelectorAll("h2, h3")).find((heading) =>
      /^Parents\b/i.test(cleanText(heading.textContent))
    );
    if (!parentHeading) return [];

    const found = [];
    let node = parentHeading.nextElementSibling;
    while (node && !/^H[23]$/i.test(node.tagName)) {
      for (const link of node.querySelectorAll("a[href]")) {
        const url = new URL(link.getAttribute("href"), location.href);
        if (!url.hostname.endsWith("geneanet.org")) continue;
        if (!url.searchParams.has("p") || !url.searchParams.has("n")) continue;
        if (url.searchParams.has("m")) continue;
        const parent = { name: cleanText(link.textContent), url: normalizePersonUrl(url.href) };
        if (!parent.name || found.some((item) => item.url === parent.url)) continue;
        found.push(parent);
      }
      node = node.nextElementSibling;
    }
    return found;
  }

  function findImportLink() {
    return actionElements().find((element) => isImportCandidate(element));
  }

  function findMenuButton(text) {
    return actionElements().find(
      (element) => !element.closest(`#${PANEL_ID}`) && cleanText(element.textContent) === text
    );
  }

  function activateImportElement(element) {
    setStatus(`Opening: ${cleanText(element.textContent) || element.href || "import command"}`);
    if (element.href) {
      location.href = element.href;
      return;
    }
    element.click();
  }

  function actionElements() {
    return Array.from(document.querySelectorAll("a[href], button")).filter(
      (element) => !element.closest(`#${PANEL_ID}`)
    );
  }

  function visibleActionElements() {
    return actionElements().filter((element) => isVisible(element) && !isDisabled(element));
  }

  function isGeneanetImportPage() {
    const text = cleanText(document.body?.textContent || "");
    const url = location.href;
    return (
      /import/i.test(url) ||
      /importer dans (mon|votre|un) arbre/i.test(text) ||
      visibleActionElements().some((element) => isValidationCandidate(element))
    );
  }

  function findImportFieldControls() {
    return visibleActionElements().filter((element) => {
      const label = elementLabel(element);
      if (isValidationCandidate(element)) return false;
      if (isGlobalNavigationImport(element)) return false;
      return /^(importer|copier|ajouter)$/i.test(label) || /importer|copier|ajouter/i.test(label);
    });
  }

  function findValidateControl() {
    return visibleActionElements().find((element) => isValidationCandidate(element));
  }

  function isValidationCandidate(element) {
    const label = elementLabel(element);
    return /^(valider|enregistrer|confirmer|terminer|continuer|importer)$/i.test(label);
  }

  function isGlobalNavigationImport(element) {
    const label = elementLabel(element);
    const href = element.href || "";
    return /gedcom/i.test(label) || /Importer mon arbre \(Gedcom\)/i.test(label) || /\/import/i.test(href);
  }

  function isImportCandidate(element) {
    const text = cleanText(element.textContent);
    const href = element.href || "";
    return (
      /importer.*(mon|votre|un).*arbre/i.test(text) ||
      /copier.*(mon|votre|un).*arbre/i.test(text) ||
      /ajouter.*(mon|votre|un).*arbre/i.test(text) ||
      /importer/i.test(href)
    );
  }

  function findActionCandidates() {
    return actionElements()
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: cleanText(element.textContent),
        href: element.href || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        title: element.getAttribute("title") || "",
        importCandidate: isImportCandidate(element),
      }))
      .filter((item) =>
        /import|importer|copier|copy|ajouter|arbre|plus|lia|lien/i.test(
          `${item.text} ${item.href} ${item.ariaLabel} ${item.title}`
        )
      )
      .slice(0, 80);
  }

  function agentNavigate(url, message) {
    agentLog(message);
    saveState();
    location.href = url;
  }

  function agentLog(message) {
    state.agent = state.agent || { running: false, autoValidate: false, steps: 0, log: [] };
    state.agent.log = state.agent.log || [];
    state.agent.log.push({
      time: new Date().toISOString(),
      url: location.href,
      message,
    });
    state.agent.log = state.agent.log.slice(-40);
    saveState();
    setStatus(`${message}<br><br>${escapeHtml(state.agent.log.map((row) => row.message).slice(-6).join("\n"))}`);
  }

  function setStatus(message) {
    const output = document.querySelector(`#${PANEL_ID} [data-output]`);
    if (!output) return;
    output.innerHTML = `<div class="status">${escapeHtml(message)}</div>`;
  }

  function loadState() {
    try {
      return {
        queue: [],
        done: {},
        current: null,
        report: [],
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
      };
    } catch {
      return { queue: [], done: {}, current: null, report: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function normalizePersonUrl(rawUrl) {
    const url = new URL(rawUrl, location.href);
    url.protocol = "https:";
    if (!url.searchParams.get("lang")) url.searchParams.set("lang", "fr");
    url.searchParams.delete("type");
    return url.href;
  }

  function personKey(rawUrl) {
    const url = new URL(normalizePersonUrl(rawUrl));
    return [
      url.pathname.toLowerCase(),
      (url.searchParams.get("p") || "").toLowerCase(),
      (url.searchParams.get("n") || "").toLowerCase(),
      url.searchParams.get("oc") || "",
    ].join("|");
  }

  function toCsv(rows) {
    const headers = ["status", "generation", "name", "url", "parents", "time"];
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header] || "")).join(",")),
    ].join("\n");
  }

  function csvCell(value) {
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function elementLabel(element) {
    return cleanText(
      [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("alt"),
        element.textContent,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return element.disabled || element.getAttribute("aria-disabled") === "true";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }
})();
