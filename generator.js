const TERRAIN_ORDER = [
  ["A4", "Waterfall"],
  ["B4", "Grassland"],
  ["C4", "River"],
  ["D4", "Cliff"],
  ["A3", "Desert"],
  ["B3", "Gobi"],
  ["C3", "Mountain"],
  ["D3", "Valley"],
  ["A2", "Volcano"],
  ["B2", "Snowfield"],
  ["C2", "Island"],
  ["D2", "Sea"],
  ["A1", "Forest"],
  ["B1", "Lake"],
  ["C1", "Beach"],
  ["D1", "Glacier"],
];

const ALL_CELLS = TERRAIN_ORDER.map(([cellId]) => cellId);
const TOOL_DEFS = [
  { key: "start", label: "起點", hint: "綠旗 + Bot", tone: "start" },
  { key: "halfway", label: "中途點", hint: "藍旗", tone: "halfway" },
  { key: "destination", label: "終點", hint: "紅旗", tone: "destination" },
  { key: "wall", label: "障礙", hint: "點格邊切換", tone: "wall" },
  { key: "erase", label: "清除", hint: "移除旗或牆", tone: "erase" },
];

const DIRECTION_DEFS = [
  { key: "N", label: "上", english: "North" },
  { key: "E", label: "右", english: "East" },
  { key: "S", label: "下", english: "South" },
  { key: "W", label: "左", english: "West" },
];

const PREVIEW_SIZE = { width: 1414, height: 1000 };
const EXPORT_SIZE = { width: 2480, height: 1754 };

const DEFAULT_STATE = {
  qLabel: "Q1",
  pLabel: "P1",
  startCell: "A1",
  facing: "N",
  halfwayCell: null,
  destinationCell: "D4",
  walls: [],
};

const TERRAIN_LOOKUP = new Map(
  TERRAIN_ORDER.map(([cellId], index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    return [cellId, { column, row }];
  }),
);

const state = {
  card: { ...DEFAULT_STATE },
  activeTool: "start",
  terrainImage: null,
  botImage: null,
  dragSession: null,
  suppressClickUntil: 0,
};

const $ = (selector) => document.querySelector(selector);
const DRAG_MIME = "application/x-matatalab-card-item";
const PREVIEW_SCALE_X = PREVIEW_SIZE.width / EXPORT_SIZE.width;
const PREVIEW_SCALE_Y = PREVIEW_SIZE.height / EXPORT_SIZE.height;
const EXPORT_HELPER_ENDPOINT = `${location.protocol}//${location.hostname}:8125/save-export`;
const RENDER_HELPER_ENDPOINT = `${location.protocol}//${location.hostname}:8125/render-export`;

function setStatus(text, tone = "") {
  const node = $("#generator-status");
  node.textContent = text;
  node.className = `generator-status ${tone}`.trim();
}

function shouldSuppressClick() {
  return Date.now() < state.suppressClickUntil;
}

function suppressClicksForDrag() {
  state.suppressClickUntil = Date.now() + 220;
}

function parseCoordinate(cellId) {
  return {
    col: cellId.charCodeAt(0) - 64,
    row: Number(cellId.slice(1)),
  };
}

function cellIdFrom(row, col) {
  return `${String.fromCharCode(64 + col)}${row}`;
}

function normaliseEdge(a, b) {
  return [a, b].sort().join("-");
}

function getWallSet() {
  return new Set(state.card.walls);
}

function firstAvailableCell(excludedCells, preferredCells = ["D4", "C4", "D3", "B4", "C3", "B3", "A4", "A3", "D2", "C2", "B2", "A2", "D1", "C1", "B1", "A1"]) {
  const excluded = new Set(excludedCells.filter(Boolean));
  return preferredCells.find((cellId) => !excluded.has(cellId)) || "D4";
}

function ensureUniqueCenterRoles(changedRole) {
  const { startCell, halfwayCell, destinationCell } = state.card;

  if (changedRole === "start") {
    if (halfwayCell === startCell) state.card.halfwayCell = null;
    if (destinationCell === startCell) {
      state.card.destinationCell = firstAvailableCell([state.card.startCell, state.card.halfwayCell]);
    }
  }

  if (changedRole === "halfway") {
    if (state.card.halfwayCell === state.card.startCell) {
      state.card.startCell = firstAvailableCell([state.card.halfwayCell, state.card.destinationCell], ["A1", "B1", "A2", "B2", ...ALL_CELLS]);
    }
    if (state.card.halfwayCell && state.card.halfwayCell === state.card.destinationCell) {
      state.card.destinationCell = firstAvailableCell([state.card.startCell, state.card.halfwayCell], ["D4", "C4", "D3", ...ALL_CELLS]);
    }
  }

  if (changedRole === "destination") {
    if (state.card.destinationCell === state.card.startCell) {
      state.card.startCell = firstAvailableCell([state.card.destinationCell, state.card.halfwayCell], ["A1", "B1", "A2", "B2", ...ALL_CELLS]);
    }
    if (state.card.destinationCell === state.card.halfwayCell) {
      state.card.halfwayCell = null;
    }
  }

  if (!state.card.destinationCell) {
    state.card.destinationCell = firstAvailableCell([state.card.startCell, state.card.halfwayCell]);
  }
}

function updateTextInputsFromState() {
  $("#q-label").value = state.card.qLabel;
  $("#p-label").value = state.card.pLabel;
}

function updateLabels() {
  state.card.qLabel = ($("#q-label").value || "Q1").trim() || "Q1";
  state.card.pLabel = ($("#p-label").value || "P1").trim() || "P1";
  renderPreview();
}

function resetCard() {
  state.card = { ...DEFAULT_STATE };
  updateTextInputsFromState();
  renderDragPalette();
  renderEditorBoard();
  renderPreview();
  setStatus("題卡已重設");
}

function setFacing(direction) {
  state.card.facing = direction;
  renderDragPalette();
  renderEditorBoard();
  renderPreview();
  setStatus(`Bot 面向已改成 ${directionLabel(direction)}`);
}

