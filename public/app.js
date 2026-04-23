const tabs = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");

const fetchNextBtn = document.getElementById("fetchNextBtn");
const markAllBtn = document.getElementById("markAllBtn");
const copyAllBtn = document.getElementById("copyAllBtn");
const copySelectedBtn = document.getElementById("copySelectedBtn");
const aiScoreBtn = document.getElementById("aiScoreBtn");
const completeBtn = document.getElementById("completeBtn");
const groupInfo = document.getElementById("groupInfo");
const statusEl = document.getElementById("status");

const todoTbody = document.querySelector("#todoTable tbody");
const doneTbody = document.querySelector("#doneTable tbody");

let currentGroupId = null;
let currentGroupItems = [];
let aiScoresByRowId = new Map();

function rowKey(value) {
  return String(value ?? "");
}

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

function decorateLongtekst(markedText) {
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
    <td><div class="text-wrap">${decorateLongtekst(item.longtekst_marked)}</div></td>
  `;
}

function renderGroupedRows(tbody, items) {
  tbody.innerHTML = "";
  const groups = groupByNoresultId(items);

  for (const [_noresultId, groupItems] of groups) {
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
      detailsCell.colSpan = 4;

      const detailsList = document.createElement("div");
      detailsList.className = "details-list";

      detailsList.innerHTML = groupItems
        .slice(1)
        .map(
          (item) => `
            <div class="detail-item">
              <span class="detail-term">${escapeHtml(item.term)}</span>
              <span class="detail-el">${escapeHtml(item.elnummer)}</span>
              <span class="detail-marked text-wrap">${decorateLongtekst(item.longtekst_marked)}</span>
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
  currentGroupItems = items;

  for (const item of items) {
    const tr = document.createElement("tr");
    const ai = aiScoresByRowId.get(rowKey(item.id));
    const scoreValue = Number.isFinite(ai?.score) ? ai.score : "—";
    const scoreReason = ai?.begrunnelse || "Kjør AI-score for å få begrunnelse.";

    tr.innerHTML = `
      <td>${escapeHtml(item.term)}</td>
      <td>${escapeHtml(item.elnummer)}</td>
      <td><div class="text-wrap">${decorateLongtekst(item.longtekst_marked)}</div></td>
      <td><span class="ai-score-badge" title="${escapeHtml(scoreReason)}">${escapeHtml(scoreValue)}</span></td>
      <td>
        <label>
          <input
            type="checkbox"
            class="copy-checkbox"
            data-elnummer="${escapeHtml(item.elnummer)}"
          />
          Velg
        </label>
      </td>
      <td>
        <label>
          <input
            type="checkbox"
            class="complete-checkbox"
            data-row-id="${item.id}"
            ${item.behandlet ? "checked" : ""}
          />
          Ferdig
        </label>
      </td>
    `;

    todoTbody.appendChild(tr);
  }

  const hasRows = items.length > 0;
  markAllBtn.disabled = !hasRows;
  copyAllBtn.disabled = !hasRows;
  copySelectedBtn.disabled = !hasRows;
  aiScoreBtn.disabled = !hasRows;
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
      aiScoresByRowId = new Map();
      groupInfo.textContent = "Ingen flere ubehandlede grupper.";
      renderRows([]);
      await refreshLists();
      return;
    }

    currentGroupId = data.noresult_id;
    aiScoresByRowId = new Map();
    groupInfo.textContent = `Viser noresult_id: ${data.noresult_id}`;
    renderRows(data.items);
    await refreshLists();
  } catch (error) {
    setStatus(`Feil ved henting: ${error.message}`, true);
  }
}

function markAllChecked() {
  const checkboxes = todoTbody.querySelectorAll("input.complete-checkbox");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = true;
  });
}

function getElnummerToCopy(onlySelected = false) {
  const selector = onlySelected
    ? "input.copy-checkbox:checked"
    : "input.copy-checkbox";

  return Array.from(todoTbody.querySelectorAll(selector))
    .map((checkbox) => checkbox.dataset.elnummer)
    .filter((value) => value && value.trim().length > 0);
}

async function copyElnummer(onlySelected = false) {
  const elnummerList = getElnummerToCopy(onlySelected);

  if (elnummerList.length === 0) {
    setStatus(
      onlySelected
        ? "Ingen elnummer valgt for kopiering."
        : "Ingen elnummer å kopiere i aktiv gruppe.",
      true
    );
    return;
  }

  const copyText = elnummerList.join(" ");

  try {
    await navigator.clipboard.writeText(copyText);
    setStatus(`Kopierte ${elnummerList.length} elnummer.`);
  } catch (_error) {
    setStatus("Klarte ikke kopiere til utklippstavle.", true);
  }
}

async function scoreActiveGroupWithAi() {
  if (!Array.isArray(currentGroupItems) || currentGroupItems.length === 0) {
    setStatus("Ingen aktiv gruppe å analysere.", true);
    return;
  }

  try {
    setStatus("Kjører AI-vurdering ...");
    aiScoreBtn.disabled = true;

    const response = await fetch("/api/ai-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: currentGroupItems.map((item) => ({
          id: item.id,
          term: item.term,
          elnummer: item.elnummer,
          longtekst_marked: item.longtekst_marked,
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Ukjent feil");
    }

    aiScoresByRowId = new Map(
      (data.results || []).map((item) => [
        rowKey(item.rowId),
        { score: item.score, begrunnelse: item.begrunnelse },
      ])
    );

    if (aiScoresByRowId.size === 0) {
      setStatus("AI-vurdering fullført, men ingen score ble returnert.", true);
      return;
    }

    renderRows(currentGroupItems);
    setStatus("AI-vurdering fullført.");
  } catch (error) {
    setStatus(`Feil ved AI-vurdering: ${error.message}`, true);
  } finally {
    aiScoreBtn.disabled = currentGroupItems.length === 0;
  }
}

async function completeSelected() {
  if (!currentGroupId) {
    setStatus("Hent en gruppe først.", true);
    return;
  }

  const selectedIds = Array.from(
    todoTbody.querySelectorAll("input.complete-checkbox:checked")
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
copyAllBtn.addEventListener("click", () => copyElnummer(false));
copySelectedBtn.addEventListener("click", () => copyElnummer(true));
aiScoreBtn.addEventListener("click", scoreActiveGroupWithAi);
completeBtn.addEventListener("click", completeSelected);
refreshLists();
