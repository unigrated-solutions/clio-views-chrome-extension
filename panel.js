const STORAGE_KEY = "clioTableViews";

function $(id) {
  return document.getElementById(id);
}

function isRestrictedUrl(url) {
  const value = (url || "").toLowerCase();
  return (
    value.startsWith("chrome://") ||
    value.startsWith("chrome-extension://") ||
    value.startsWith("edge://") ||
    value.startsWith("about:") ||
    value.startsWith("view-source:")
  );
}

function showStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text || "";
  el.style.color = isError ? "#b71c1c" : "#2e7d32";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    throw new Error("No active tab found.");
  }
  return tabs[0];
}

function getPageTypeFromUrl(url) {
  const value = (url || "").toLowerCase();
  if (value.includes("#/matters") || value.includes("/matters")) return "matters";
  if (value.includes("#/contacts") || value.includes("/contacts")) return "contacts";
  return "unknown";
}

function getScriptForPageType(pageType) {
  if (pageType === "matters") return "matters.js";
  if (pageType === "contacts") return "contacts.js";
  return null;
}

async function ensurePageScript(tabId, pageType) {
  const file = getScriptForPageType(pageType);
  if (!file) {
    throw new Error("Open a Clio Contacts or Matters page first.");
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file]
  });
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab.id) {
    throw new Error("Active tab has no id.");
  }

  if (isRestrictedUrl(tab.url || "")) {
    throw new Error("This browser page does not allow extension access.");
  }

  const pageType = getPageTypeFromUrl(tab.url || "");
  if (pageType === "unknown") {
    throw new Error("Open a Clio Contacts or Matters page first.");
  }

  await ensurePageScript(tab.id, pageType);

  const response = await chrome.tabs.sendMessage(tab.id, message);

  if (!response) {
    throw new Error(`No response from ${pageType} content script.`);
  }

  return response;
}

async function getStoredViews() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {
    contacts: {},
    matters: {}
  };
}

async function setStoredViews(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

function renderColumns(columns) {
  const container = $("columns");
  container.innerHTML = "";

  if (!columns || !columns.length) {
    container.innerHTML = "<div class='muted'>No columns found.</div>";
    return;
  }

  for (const col of columns) {
    const label = document.createElement("label");
    label.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!col.visible;
    checkbox.dataset.columnName = col.name;

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(" " + col.name));
    container.appendChild(label);
  }
}

function getColumnSelectionFromUI() {
  const checkboxes = Array.from(
    $("columns").querySelectorAll('input[type="checkbox"]')
  );

  const map = {};
  for (const checkbox of checkboxes) {
    map[checkbox.dataset.columnName] = checkbox.checked;
  }
  return map;
}

