const fetchNextBtn = document.getElementById("fetchNextBtn");
const markAllBtn = document.getElementById("markAllBtn");
const completeBtn = document.getElementById("completeBtn");
const groupInfo = document.getElementById("groupInfo");
const statusEl = document.getElementById("status");
const tbody = document.querySelector("#todoTable tbody");

let currentGroupId = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c62828" : "#1b5e20";
}

function renderRows(items) {
  tbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${item.term ?? ""}</td>
      <td>${item.elnummer ?? ""}</td>
      <td>
        <label>
          <input type="checkbox" data-row-id="${item.id}" ${item.behandlet ? "checked" : ""} />
          Ferdig
        </label>
      </td>
    `;

    tbody.appendChild(tr);
  }

  const hasRows = items.length > 0;
  markAllBtn.disabled = !hasRows;
  completeBtn.disabled = !hasRows;
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
      return;
    }

    currentGroupId = data.noresult_id;
    groupInfo.textContent = `Viser noresult_id: ${data.noresult_id}`;
    renderRows(data.items);
  } catch (error) {
    setStatus(`Feil ved henting: ${error.message}`, true);
  }
}

function markAllChecked() {
  const checkboxes = tbody.querySelectorAll("input[type='checkbox']");
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
    tbody.querySelectorAll("input[type='checkbox']:checked")
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

fetchNextBtn.addEventListener("click", fetchNextGroup);
markAllBtn.addEventListener("click", markAllChecked);
completeBtn.addEventListener("click", completeSelected);