function applyCenterTool(cellId) {
  if (state.activeTool === "start") {
    state.card.startCell = cellId;
    ensureUniqueCenterRoles("start");
    setStatus(`起點已設為 ${cellId}`);
  }

  if (state.activeTool === "halfway") {
    state.card.halfwayCell = cellId;
    ensureUniqueCenterRoles("halfway");
    setStatus(`中途點已設為 ${cellId}`);
  }

  if (state.activeTool === "destination") {
    state.card.destinationCell = cellId;
    ensureUniqueCenterRoles("destination");
    setStatus(`終點已設為 ${cellId}`);
  }

  if (state.activeTool === "erase") {
    if (state.card.halfwayCell === cellId) {
      state.card.halfwayCell = null;
    }
    if (state.card.destinationCell === cellId) {
      state.card.destinationCell = firstAvailableCell([state.card.startCell, state.card.halfwayCell], ["D4", "C4", "D3", ...ALL_CELLS]);
    }
    if (state.card.startCell === cellId) {
      state.card.startCell = "A1";
      ensureUniqueCenterRoles("start");
    }
    setStatus(`已清除 ${cellId} 的物件`);
  }

  renderEditorBoard();
  renderPreview();
}

function edgeNeighbor(cellId, side) {
  const { row, col } = parseCoordinate(cellId);
  if (side === "top" && row < 4) return cellIdFrom(row + 1, col);
  if (side === "bottom" && row > 1) return cellIdFrom(row - 1, col);
  if (side === "left" && col > 1) return cellIdFrom(row, col - 1);
  if (side === "right" && col < 4) return cellIdFrom(row, col + 1);
  return null;
}

function applyEdgeTool(cellId, side) {
  const otherCell = edgeNeighbor(cellId, side);
  if (!otherCell) return;

  const wallKey = normaliseEdge(cellId, otherCell);
  const wallSet = getWallSet();

  if (state.activeTool === "wall") {
    if (wallSet.has(wallKey)) {
      wallSet.delete(wallKey);
      setStatus(`已移除 ${wallKey} 障礙`);
    } else {
      wallSet.add(wallKey);
      setStatus(`已新增 ${wallKey} 障礙`);
    }
  }

  if (state.activeTool === "erase") {
    wallSet.delete(wallKey);
    setStatus(`已清除 ${wallKey} 障礙`);
  }

  state.card.walls = [...wallSet];
  renderEditorBoard();
  renderPreview();
}

function encodeDragPayload(data) {
  return JSON.stringify(data);
}

function decodeDragPayload(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setDragPayload(event, payload) {
  event.dataTransfer.setData(DRAG_MIME, encodeDragPayload(payload));
  event.dataTransfer.effectAllowed = "move";
}

function getDragPayload(event) {
  return decodeDragPayload(event.dataTransfer.getData(DRAG_MIME));
}

function activeToolFromPayload(payload) {
  if (!payload) return null;
  if (payload.kind === "tool") return payload.tool;
  if (payload.kind === "piece") return payload.role;
  if (payload.kind === "wall") return "wall";
  return null;
}

function moveWall(sourceEdge, targetEdge) {
  const wallSet = getWallSet();
  if (!wallSet.has(sourceEdge)) return;
  if (sourceEdge !== targetEdge) {
    wallSet.delete(sourceEdge);
    wallSet.add(targetEdge);
    state.card.walls = [...wallSet];
    setStatus(`已把障礙移到 ${targetEdge}`);
  }
}

function handleCenterDrop(cellId, payload) {
  const tool = activeToolFromPayload(payload);
  if (!tool) return;

  if (tool === "wall") {
    setStatus("障礙要拖到格邊", "err");
    return;
  }

  if (tool === "erase") {
    const previousTool = state.activeTool;
    state.activeTool = "erase";
    applyCenterTool(cellId);
    state.activeTool = previousTool;
    return;
  }

  const previousTool = state.activeTool;
  state.activeTool = tool;
  applyCenterTool(cellId);
  state.activeTool = previousTool;
}

function handleEdgeDrop(cellId, side, payload) {
  const tool = activeToolFromPayload(payload);
  if (!tool) return;

  if (!["wall", "erase"].includes(tool)) {
    setStatus("起點或旗仔要拖到格子中央", "err");
    return;
  }

  const otherCell = edgeNeighbor(cellId, side);
  if (!otherCell) return;
  const targetEdge = normaliseEdge(cellId, otherCell);

  if (payload.kind === "wall" && payload.edge) {
    moveWall(payload.edge, targetEdge);
    renderEditorBoard();
    renderPreview();
    return;
  }

  const previousTool = state.activeTool;
  state.activeTool = tool;
  applyEdgeTool(cellId, side);
  state.activeTool = previousTool;
}

function toolButtonMarkup(tool) {
  return `
    <button class="tool-option ${tool.tone} ${state.activeTool === tool.key ? "active" : ""}" data-tool="${tool.key}" type="button">
      <strong>${tool.label}</strong>
      <small>${tool.hint}</small>
    </button>
  `;
}

function renderToolPicker() {
  $("#tool-picker").innerHTML = TOOL_DEFS.map(toolButtonMarkup).join("");
  $("#tool-picker").querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTool = button.dataset.tool;
      renderToolPicker();
      renderDragPalette();
      setStatus(`已切換工具：${button.textContent.trim()}`);
    });
    button.addEventListener("dragstart", (event) => {
      setDragPayload(event, { kind: "tool", tool: button.dataset.tool });
      button.classList.add("dragging");
      state.activeTool = button.dataset.tool;
      renderDragPalette();
      setStatus(`拖動工具：${button.textContent.trim()}`);
    });
    button.addEventListener("dragend", () => {
      renderToolPicker();
      renderDragPalette();
    });
  });
}

function renderDirectionPicker() {
  $("#direction-picker").innerHTML = DIRECTION_DEFS.map((direction) => `
    <button class="direction-option ${state.card.facing === direction.key ? "active" : ""}" data-direction="${direction.key}">
      <span>${direction.label}</span>
      <small>${direction.english}</small>
    </button>
  `).join("");

  $("#direction-picker").querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", () => setFacing(button.dataset.direction));
  });
}