function renderSavedViews(pageType, storedViews) {
  const select = $("savedViews");
  select.innerHTML = '<option value="">Select saved view</option>';

  const views = storedViews[pageType] || {};
  const names = Object.keys(views).sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

function renderSavedViewsIntoSelect(selectId, pageType, storedViews, placeholderText) {
  const select = $(selectId);
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = placeholderText;
  select.appendChild(placeholder);

  const views = storedViews?.[pageType] || {};
  const names = Object.keys(views).sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

function renderLibraryViewSelectors(storedViews) {
  renderSavedViewsIntoSelect(
    "contactSavedViews",
    "contacts",
    storedViews,
    "Select contact view"
  );

  renderSavedViewsIntoSelect(
    "matterSavedViews",
    "matters",
    storedViews,
    "Select matter view"
  );
}

function setLibraryMode(isLibraryMode) {
  $("librarySection").classList.toggle("hidden", !isLibraryMode);
  $("editorSection").classList.toggle("hidden", isLibraryMode);
}

function setRouteSectionVisible(pageType, isVisible) {
  if (pageType === "matters") {
    const el = $("mattersRouteSection");
    if (el) el.classList.toggle("hidden", !isVisible);
  }

  if (pageType === "contacts") {
    const el = $("contactsRouteSection");
    if (el) el.classList.toggle("hidden", !isVisible);
  }
}

function hideAllRouteSections() {
  setRouteSectionVisible("matters", false);
  setRouteSectionVisible("contacts", false);
}

function parseHashRoute(urlString) {
  const url = new URL(urlString);
  const rawHash = url.hash || "";
  const hashWithoutPound = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const [routePart, queryString = ""] = hashWithoutPound.split("?");

  return {
    route: routePart || "",
    params: new URLSearchParams(queryString)
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getRouteParamsFromUrl(urlString, pageType) {
  const { route, params } = parseHashRoute(urlString);

  if (!route.toLowerCase().includes(`/${pageType}`)) {
    return {};
  }

  const result = {};

  for (const [key, value] of params.entries()) {
    const parsed = safeJsonParse(value);
    result[key] = parsed !== null ? parsed : value;
  }

  return result;
}

function buildHashWithParams(pageType, routeParams = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(routeParams)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object") {
      params.set(key, JSON.stringify(value));
    } else {
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  return qs ? `#/${pageType}?${qs}` : `#/${pageType}`;
}

function buildUpdatedUrlForPageType(savedUrl, pageType, routeParams = {}) {
  let url;
  try {
    url = new URL(savedUrl);
  } catch {
    throw new Error(`Saved ${pageType} view URL is invalid.`);
  }

  url.hash = buildHashWithParams(pageType, routeParams);
  return url.toString();
}

function summarizeRouteParams(routeParams = {}, pageType = "page") {
  const entries = Object.entries(routeParams);

  if (!entries.length) {
    return `No ${pageType} route params detected in current URL.`;
  }

  return entries
    .map(([key, value]) => {
      if (value && typeof value === "object") {
        if ("name" in value && "value" in value) {
          return `${key}: ${value.name} (${value.value})`;
        }

        if ("value" in value) {
          return `${key}: ${value.value}`;
        }

        return `${key}: ${JSON.stringify(value)}`;
      }

      return `${key}: ${String(value)}`;
    })
    .join(" | ");
}

function renderRouteSummary(pageType, routeParams = {}) {
  if (pageType === "matters") {
    const el = $("mattersRouteSummary");
    if (el) {
      el.textContent = summarizeRouteParams(routeParams, "matters");
    }
  }

  if (pageType === "contacts") {
    const el = $("contactsRouteSummary");
    if (el) {
      el.textContent = summarizeRouteParams(routeParams, "contacts");
    }
  }
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return tab;
    }
    await sleep(250);
  }

  throw new Error("Timed out waiting for tab to finish loading.");
}

async function loadColumnsAndViews() {
  const storedViews = await getStoredViews();
  renderLibraryViewSelectors(storedViews);

  let tab;
  try {
    tab = await getActiveTab();
  } catch (error) {
    $("pageInfo").textContent = "Unable to detect active tab.";
    renderColumns([]);
    hideAllRouteSections();
    setLibraryMode(true);
    showStatus(error.message || String(error), true);
    return;
  }

  const tabUrl = tab.url || "";

  if (isRestrictedUrl(tabUrl)) {
    $("pageInfo").textContent = "This browser page does not allow extension access.";
    renderColumns([]);
    hideAllRouteSections();
    setLibraryMode(true);
    showStatus(
      "Open a normal Clio tab to detect columns, or load a saved view from the library.",
      true
    );
    return;
  }

  const pageTypeFromUrl = getPageTypeFromUrl(tabUrl);

  if (pageTypeFromUrl === "unknown") {
    $("pageInfo").textContent = "Not on a Contacts or Matters page.";
    renderColumns([]);
    hideAllRouteSections();
    setLibraryMode(true);
    showStatus("Select a saved contact or matter view to apply.", false);
    return;
  }

  let response;
  try {
    response = await sendToActiveTab({ type: "GET_COLUMNS" });
  } catch (error) {
    $("pageInfo").textContent = "Unable to connect to page.";
    renderColumns([]);
    hideAllRouteSections();
    setLibraryMode(false);
    showStatus(error.message || String(error), true);
    return;
  }

  if (!response?.ok) {
    $("pageInfo").textContent = "Page detected, but table is not ready yet.";
    renderColumns([]);
    hideAllRouteSections();
    setLibraryMode(false);
    showStatus(response?.reason || "Unable to read table.", true);
    return;
  }

  setLibraryMode(false);
  $("pageInfo").textContent = `Page: ${response.pageType}`;
  renderColumns(response.columns);
  renderSavedViews(response.pageType, storedViews);

  if (response.pageType === "matters" || response.pageType === "contacts") {
    const routeParams = getRouteParamsFromUrl(tabUrl, response.pageType);

    setRouteSectionVisible("matters", response.pageType === "matters");
    setRouteSectionVisible("contacts", response.pageType === "contacts");

    renderRouteSummary(response.pageType, routeParams);
  } else {
    hideAllRouteSections();
  }
}

async function saveCurrentSelection() {
  const viewName = $("viewName").value.trim();
  if (!viewName) {
    showStatus("Enter a view name first.", true);
    return;
  }

  let response;
  try {
    response = await sendToActiveTab({ type: "GET_COLUMNS" });
  } catch (error) {
    showStatus(error.message || String(error), true);
    return;
  }

  if (!response?.ok) {
    showStatus(response?.reason || "Unable to detect table.", true);
    return;
  }

  const storedViews = await getStoredViews();
  const pageType = response.pageType;
  const tab = await getActiveTab();
  const tabUrl = tab.url || "";

  const payload = {
    createdAt: new Date().toISOString(),
    columns: getColumnSelectionFromUI(),
    url: tabUrl
  };

  if (pageType === "matters" || pageType === "contacts") {
    payload.routeParams = getRouteParamsFromUrl(tabUrl, pageType);
  }

  if (!storedViews[pageType]) {
    storedViews[pageType] = {};
  }

  storedViews[pageType][viewName] = payload;

  await setStoredViews(storedViews);
  renderSavedViews(pageType, storedViews);
  renderLibraryViewSelectors(storedViews);
  $("savedViews").value = viewName;

  if (pageType === "matters" || pageType === "contacts") {
    renderRouteSummary(pageType, payload.routeParams || {});
  }

  showStatus(`Saved view "${viewName}".`);
}

async function applyStoredViewByType(pageType, viewName) {
  if (!viewName) {
    showStatus("Choose a saved view first.", true);
    return;
  }

  const storedViews = await getStoredViews();
  const view = storedViews?.[pageType]?.[viewName];

  if (!view) {
    showStatus("Saved view not found.", true);
    return;
  }

  const tab = await getActiveTab();
  if (!tab.id) {
    throw new Error("Active tab has no id.");
  }

  if (pageType === "matters") {
    if (!view.url) {
      throw new Error("Saved matter view is missing its Clio URL.");
    }

    const matterRouteParams =
      view.routeParams || getRouteParamsFromUrl(view.url, "matters");

    const newUrl = buildUpdatedUrlForPageType(
      view.url,
      "matters",
      matterRouteParams
    );

    await chrome.tabs.update(tab.id, { url: newUrl });
    await waitForTabComplete(tab.id, 20000);
    await sleep(1500);

    await ensurePageScript(tab.id, "matters");

    const applyResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "APPLY_VIEW",
      columnVisibilityMap: view.columns || {}
    });

    if (!applyResponse?.ok) {
      showStatus(applyResponse?.reason || "Failed to apply matter view.", true);
      return;
    }

    showStatus(`Applied matter view "${viewName}".`);
    await loadColumnsAndViews();
    return;
  }

  if (pageType === "contacts") {
    if (!view.url) {
      throw new Error("Saved contact view is missing its Clio URL.");
    }

    const contactRouteParams =
      view.routeParams || getRouteParamsFromUrl(view.url, "contacts");

    const newUrl = buildUpdatedUrlForPageType(
      view.url,
      "contacts",
      contactRouteParams
    );

    await chrome.tabs.update(tab.id, { url: newUrl });
    await waitForTabComplete(tab.id, 20000);
    await sleep(1500);

    await ensurePageScript(tab.id, "contacts");

    const applyResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "APPLY_VIEW",
      columnVisibilityMap: view.columns || {}
    });

    if (!applyResponse?.ok) {
      showStatus(applyResponse?.reason || "Failed to apply contact view.", true);
      return;
    }

    showStatus(`Applied contact view "${viewName}".`);
    await loadColumnsAndViews();
    return;
  }

  showStatus("Unsupported saved view type.", true);
}

