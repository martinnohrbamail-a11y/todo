const tabs = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");

const fetchNextBtn = document.getElementById("fetchNextBtn");
const markAllBtn = document.getElementById("markAllBtn");
const completeBtn = document.getElementById("completeBtn");
const groupInfo = document.getElementById("groupInfo");
const statusEl = document.getElementById("status");

const todoTbody = document.querySelector("#todoTable tbody");
const doneTbody = document.querySelector("#doneTable tbody");

let currentGroupId = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c62828" : "#1b5e20";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decorateLongtekst(markedText, _matchedText) {
  const rawText = String(markedText ?? "");

  if (!rawText) {
    return "";
  }

  const markerRegex = /\[\[(.*?)\]\]/g;
  let cursor = 0;
  let result = "";

  for (const match of rawText.matchAll(markerRegex)) {
    const fullMatch = match[0];
    const innerText = match[1] ?? "";
    const startIndex = match.index ?? 0;

    result += escapeHtml(rawText.slice(cursor, startIndex));
    result += `<mark>${escapeHtml(innerText)}</mark>`;
    cursor = startIndex + fullMatch.length;
  }

  result += escapeHtml(rawText.slice(cursor));

  return `<span class="highlighted-longtekst">${result}</span>`;
}

function groupByNoresultId(items) {
  const groups = new Map();

  for (const item of items) {
    const key = String(item.noresult_id);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  return groups;
}

function rowTemplate(item, includeId = true) {
  const noresultCell = includeId ? `<td>${escapeHtml(item.noresult_id)}</td>` : "";

  return `
    ${noresultCell}
    <td>${escapeHtml(item.term)}</td>
    <td>${escapeHtml(item.elnummer)}</td>
    <td><div class="text-wrap">${escapeHtml(item.matched_longtekst)}</div></td>
    <td><div class="text-wrap">${decorateLongtekst(item.longtekst_marked, item.matched_longtekst)}</div></td>
  `;
}

function renderGroupedRows(tbody, items) {
  tbody.innerHTML = "";
  const groups = groupByNoresultId(items);

  for (const [noresultId, groupItems] of groups) {
    const first = groupItems[0];

    const parentRow = document.createElement("tr");
    parentRow.className = "group-row";

    parentRow.innerHTML = rowTemplate(first, true);

    if (groupItems.length > 1) {
      parentRow.classList.add("expandable");
      parentRow.title = "Klikk for å vise/skjule flere elnummer";

      const detailsRow = document.createElement("tr");
      detailsRow.className = "details-row hidden";

      const detailsCell = document.createElement("td");
      detailsCell.colSpan = 5;

      const detailsList = document.createElement("div");
      detailsList.className = "details-list";

      detailsList.innerHTML = groupItems
        .slice(1)
        .map(
          (item) => `
            <div class="detail-item">
              <span class="detail-term">${escapeHtml(item.term)}</span>
              <span class="detail-el">${escapeHtml(item.elnummer)}</span>
              <span class="detail-match text-wrap">${escapeHtml(item.matched_longtekst)}</span>
              <span class="detail-marked text-wrap">${decorateLongtekst(item.longtekst_marked, item.matched_longtekst)}</span>
            </div>
          `
        )
        .join("");

      detailsCell.appendChild(detailsList);
      detailsRow.appendChild(detailsCell);

      parentRow.addEventListener("click", () => {
        const isHidden = detailsRow.classList.contains("hidden");
        detailsRow.classList.toggle("hidden", !isHidden);
        parentRow.classList.toggle("expanded", isHidden);
      });

      tbody.appendChild(parentRow);
      tbody.appendChild(detailsRow);
    } else {
      tbody.appendChild(parentRow);
    }
  }
}

function renderRows(items) {
  todoTbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(item.term)}</td>
      <td>${escapeHtml(item.elnummer)}</td>
      <td><div class="text-wrap">${escapeHtml(item.matched_longtekst)}</div></td>
      <td><div class="text-wrap">${decorateLongtekst(item.longtekst_marked, item.matched_longtekst)}</div></td>
      <td>
        <label>
          <input type="checkbox" data-row-id="${item.id}" ${item.behandlet ? "checked" : ""} />
          Ferdig
        </label>
      </td>
    `;

    todoTbody.appendChild(tr);
  }

  const hasRows = items.length > 0;
  markAllBtn.disabled = !hasRows;
  completeBtn.disabled = !hasRows;
}

async function loadList(behandlet, tbody) {
  const response = await fetch(`/api/items?behandlet=${behandlet}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ukjent feil");
  renderGroupedRows(tbody, data.items);
}

async function refreshLists() {
  try {
    await loadList(true, doneTbody);
  } catch (error) {
    setStatus(`Feil ved henting av lister: ${error.message}`, true);
  }
}

async function fetchNextGroup() {
  setStatus("");
  try {
    const response = await fetch("/api/next-group");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ukjent feil");
    }

    if (data.done) {
      currentGroupId = null;
      groupInfo.textContent = "Ingen flere ubehandlede grupper.";
      renderRows([]);
      await refreshLists();
      return;
    }

    currentGroupId = data.noresult_id;
    groupInfo.textContent = `Viser noresult_id: ${data.noresult_id}`;
    renderRows(data.items);
    await refreshLists();
  } catch (error) {
    setStatus(`Feil ved henting: ${error.message}`, true);
  }
}

function markAllChecked() {
  const checkboxes = todoTbody.querySelectorAll("input[type='checkbox']");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = true;
  });
}

async function completeSelected() {
  if (!currentGroupId) {
    setStatus("Hent en gruppe først.", true);
    return;
  }

  const selectedIds = Array.from(
    todoTbody.querySelectorAll("input[type='checkbox']:checked")
  ).map((checkbox) => Number(checkbox.dataset.rowId));

  if (selectedIds.length === 0) {
    setStatus("Velg minst én rad først.", true);
    return;
  }

  try {
    const response = await fetch("/api/mark-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noresult_id: currentGroupId,
        rowIds: selectedIds,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ukjent feil");
    }

    setStatus("Status oppdatert til behandlet.");
    await fetchNextGroup();
  } catch (error) {
    setStatus(`Feil ved lagring: ${error.message}`, true);
  }
}

function setupTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      tabs.forEach((btn) => btn.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });
}

setupTabs();
fetchNextBtn.addEventListener("click", fetchNextGroup);
markAllBtn.addEventListener("click", markAllChecked);
completeBtn.addEventListener("click", completeSelected);
refreshLists();
