function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPageType() {
  const path = (window.location.pathname || "").toLowerCase();
  const hash = (window.location.hash || "").toLowerCase();
  const full = `${path} ${hash}`;

  if (full.includes("/contacts")) return "contacts";
  return "unknown";
}

function isVisible(el) {
  if (!el) return false;

  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function getKendoGridRoot() {
  const contactTable = document.querySelector("contacts-table");
  const scopedGrid = contactTable?.querySelector(".k-grid");
  if (scopedGrid && isVisible(scopedGrid)) return scopedGrid;

  const grids = Array.from(document.querySelectorAll(".k-grid")).filter(isVisible);
  if (!grids.length) return null;

  grids.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return br.width * br.height - ar.width * ar.height;
  });

  return grids[0];
}

function getKendoGridModel() {
  const root = getKendoGridRoot();
  if (!root) return null;

  const headerRow =
    root.querySelector(".k-grid-header thead tr") ||
    root.querySelector("thead tr");

  if (!headerRow) return null;

  const allHeaderCells = Array.from(headerRow.querySelectorAll("th"));
  const columnHeaders = allHeaderCells.filter((th) => {
    const title = normalizeText(th.getAttribute("data-title") || th.innerText);
    return !!title;
  });

  if (!columnHeaders.length) return null;

  const columns = columnHeaders.map((th, index) => ({
    index,
    absoluteIndex: allHeaderCells.indexOf(th),
    name:
      normalizeText(th.getAttribute("data-title") || th.innerText) ||
      `Column ${index + 1}`,
    visible: window.getComputedStyle(th).display !== "none",
    headerCell: th
  }));

  return {
    root,
    allHeaderCells,
    columnHeaders,
    columns
  };
}

async function waitForContactsGrid(timeoutMs = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const model = getKendoGridModel();
    if (model) return model;
    await sleep(150);
  }

  return null;
}

async function getColumnInfo() {
  const model = await waitForContactsGrid();

  if (!model) {
    return {
      ok: false,
      reason: "Contacts grid did not finish rendering."
    };
  }

  return {
    ok: true,
    pageType: "contacts",
    tableType: "kendo-grid",
    columns: model.columns.map(({ index, absoluteIndex, name, visible }) => ({
      index,
      absoluteIndex,
      name,
      visible
    }))
  };
}

function getHeaderRows(root) {
  const headerTable = root.querySelector(".k-grid-header table");
  if (!headerTable) return [];

  return Array.from(headerTable.querySelectorAll("tr"));
}

function getBodyRows(root) {
  const bodyTable = root.querySelector(".k-grid-content table");
  if (!bodyTable) return [];

  return Array.from(bodyTable.querySelectorAll("tbody tr"));
}

function setCellVisibility(cell, shouldShow) {
  if (!cell) return;
  cell.style.display = shouldShow ? "" : "none";
}

function setColumnVisibilityOnGrid(model, columnVisibilityMap) {
  const headerRows = getHeaderRows(model.root);
  const bodyRows = getBodyRows(model.root);

  if (!headerRows.length || !bodyRows.length) {
    return {
      ok: false,
      reason: "Could not find grid header/body rows."
    };
  }

  model.columns.forEach((column) => {
    const shouldShow = columnVisibilityMap[column.name] !== false;
    const absoluteIndex = column.absoluteIndex;

    headerRows.forEach((row) => {
      const cells = Array.from(row.children);
      setCellVisibility(cells[absoluteIndex], shouldShow);
    });

    bodyRows.forEach((row) => {
      const cells = Array.from(row.children);
      setCellVisibility(cells[absoluteIndex], shouldShow);
    });
  });

  return { ok: true };
}

async function applyView(columnVisibilityMap) {
  const model = await waitForContactsGrid();

  if (!model) {
    return {
      ok: false,
      reason: "Contacts grid did not finish rendering."
    };
  }

  return setColumnVisibilityOnGrid(model, columnVisibilityMap || {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (getPageType() !== "contacts") return;

  (async () => {
    try {
      if (message?.type === "GET_COLUMNS") {
        sendResponse(await getColumnInfo());
        return;
      }

      if (message?.type === "APPLY_VIEW") {
        sendResponse(await applyView(message.columnVisibilityMap || {}));
        return;
      }

      sendResponse({ ok: false, reason: "Unknown message type." });
    } catch (error) {
      sendResponse({
        ok: false,
        reason: error?.message || String(error)
      });
    }
  })();

  return true;
});