function flagMarkup(kind) {
  const fills = {
    start: ["#74d44c", "#125827", "#ffffff"],
    halfway: ["#2f61f2", "#12275d", "#ffffff"],
    destination: ["#e44843", "#7d1614", "#ffffff"],
  };
  const [flagFill, baseFill, poleFill] = fills[kind];

  return `
    <svg viewBox="0 0 86 120" aria-hidden="true">
      <ellipse cx="43" cy="107" rx="22" ry="7" fill="${baseFill}" opacity="0.92"></ellipse>
      <rect x="39" y="22" width="8" height="82" rx="4" fill="${poleFill}"></rect>
      <path d="M47 25 h24 c10 0 12 13 3 18 l-13 7 13 7 c9 5 7 18 -3 18 H47 z" fill="${flagFill}"></path>
    </svg>
  `;
}

function dragPaletteIconMarkup(toolKey) {
  if (toolKey === "start") {
    return `
      <span class="drag-art start">
        <span class="drag-art-flag">${flagMarkup("start")}</span>
        <img class="drag-art-bot" src="./assets/bot.png" alt="" style="transform:${boardBotTransform(state.card.facing)}" />
      </span>
    `;
  }
  if (toolKey === "halfway") {
    return `<span class="drag-art flag halfway">${flagMarkup("halfway")}</span>`;
  }
  if (toolKey === "destination") {
    return `<span class="drag-art flag destination">${flagMarkup("destination")}</span>`;
  }
  if (toolKey === "wall") {
    return `<span class="drag-art wall"><span class="drag-wall-bar"></span></span>`;
  }
  return `
    <span class="drag-art erase">
      <span class="drag-wall-bar"></span>
      <span class="drag-erase-slash"></span>
    </span>
  `;
}

function startDirectionMarkup() {
  return DIRECTION_DEFS.map((direction) => `
    <button
      class="start-direction-chip ${state.card.facing === direction.key ? "active" : ""}"
      data-direction="${direction.key}"
      type="button"
      aria-label="Bot 面向 ${direction.label}"
    >
      <span>${direction.label}</span>
      <small>${direction.english}</small>
    </button>
  `).join("");
}

function payloadToolKey(payload) {
  if (!payload) return "start";
  if (payload.kind === "tool") return payload.tool;
  if (payload.kind === "piece") return payload.role;
  if (payload.kind === "wall") return "wall";
  return "start";
}

function createPointerGhost(payload) {
  const toolKey = payloadToolKey(payload);
  const ghost = document.createElement("div");
  ghost.className = `pointer-drag-ghost ${toolKey}`;
  ghost.innerHTML = dragPaletteIconMarkup(toolKey);
  document.body.appendChild(ghost);
  return ghost;
}

function positionPointerGhost(ghost, clientX, clientY) {
  ghost.style.left = `${clientX}px`;
  ghost.style.top = `${clientY}px`;
}

function clearPointerTargetHighlight() {
  document.querySelectorAll(".preview-drop.pointer-hover").forEach((node) => {
    node.classList.remove("pointer-hover");
  });
}

function getPointerDropTarget(clientX, clientY) {
  const hits = document.elementsFromPoint(clientX, clientY);
  return hits.find((node) => node.classList?.contains("preview-drop")) || null;
}

function updatePointerTarget(clientX, clientY) {
  const session = state.dragSession;
  if (!session || !session.started) return null;

  const nextTarget = getPointerDropTarget(clientX, clientY);
  if (session.target === nextTarget) return nextTarget;

  clearPointerTargetHighlight();
  session.target = nextTarget;
  if (nextTarget) {
    nextTarget.classList.add("pointer-hover");
  }
  return nextTarget;
}

function stopPointerDrag(cancelled = false) {
  const session = state.dragSession;
  if (!session) return;

  clearPointerTargetHighlight();
  document.body.classList.remove("pointer-dragging");
  session.source.classList.remove("pointer-drag-source");
  if (session.ghost.isConnected) {
    session.ghost.remove();
  }
  if (session.captureTarget?.releasePointerCapture && session.pointerId != null) {
    try {
      session.captureTarget.releasePointerCapture(session.pointerId);
    } catch {
      // Ignore capture release errors from cross-browser quirks.
    }
  }
  window.removeEventListener("pointermove", handlePointerDragMove, true);
  window.removeEventListener("pointerup", handlePointerDragEnd, true);
  window.removeEventListener("pointercancel", handlePointerDragCancel, true);
  state.dragSession = null;

  if (!cancelled) {
    suppressClicksForDrag();
  }
}

function handlePointerDragMove(event) {
  const session = state.dragSession;
  if (!session) return;

  const deltaX = event.clientX - session.originX;
  const deltaY = event.clientY - session.originY;
  const distance = Math.hypot(deltaX, deltaY);

  if (!session.started && distance > 8) {
    session.started = true;
    document.body.classList.add("pointer-dragging");
    session.source.classList.add("pointer-drag-source");
    setStatus(`拖動${payloadToolKey(session.payload) === "start" ? "起點" : payloadToolKey(session.payload) === "halfway" ? "中途點" : payloadToolKey(session.payload) === "destination" ? "終點" : payloadToolKey(session.payload) === "wall" ? "障礙" : "清除"}`);
  }

  if (!session.started) return;

  positionPointerGhost(session.ghost, event.clientX, event.clientY);
  updatePointerTarget(event.clientX, event.clientY);
}

function applyPayloadToDropTarget(target, payload) {
  if (!target || !payload) return;
  if (target.classList.contains("center")) {
    handleCenterDrop(target.dataset.cell, payload);
    return;
  }
  if (target.classList.contains("edge")) {
    handleEdgeDrop(target.dataset.cell, target.dataset.side, payload);
  }
}

function handlePointerDragEnd(event) {
  const session = state.dragSession;
  if (!session) return;

  if (!session.started) {
    stopPointerDrag(true);
    if (typeof session.onTap === "function") {
      session.onTap();
    }
    return;
  }

  positionPointerGhost(session.ghost, event.clientX, event.clientY);
  const target = updatePointerTarget(event.clientX, event.clientY) || getPointerDropTarget(event.clientX, event.clientY);
  stopPointerDrag();
  applyPayloadToDropTarget(target, session.payload);
}