async function applySelectedView() {
  const viewName = $("savedViews").value;
  if (!viewName) {
    showStatus("Choose a saved view first.", true);
    return;
  }

  let response;
  try {
    response = await sendToActiveTab({ type: "GET_COLUMNS" });
  } catch (error) {
    showStatus(error.message || String(error), true);
    return;
  }

  if (!response?.ok) {
    showStatus(response?.reason || "Unable to detect table.", true);
    return;
  }

  try {
    await applyStoredViewByType(response.pageType, viewName);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function applyContactLibraryView() {
  const viewName = $("contactSavedViews").value;
  try {
    await applyStoredViewByType("contacts", viewName);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function applyMatterLibraryView() {
  const viewName = $("matterSavedViews").value;
  try {
    await applyStoredViewByType("matters", viewName);
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function deleteSelectedView() {
  const viewName = $("savedViews").value;
  if (!viewName) {
    showStatus("Choose a saved view first.", true);
    return;
  }

  let response;
  try {
    response = await sendToActiveTab({ type: "GET_COLUMNS" });
  } catch (error) {
    showStatus(error.message || String(error), true);
    return;
  }

  if (!response?.ok) {
    showStatus(response?.reason || "Unable to detect page type.", true);
    return;
  }

  const storedViews = await getStoredViews();
  const pageType = response.pageType;

  if (storedViews?.[pageType]?.[viewName]) {
    delete storedViews[pageType][viewName];
    await setStoredViews(storedViews);
  }

  renderSavedViews(pageType, storedViews);
  renderLibraryViewSelectors(storedViews);
  showStatus(`Deleted view "${viewName}".`);
}

let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadColumnsAndViews();
  }, 300);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PAGE_CHANGED") {
    scheduleRefresh();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  $("refreshColumns").addEventListener("click", loadColumnsAndViews);
  $("saveView").addEventListener("click", saveCurrentSelection);
  $("applyView").addEventListener("click", applySelectedView);
  $("deleteView").addEventListener("click", deleteSelectedView);
  $("applyContactView").addEventListener("click", applyContactLibraryView);
  $("applyMatterView").addEventListener("click", applyMatterLibraryView);

  loadColumnsAndViews();
});