function handlePointerDragCancel() {
  stopPointerDrag(true);
}

function beginPointerDrag(event, payload, options = {}) {
  if (event.button !== undefined && event.button !== 0) return;
  if (state.dragSession) {
    stopPointerDrag(true);
  }

  event.preventDefault();
  const ghost = createPointerGhost(payload);
  positionPointerGhost(ghost, event.clientX, event.clientY);

  state.dragSession = {
    payload,
    source: event.currentTarget,
    captureTarget: event.currentTarget,
    pointerId: event.pointerId,
    ghost,
    originX: event.clientX,
    originY: event.clientY,
    onTap: options.onTap,
    started: false,
    target: null,
  };

  if (event.currentTarget?.setPointerCapture && event.pointerId != null) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture errors when the browser doesn't support it here.
    }
  }

  window.addEventListener("pointermove", handlePointerDragMove, true);
  window.addEventListener("pointerup", handlePointerDragEnd, true);
  window.addEventListener("pointercancel", handlePointerDragCancel, true);
}

function renderDragPalette() {
  const container = $("#drag-palette");
  if (!container) return;
  container.innerHTML = TOOL_DEFS.map((tool) => `
    <div class="drag-palette-item ${tool.tone} ${state.activeTool === tool.key ? "active" : ""} ${tool.key === "start" ? "with-direction" : ""}">
      <button class="drag-palette-handle" data-tool="${tool.key}" type="button">
        ${dragPaletteIconMarkup(tool.key)}
        <strong>${tool.label}</strong>
        <small>${tool.key === "start" ? "拖動前可先設定 Bot 面向" : tool.hint}</small>
      </button>
      ${tool.key === "start" ? `
        <div class="start-direction-block">
          <span class="start-direction-label">Bot 面向</span>
          <div class="start-direction-picker">${startDirectionMarkup()}</div>
        </div>
      ` : ""}
    </div>
  `).join("");

  container.querySelectorAll(".drag-palette-handle[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      if (shouldSuppressClick()) return;
      state.activeTool = button.dataset.tool;
      renderDragPalette();
      setStatus(`已選擇圖示：${button.querySelector("strong")?.textContent || button.dataset.tool}`);
    });
    button.addEventListener("pointerdown", (event) => {
      beginPointerDrag(event, { kind: "tool", tool: button.dataset.tool }, {
        onTap: () => {
          state.activeTool = button.dataset.tool;
          renderDragPalette();
          setStatus(`已選擇圖示：${button.querySelector("strong")?.textContent || button.dataset.tool}`);
        },
      });
    });
  });

  container.querySelectorAll(".start-direction-chip[data-direction]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setFacing(button.dataset.direction);
    });
  });
}

function boardBotTransform(facing) {
  // bot.svg already contains a built-in 90deg rotation, so we offset all
  // interactive transforms by -90deg to align with the card's facing rules.
  const map = {
    N: "translate(-1%, 0%) rotate(-90deg) scale(1.02)",
    E: "translate(0%, 0%) rotate(0deg) scale(1.02)",
    S: "translate(0%, -2%) rotate(90deg) scale(1.02)",
    W: "translate(-4%, 0%) rotate(180deg) scale(1.02)",
  };
  return map[facing];
}

function cellHasWall(cellId, otherCell) {
  return getWallSet().has(normaliseEdge(cellId, otherCell));
}

function renderEditorBoard() {
  const editorBoard = $("#editor-board");
  if (!editorBoard) return;
  const markup = [];

  TERRAIN_ORDER.forEach(([cellId, label]) => {
    const { row, col } = parseCoordinate(cellId);
    const neighbors = {
      top: row < 4 ? cellIdFrom(row + 1, col) : null,
      right: col < 4 ? cellIdFrom(row, col + 1) : null,
      bottom: row > 1 ? cellIdFrom(row - 1, col) : null,
      left: col > 1 ? cellIdFrom(row, col - 1) : null,
    };

    const terrain = TERRAIN_LOOKUP.get(cellId);
    const pieces = [];
    if (state.card.destinationCell === cellId) {
      pieces.push(`<span class="board-flag destination draggable-piece" draggable="true" data-role="destination" data-cell="${cellId}">${flagMarkup("destination")}</span>`);
    }
    if (state.card.halfwayCell === cellId) {
      pieces.push(`<span class="board-flag halfway draggable-piece" draggable="true" data-role="halfway" data-cell="${cellId}">${flagMarkup("halfway")}</span>`);
    }
    if (state.card.startCell === cellId) {
      pieces.push(`<span class="board-flag start draggable-piece" draggable="true" data-role="start" data-cell="${cellId}">${flagMarkup("start")}</span>`);
      pieces.push(`
        <span class="board-bot draggable-piece" draggable="true" data-role="start" data-cell="${cellId}" style="transform:${boardBotTransform(state.card.facing)}">
          <img src="./assets/bot.png" alt="Bot" />
        </span>
      `);
    }

    markup.push(`
      <div
        class="editor-cell"
        data-cell="${cellId}"
        data-name="${label}"
        style="--terrain-x:${terrain.column}; --terrain-y:${terrain.row};"
      >
        <button class="cell-center-hit" data-cell="${cellId}" aria-label="${cellId}"></button>
        ${Object.entries(neighbors)
          .filter(([, otherCell]) => Boolean(otherCell))
          .map(([side, otherCell]) => `
            <button
              class="cell-edge-hit ${side}"
              data-cell="${cellId}"
              data-side="${side}"
              aria-label="${cellId} ${side}"
            ></button>
            ${cellHasWall(cellId, otherCell) ? `<span class="editor-wall ${side} draggable-wall" draggable="true" data-edge="${normaliseEdge(cellId, otherCell)}"></span>` : ""}
          `)
          .join("")}
        ${pieces.join("")}
      </div>
    `);
  });

  editorBoard.innerHTML = markup.join("");

  editorBoard.querySelectorAll(".cell-center-hit").forEach((button) => {
    button.addEventListener("click", () => applyCenterTool(button.dataset.cell));
    button.addEventListener("dragover", (event) => {
      const payload = getDragPayload(event);
      if (!payload) return;
      event.preventDefault();
      button.classList.add("drag-hover");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("drag-hover");
    });
    button.addEventListener("drop", (event) => {
      const payload = getDragPayload(event);
      button.classList.remove("drag-hover");
      if (!payload) return;
      event.preventDefault();
      handleCenterDrop(button.dataset.cell, payload);
    });
  });

  editorBoard.querySelectorAll(".cell-edge-hit").forEach((button) => {
    button.addEventListener("click", () => {
      if (!["wall", "erase"].includes(state.activeTool)) {
        setStatus("請先選擇障礙或清除工具", "err");
        return;
      }
      applyEdgeTool(button.dataset.cell, button.dataset.side);
    });
    button.addEventListener("dragover", (event) => {
      const payload = getDragPayload(event);
      if (!payload) return;
      event.preventDefault();
      button.classList.add("drag-hover");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("drag-hover");
    });
    button.addEventListener("drop", (event) => {
      const payload = getDragPayload(event);
      button.classList.remove("drag-hover");
      if (!payload) return;
      event.preventDefault();
      handleEdgeDrop(button.dataset.cell, button.dataset.side, payload);
    });
  });

  editorBoard.querySelectorAll(".draggable-piece").forEach((piece) => {
    piece.addEventListener("dragstart", (event) => {
      setDragPayload(event, {
        kind: "piece",
        role: piece.dataset.role,
        sourceCell: piece.dataset.cell,
      });
      piece.classList.add("dragging");
      setStatus(`拖動${piece.dataset.role === "start" ? "起點" : piece.dataset.role === "halfway" ? "中途點" : "終點"}`);
    });
    piece.addEventListener("dragend", () => {
      piece.classList.remove("dragging");
    });
  });

  editorBoard.querySelectorAll(".draggable-wall").forEach((wall) => {
    wall.addEventListener("dragstart", (event) => {
      setDragPayload(event, { kind: "wall", edge: wall.dataset.edge });
      wall.classList.add("dragging");
      setStatus(`拖動障礙：${wall.dataset.edge}`);
    });
    wall.addEventListener("dragend", () => {
      wall.classList.remove("dragging");
    });
  });
}

function previewMetricX(value) {
  return value * PREVIEW_SCALE_X;
}

function previewMetricY(value) {
  return value * PREVIEW_SCALE_Y;
}

function previewPercentX(value) {
  return `${(previewMetricX(value) / PREVIEW_SIZE.width) * 100}%`;
}

function previewPercentY(value) {
  return `${(previewMetricY(value) / PREVIEW_SIZE.height) * 100}%`;
}

function previewMapMetrics() {
  return {
    x: previewMetricX(140),
    y: previewMetricY(115),
    tileWidth: previewMetricX(262),
    tileHeight: previewMetricY(262),
    gapX: previewMetricX(22),
    gapY: previewMetricY(22),
  };
}

function previewCellRect(cellId) {
  const terrain = TERRAIN_LOOKUP.get(cellId);
  const metrics = previewMapMetrics();
  return {
    x: metrics.x + terrain.column * (metrics.tileWidth + metrics.gapX),
    y: metrics.y + terrain.row * (metrics.tileHeight + metrics.gapY),
    width: metrics.tileWidth,
    height: metrics.tileHeight,
  };
}

function previewWallRects() {
  const metrics = previewMapMetrics();
  return wallSegments(
    state.card,
    metrics.x,
    metrics.y,
    metrics.tileWidth,
    metrics.gapX,
  ).map((segment) => ({
    x: segment.x,
    y: segment.y,
    width: segment.width,
    height: segment.height,
  }));
}

function previewPieceStyle(rect) {
  return [
    `left:${(rect.x / PREVIEW_SIZE.width) * 100}%`,
    `top:${(rect.y / PREVIEW_SIZE.height) * 100}%`,
    `width:${(rect.width / PREVIEW_SIZE.width) * 100}%`,
    `height:${(rect.height / PREVIEW_SIZE.height) * 100}%`,
  ].join(";");
}

function previewStartMarkup(cellId) {
  const rect = previewCellRect(cellId);
  return `
    <button
      class="preview-piece preview-start"
      data-role="start"
      data-cell="${cellId}"
      type="button"
      style="${previewPieceStyle(rect)}"
      aria-label="起點 ${cellId}"
    >
      <span class="preview-piece-flag start">${flagMarkup("start")}</span>
      <span class="preview-piece-bot" style="transform:${boardBotTransform(state.card.facing)}">
        <img src="./assets/bot.png" alt="" />
      </span>
    </button>
  `;
}

function previewFlagMarkup(cellId, role) {
  const rect = previewCellRect(cellId);
  return `
    <button
      class="preview-piece preview-flag ${role}"
      data-role="${role}"
      data-cell="${cellId}"
      type="button"
      style="${previewPieceStyle(rect)}"
      aria-label="${role === "halfway" ? "中途點" : "終點"} ${cellId}"
    >
      ${flagMarkup(role === "halfway" ? "halfway" : "destination")}
    </button>
  `;
}

function previewWallMarkup(edge, segment) {
  return `
    <button
      class="preview-wall"
      data-edge="${edge}"
      type="button"
      style="${previewPieceStyle(segment)}"
      aria-label="障礙 ${edge}"
    ></button>
  `;
}

function renderPreviewOverlay() {
  const overlay = $("#card-preview-overlay");
  if (!overlay) return;

  const metrics = previewMapMetrics();
  const centerZones = TERRAIN_ORDER.map(([cellId]) => {
    const rect = previewCellRect(cellId);
    return `
      <button
        class="preview-drop center"
        data-cell="${cellId}"
        style="${previewPieceStyle(rect)}"
        aria-label="preview ${cellId}"
      ></button>
    `;
  }).join("");

  const edgeZones = TERRAIN_ORDER.map(([cellId]) => {
    const { row, col } = parseCoordinate(cellId);
    const rect = previewCellRect(cellId);
    const neighbors = {
      top: row < 4,
      right: col < 4,
      bottom: row > 1,
      left: col > 1,
    };
    return Object.entries(neighbors)
      .filter(([, exists]) => exists)
      .map(([side]) => {
        const zone = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        if (side === "top") {
          zone.x = rect.x + rect.width * 0.18;
          zone.width = rect.width * 0.64;
          zone.height = metrics.gapY;
          zone.y = rect.y - metrics.gapY / 2;
        }
        if (side === "bottom") {
          zone.x = rect.x + rect.width * 0.18;
          zone.width = rect.width * 0.64;
          zone.height = metrics.gapY;
          zone.y = rect.y + rect.height - metrics.gapY / 2;
        }
        if (side === "left") {
          zone.x = rect.x - metrics.gapX / 2;
          zone.width = metrics.gapX;
          zone.height = rect.height * 0.64;
          zone.y = rect.y + rect.height * 0.18;
        }
        if (side === "right") {
          zone.x = rect.x + rect.width - metrics.gapX / 2;
          zone.width = metrics.gapX;
          zone.height = rect.height * 0.64;
          zone.y = rect.y + rect.height * 0.18;
        }
        return `
          <button
            class="preview-drop edge ${side}"
            data-cell="${cellId}"
            data-side="${side}"
            style="${previewPieceStyle(zone)}"
            aria-label="preview ${cellId} ${side}"
          ></button>
        `;
      })
      .join("");
  }).join("");

  const pieces = [
    state.card.destinationCell ? previewFlagMarkup(state.card.destinationCell, "destination") : "",
    state.card.halfwayCell ? previewFlagMarkup(state.card.halfwayCell, "halfway") : "",
    state.card.startCell ? previewStartMarkup(state.card.startCell) : "",
    ...state.card.walls.map((edge, index) => previewWallMarkup(edge, previewWallRects()[index])),
  ].join("");

  overlay.innerHTML = `${centerZones}${edgeZones}${pieces}`;

  overlay.querySelectorAll(".preview-drop.center").forEach((button) => {
    button.addEventListener("click", () => {
      if (shouldSuppressClick()) return;
      if (state.activeTool === "wall") {
        setStatus("障礙要放在格邊", "err");
        return;
      }
      applyCenterTool(button.dataset.cell);
    });
    button.addEventListener("dragover", (event) => {
      const payload = getDragPayload(event);
      if (!payload) return;
      event.preventDefault();
      button.classList.add("drag-hover");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("drag-hover");
    });
    button.addEventListener("drop", (event) => {
      const payload = getDragPayload(event);
      button.classList.remove("drag-hover");
      if (!payload) return;
      event.preventDefault();
      handleCenterDrop(button.dataset.cell, payload);
    });
  });

  overlay.querySelectorAll(".preview-drop.edge").forEach((button) => {
    button.addEventListener("click", () => {
      if (shouldSuppressClick()) return;
      if (!["wall", "erase"].includes(state.activeTool)) {
        setStatus("請先選擇障礙或清除工具", "err");
        return;
      }
      applyEdgeTool(button.dataset.cell, button.dataset.side);
    });
    button.addEventListener("dragover", (event) => {
      const payload = getDragPayload(event);
      if (!payload) return;
      event.preventDefault();
      button.classList.add("drag-hover");
    });
    button.addEventListener("dragleave", () => {
      button.classList.remove("drag-hover");
    });
    button.addEventListener("drop", (event) => {
      const payload = getDragPayload(event);
      button.classList.remove("drag-hover");
      if (!payload) return;
      event.preventDefault();
      handleEdgeDrop(button.dataset.cell, button.dataset.side, payload);
    });
  });

  overlay.querySelectorAll(".preview-piece").forEach((piece) => {
    piece.addEventListener("pointerdown", (event) => {
      beginPointerDrag(event, {
        kind: "piece",
        role: piece.dataset.role,
        sourceCell: piece.dataset.cell,
      });
    });
  });

  overlay.querySelectorAll(".preview-wall").forEach((wall) => {
    wall.addEventListener("pointerdown", (event) => {
      beginPointerDrag(event, { kind: "wall", edge: wall.dataset.edge });
    });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image load failed: ${src}`));
    image.src = src;
  });
}

function canvasBotTransform(facing, size) {
  // Keep the export canvas aligned with the same -90deg asset offset used in
  // the live preview, palette, and draggable bot.
  const map = {
    N: { rotation: -Math.PI / 2, x: size * 0.28, y: size * 0.28 },
    E: { rotation: 0, x: size * 0.29, y: size * 0.26 },
    S: { rotation: Math.PI / 2, x: size * 0.31, y: size * 0.26 },
    W: { rotation: Math.PI, x: size * 0.29, y: size * 0.28 },
  };
  return map[facing];
}

function fitText(ctx, text, maxWidth, preferredSize, family, weight = "700") {
  let size = preferredSize;
  while (size > preferredSize * 0.45) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 4;
  }
  return size;
}

function drawFlag(ctx, x, y, size, kind) {
  const fills = {
    start: { flag: "#74d44c", base: "#2f7a2a", pole: "#ffffff" },
    halfway: { flag: "#2f61f2", base: "#0d1b55", pole: "#ffffff" },
    destination: { flag: "#e44843", base: "#5c1010", pole: "#ffffff" },
  };
  const theme = fills[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 86, size / 86);

  ctx.fillStyle = theme.base;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.ellipse(43, 107, 22, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = theme.pole;
  ctx.beginPath();
  ctx.roundRect(39, 22, 8, 82, 4);
  ctx.fill();

  ctx.fillStyle = theme.flag;
  ctx.beginPath();
  ctx.moveTo(47, 25);
  ctx.lineTo(71, 25);
  ctx.bezierCurveTo(82, 25, 84, 37, 74, 43);
  ctx.lineTo(61, 50);
  ctx.lineTo(74, 57);
  ctx.bezierCurveTo(84, 63, 82, 75, 71, 75);
  ctx.lineTo(47, 75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawArrow(ctx, x, y, width, height) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#477ad4";
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 0);
  ctx.lineTo(width, height * 0.42);
  ctx.lineTo(width * 0.68, height * 0.42);
  ctx.lineTo(width * 0.68, height);
  ctx.lineTo(width * 0.32, height);
  ctx.lineTo(width * 0.32, height * 0.42);
  ctx.lineTo(0, height * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function wallSegments(card, mapX, mapY, tileSize, gap) {
  return card.walls.map((edge) => {
    const [a, b] = edge.split("-");
    const first = parseCoordinate(a);
    const second = parseCoordinate(b);
    const sameRow = first.row === second.row;
    const topRow = 4 - first.row;
    const leftCol = first.col - 1;
    const x1 = mapX + leftCol * (tileSize + gap);
    const y1 = mapY + topRow * (tileSize + gap);

    if (sameRow) {
      const lowCol = Math.min(first.col, second.col);
      return {
        x: mapX + lowCol * (tileSize + gap) - gap,
        y: y1 + tileSize * 0.18,
        width: gap,
        height: tileSize * 0.64,
      };
    }

    const topCellRow = 4 - Math.max(first.row, second.row);
    return {
      x: mapX + (first.col - 1) * (tileSize + gap) + tileSize * 0.18,
      y: mapY + topCellRow * (tileSize + gap) + tileSize,
      width: tileSize * 0.64,
      height: gap,
    };
  });
}

function directionLabel(direction) {
  return {
    N: "上",
    E: "右",
    S: "下",
    W: "左",
  }[direction];
}

function drawCardToCanvas(canvas, card) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const sx = width / EXPORT_SIZE.width;
  const sy = height / EXPORT_SIZE.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f39a1f";
  ctx.fillRect(0, 0, width, 28 * sy);
  ctx.fillRect(0, height - 28 * sy, width, 28 * sy);
  ctx.fillRect(0, 0, 28 * sx, height);
  ctx.fillRect(width - 28 * sx, 0, 28 * sx, height);

  const mapX = 140 * sx;
  const mapY = 115 * sy;
  const tileSize = 262 * sx;
  const gap = 22 * sx;
  const spriteSize = 180;

  TERRAIN_ORDER.forEach(([cellId]) => {
    const terrain = TERRAIN_LOOKUP.get(cellId);
    const dx = mapX + terrain.column * (tileSize + gap);
    const dy = mapY + terrain.row * (tileSize + gap);
    ctx.drawImage(
      state.terrainImage,
      terrain.column * spriteSize,
      terrain.row * spriteSize,
      spriteSize,
      spriteSize,
      dx,
      dy,
      tileSize,
      tileSize,
    );
  });

  ctx.fillStyle = "#575757";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${62 * sy}px "Avenir Next", "Noto Sans TC", sans-serif`;
  [4, 3, 2, 1].forEach((label, index) => {
    ctx.fillText(String(label), 82 * sx, mapY + index * (tileSize + gap) + tileSize / 2);
  });
  ["A", "B", "C", "D"].forEach((label, index) => {
    ctx.fillText(label, mapX + index * (tileSize + gap) + tileSize / 2, mapY + 4 * (tileSize + gap) + 64 * sy);
  });

  wallSegments(card, mapX, mapY, tileSize, gap).forEach((segment) => {
    ctx.fillStyle = "#eb3653";
    ctx.beginPath();
    ctx.roundRect(segment.x, segment.y, segment.width, segment.height, 6 * sx);
    ctx.fill();
  });

  const drawMarkerAt = (cellId, kind, offsetX = 0, offsetY = 0, scale = 1) => {
    const terrain = TERRAIN_LOOKUP.get(cellId);
    const dx = mapX + terrain.column * (tileSize + gap);
    const dy = mapY + terrain.row * (tileSize + gap);
    drawFlag(ctx, dx + offsetX, dy + offsetY, tileSize * scale, kind);
  };

  if (card.destinationCell) {
    drawMarkerAt(card.destinationCell, "destination", tileSize * 0.06, tileSize * 0.05, 0.8);
  }
  if (card.halfwayCell) {
    drawMarkerAt(card.halfwayCell, "halfway", tileSize * 0.06, tileSize * 0.05, 0.8);
  }
  if (card.startCell) {
    drawMarkerAt(card.startCell, "start", tileSize * -0.14, tileSize * 0.06, 0.5);
    const terrain = TERRAIN_LOOKUP.get(card.startCell);
    const dx = mapX + terrain.column * (tileSize + gap);
    const dy = mapY + terrain.row * (tileSize + gap);
    const size = tileSize * 0.56;
    const transform = canvasBotTransform(card.facing, tileSize);
    ctx.save();
    ctx.translate(dx + transform.x + size / 2, dy + transform.y + size / 2);
    ctx.rotate(transform.rotation);
    ctx.drawImage(state.botImage, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  const qBox = { x: 1372 * sx, y: 102 * sy, width: 466 * sx, height: 118 * sy };
  const pBox = { x: 1912 * sx, y: 102 * sy, width: 466 * sx, height: 118 * sy };
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#6c6c6c";
  ctx.lineWidth = 3 * sx;
  ctx.beginPath();
  ctx.rect(qBox.x, qBox.y, qBox.width, qBox.height);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#18dde3";
  ctx.beginPath();
  ctx.rect(pBox.x, pBox.y, pBox.width, pBox.height);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#101010";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = fitText(ctx, card.qLabel, qBox.width - 50 * sx, 76 * sy, '"Avenir Next", "Noto Sans TC", sans-serif', "500");
  ctx.font = `500 ${fontSize}px "Avenir Next", "Noto Sans TC", sans-serif`;
  ctx.fillText(card.qLabel, qBox.x + qBox.width / 2, qBox.y + qBox.height / 2);

  fontSize = fitText(ctx, card.pLabel, pBox.width - 50 * sx, 76 * sy, '"Avenir Next", "Noto Sans TC", sans-serif', "500");
  ctx.font = `500 ${fontSize}px "Avenir Next", "Noto Sans TC", sans-serif`;
  ctx.fillText(card.pLabel, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);

  const infoX = 1390 * sx;
  const infoY = 605 * sy;
  const lineGap = 210 * sy;
  ctx.fillStyle = "#6a6a6a";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${70 * sy}px "Avenir Next", "Noto Sans TC", sans-serif`;
  ctx.fillText(`起點 Starting Point : ${card.startCell}`, infoX, infoY);
  ctx.fillText(`中途點 Halfway Point : ${card.halfwayCell || "-"}`, infoX, infoY + lineGap);
  ctx.fillText(`終點 Destination : ${card.destinationCell}`, infoX, infoY + lineGap * 2);
  ctx.fillText("面向 Facing :", infoX, infoY + lineGap * 3);

  drawArrow(ctx, 2020 * sx, 1010 * sy, 230 * sx, 320 * sy);
  ctx.fillStyle = "#4e4e4e";
  ctx.textAlign = "center";
  ctx.font = `500 ${52 * sy}px "Avenir Next", "Noto Sans TC", sans-serif`;
  ctx.fillText(directionLabel(card.facing), 2135 * sx, 1380 * sy);

}

function renderPreview() {
  drawCardToCanvas($("#card-preview"), state.card);
  renderPreviewOverlay();
}

async function buildExportCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE.width;
  canvas.height = EXPORT_SIZE.height;
  drawCardToCanvas(canvas, state.card);
  return canvas;
}

function blobFromCanvas(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`${type} 匯出失敗`));
    }, type, quality);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadFromUrl(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function saveBlobViaHelper(blob, filename) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const response = await fetch(EXPORT_HELPER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      filename,
      base64: bytesToBase64(bytes),
    }),
  });

  if (!response.ok) {
    throw new Error(`儲存助手回應 ${response.status}`);
  }

  return response.json();
}

async function saveExportBlob(blob, filename, successLabel) {
  try {
    const saved = await saveBlobViaHelper(blob, filename);
    downloadFromUrl(saved.downloadUrl, filename);
    setStatus(`${successLabel} 已保存到 ${saved.relativePath}`);
    return;
  } catch (error) {
    downloadBlob(blob, filename);
    setStatus(`${successLabel} 已嘗試下載；如未見檔案，請刷新頁面再試`, "err");
    console.error(error);
  }
}

async function renderExportViaHelper(format, filename) {
  const response = await fetch(RENDER_HELPER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      format,
      filename,
      state: getCardState(),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Render helper ${response.status}: ${detail}`);
  }

  return response.json();
}

async function exportViaHelperFirst(format, filename, successLabel, clientFallback) {
  try {
    const saved = await renderExportViaHelper(format, filename);
    downloadFromUrl(saved.downloadUrl, filename);
    setStatus(`${successLabel} 已保存到 ${saved.relativePath}`);
    return;
  } catch (helperError) {
    console.warn(helperError);
  }

  try {
    await clientFallback();
  } catch (clientError) {
    setStatus(`${successLabel} 匯出失敗：${clientError.message}`, "err");
  }
}

async function exportPng() {
  const filename = `matatalab-card-${state.card.pLabel}-${state.card.qLabel}.png`;
  await exportViaHelperFirst("png", filename, "PNG", async () => {
    const canvas = await buildExportCanvas();
    const blob = await blobFromCanvas(canvas, "image/png");
    await saveExportBlob(blob, filename, "PNG");
  });
}

async function exportPdf() {
  const filename = `matatalab-card-${state.card.pLabel}-${state.card.qLabel}.pdf`;
  await exportViaHelperFirst("pdf", filename, "PDF", async () => {
    const canvas = await buildExportCanvas();
    const blob = await window.PdfExport.pdfBlobFromCanvas(canvas);
    await saveExportBlob(blob, filename, "PDF");
  });
}

function sanitiseCell(cellId) {
  return ALL_CELLS.includes(cellId) ? cellId : "A1";
}

function sanitiseDirection(direction) {
  return DIRECTION_DEFS.some((item) => item.key === direction) ? direction : "N";
}

function loadCardState(nextState) {
  state.card = {
    qLabel: String(nextState.qLabel || DEFAULT_STATE.qLabel),
    pLabel: String(nextState.pLabel || DEFAULT_STATE.pLabel),
    startCell: sanitiseCell(nextState.startCell || DEFAULT_STATE.startCell),
    facing: sanitiseDirection(nextState.facing || DEFAULT_STATE.facing),
    halfwayCell: nextState.halfwayCell ? sanitiseCell(nextState.halfwayCell) : null,
    destinationCell: sanitiseCell(nextState.destinationCell || DEFAULT_STATE.destinationCell),
    walls: Array.isArray(nextState.walls) ? [...new Set(nextState.walls)] : [],
  };

  ensureUniqueCenterRoles("start");
  updateTextInputsFromState();
  renderDragPalette();
  renderEditorBoard();
  renderPreview();
}

function getCardState() {
  return JSON.parse(JSON.stringify(state.card));
}

function attachEvents() {
  $("#q-label").addEventListener("input", updateLabels);
  $("#p-label").addEventListener("input", updateLabels);
  $("#reset-card").addEventListener("click", resetCard);
  $("#download-png").addEventListener("click", () => {
    exportPng().catch((error) => setStatus(`PNG 匯出失敗：${error.message}`, "err"));
  });
  $("#download-pdf").addEventListener("click", () => {
    exportPdf().catch((error) => setStatus(`PDF 匯出失敗：${error.message}`, "err"));
  });
}

async function init() {
  [state.terrainImage, state.botImage] = await Promise.all([
    loadImage("./assets/terrain-map.png"),
    loadImage("./assets/bot.png"),
  ]);

  updateTextInputsFromState();
  renderDragPalette();
  renderEditorBoard();
  renderPreview();
  attachEvents();
  setStatus("Ready");

  window.getCardState = getCardState;
  window.loadCardState = loadCardState;
}

init().catch((error) => {
  setStatus(`載入失敗：${error.message}`, "err");
});
