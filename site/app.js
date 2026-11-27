(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const INITIAL_SHAPES = [
    {
      id: "s1",
      type: "rect",
      name: "Карточка",
      x: 74,
      y: 52,
      w: 180,
      h: 180,
      rx: 28,
      fill: "#1c1b1a",
      stroke: "#da7756",
      strokeWidth: 0,
    },
    {
      id: "s2",
      type: "capsule",
      name: "Капсула",
      x: 214,
      y: 120,
      w: 192,
      h: 72,
      rx: 36,
      fill: "#da7756",
      stroke: "#1c1b1a",
      strokeWidth: 0,
    },
    {
      id: "s3",
      type: "star",
      name: "Звезда",
      x: 286,
      y: 196,
      w: 84,
      h: 84,
      rx: 0,
      fill: "#ebe6dc",
      stroke: "#1c1b1a",
      strokeWidth: 2,
    },
  ];

  const state = {
    shapes: structuredClone(INITIAL_SHAPES),
    selectedId: "s2",
    wireframe: false,
    showGrid: true,
    undoStack: [],
    nextCounter: 4,
  };

  const canvas = document.getElementById("demo-canvas");
  const sceneLayer = document.getElementById("scene-layer");
  const overlayLayer = document.getElementById("selection-overlay");
  const gridRect = document.getElementById("artboard-grid");

  const statusSelection = document.getElementById("status-selection");
  const statusMode = document.getElementById("status-mode");
  const propTitle = document.getElementById("prop-title");
  const propX = document.getElementById("prop-x");
  const propY = document.getElementById("prop-y");
  const propFill = document.getElementById("prop-fill");
  const propStroke = document.getElementById("prop-stroke");
  const propStrokeVal = document.getElementById("prop-stroke-val");
  const propRadius = document.getElementById("prop-radius");
  const propRadiusVal = document.getElementById("prop-radius-val");
  const radiusWrap = document.getElementById("radius-wrap");
  const feedbackEl = document.getElementById("demo-feedback");

  const btnUndo = document.getElementById("btn-undo");
  const btnReset = document.getElementById("btn-reset");
  const btnDelete = document.getElementById("btn-delete");
  const btnGrid = document.getElementById("btn-grid");
  const btnWireframe = document.getElementById("btn-wireframe");
  const btnCopySvg = document.getElementById("btn-copy-svg");
  const btnDownloadSvg = document.getElementById("btn-download-svg");

  let dragState = null;

  function pushUndo() {
    state.undoStack.push({
      shapes: structuredClone(state.shapes),
      selectedId: state.selectedId,
    });
    if (state.undoStack.length > 25) state.undoStack.shift();
    btnUndo.disabled = state.undoStack.length === 0;
  }

  function undo() {
    const prev = state.undoStack.pop();
    if (!prev) return;
    state.shapes = prev.shapes;
    state.selectedId = prev.selectedId;
    btnUndo.disabled = state.undoStack.length === 0;
    render();
    showFeedback("Действие отменено");
  }

  function getSelected() {
    return state.shapes.find((s) => s.id === state.selectedId) || null;
  }

  function starPoints(cx, cy, outerR, innerR, points = 5) {
    const coords = [];
    for (let i = 0; i < points * 2; i += 1) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (Math.PI / points) * i - Math.PI / 2;
      coords.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
    }
    return coords.join(" ");
  }

  function createShapeElement(shape) {
    let el;
    if (shape.type === "star") {
      el = document.createElementNS(SVG_NS, "polygon");
      const r = Math.min(shape.w, shape.h) / 2;
      el.setAttribute("points", starPoints(shape.x + r, shape.y + r, r, r * 0.44));
    } else {
      el = document.createElementNS(SVG_NS, "rect");
      el.setAttribute("x", String(Math.round(shape.x)));
      el.setAttribute("y", String(Math.round(shape.y)));
      el.setAttribute("width", String(shape.w));
      el.setAttribute("height", String(shape.h));
      const rx = shape.type === "capsule" ? Math.round(shape.h / 2) : shape.rx;
      el.setAttribute("rx", String(rx));
    }
    el.setAttribute("fill", shape.fill);
    el.setAttribute("stroke", shape.stroke);
    el.setAttribute("stroke-width", String(shape.strokeWidth));
    el.dataset.id = shape.id;
    el.style.cursor = "grab";
    return el;
  }

  function render() {
    sceneLayer.replaceChildren();
    overlayLayer.replaceChildren();

    for (const shape of state.shapes) {
      sceneLayer.appendChild(createShapeElement(shape));
    }

    gridRect.style.display = state.showGrid ? "block" : "none";
    canvas.classList.toggle("is-wireframe", state.wireframe);
    btnGrid.classList.toggle("is-active", state.showGrid);
    btnWireframe.classList.toggle("is-active", state.wireframe);
    statusMode.textContent = state.wireframe ? "Режим каркаса (Ctrl+Y)" : "Артборд 480 × 320";

    const selected = getSelected();
    if (selected) {
      const box = document.createElementNS(SVG_NS, "rect");
      box.setAttribute("x", String(selected.x - 3));
      box.setAttribute("y", String(selected.y - 3));
      box.setAttribute("width", String(selected.w + 6));
      box.setAttribute("height", String(selected.h + 6));
      box.setAttribute("fill", "none");
      box.setAttribute("stroke", "#da7756");
      box.setAttribute("stroke-width", "1.5");
      box.setAttribute("stroke-dasharray", "4 3");
      overlayLayer.appendChild(box);

      statusSelection.textContent = `Выбрано: ${selected.name}`;
      propTitle.textContent = selected.name;
      propX.textContent = String(Math.round(selected.x));
      propY.textContent = String(Math.round(selected.y));
      propFill.value = selected.fill;
      propStroke.value = String(selected.strokeWidth);
      propStrokeVal.textContent = `${selected.strokeWidth} px`;
      propRadius.value = String(selected.rx);
      propRadiusVal.textContent = `${selected.rx} px`;
      radiusWrap.style.display = selected.type === "rect" ? "flex" : "none";
      btnDelete.disabled = false;

      document.querySelectorAll("#fill-swatches .swatch").forEach((sw) => {
        sw.classList.toggle("is-selected", sw.dataset.color === selected.fill);
      });
    } else {
      statusSelection.textContent = "Выбрано: нет";
      propTitle.textContent = "Ничего не выбрано";
      propX.textContent = "--";
      propY.textContent = "--";
      btnDelete.disabled = true;
    }
  }

  function clientToSvg(clientX, clientY) {
    const pt = canvas.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = canvas.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const target = e.target.closest("[data-id]");
    if (!target) {
      state.selectedId = null;
      render();
      return;
    }
    const id = target.dataset.id;
    state.selectedId = id;
    const shape = getSelected();
    if (!shape) return;

    const pt = clientToSvg(e.clientX, e.clientY);
    pushUndo();
    dragState = {
      id,
      offsetX: pt.x - shape.x,
      offsetY: pt.y - shape.y,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
    render();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const shape = state.shapes.find((s) => s.id === dragState.id);
    if (!shape) return;
    const pt = clientToSvg(e.clientX, e.clientY);
    shape.x = Math.max(0, Math.min(480 - shape.w, pt.x - dragState.offsetX));
    shape.y = Math.max(0, Math.min(320 - shape.h, pt.y - dragState.offsetY));
    dragState.moved = true;
    render();
  });

  canvas.addEventListener("pointerup", () => {
    if (dragState && !dragState.moved) {
      state.undoStack.pop();
      btnUndo.disabled = state.undoStack.length === 0;
    }
    dragState = null;
  });

  function addShape(type) {
    pushUndo();
    const n = state.nextCounter;
    state.nextCounter += 1;
    const offset = ((n * 18) % 90) + 40;
    const templates = {
      rect: { name: `Блок ${n}`, w: 120, h: 120, rx: 20, fill: "#da7756", stroke: "#1c1b1a", strokeWidth: 0 },
      capsule: { name: `Капсула ${n}`, w: 160, h: 56, rx: 28, fill: "#3d6b5e", stroke: "#1c1b1a", strokeWidth: 0 },
      star: { name: `Звезда ${n}`, w: 80, h: 80, rx: 0, fill: "#1c1b1a", stroke: "#da7756", strokeWidth: 0 },
    };
    const tpl = templates[type];
    const shape = {
      id: `s${n}`,
      type,
      x: offset,
      y: offset,
      ...tpl,
    };
    state.shapes.push(shape);
    state.selectedId = shape.id;
    render();
  }

  document.querySelectorAll(".tool-btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "add-rect") addShape("rect");
      if (action === "add-capsule") addShape("capsule");
      if (action === "add-star") addShape("star");
    });
  });

  document.querySelectorAll("#fill-swatches .swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      const selected = getSelected();
      if (!selected) return;
      pushUndo();
      selected.fill = sw.dataset.color;
      render();
    });
  });

  propFill.addEventListener("input", () => {
    const selected = getSelected();
    if (!selected) return;
    selected.fill = propFill.value;
    render();
  });

  propStroke.addEventListener("input", () => {
    const selected = getSelected();
    if (!selected) return;
    selected.strokeWidth = Number(propStroke.value);
    render();
  });

  propRadius.addEventListener("input", () => {
    const selected = getSelected();
    if (!selected) return;
    selected.rx = Number(propRadius.value);
    render();
  });

  btnDelete.addEventListener("click", () => {
    if (!state.selectedId) return;
    pushUndo();
    state.shapes = state.shapes.filter((s) => s.id !== state.selectedId);
    state.selectedId = state.shapes[state.shapes.length - 1]?.id || null;
    render();
  });

  btnGrid.addEventListener("click", () => {
    state.showGrid = !state.showGrid;
    render();
  });

  btnWireframe.addEventListener("click", () => {
    state.wireframe = !state.wireframe;
    render();
  });

  btnUndo.addEventListener("click", undo);

  btnReset.addEventListener("click", () => {
    pushUndo();
    state.shapes = structuredClone(INITIAL_SHAPES);
    state.selectedId = "s2";
    state.wireframe = false;
    state.showGrid = true;
    render();
    showFeedback("Сцена сброшена");
  });

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pushUndo();
      const preset = btn.dataset.preset;
      if (preset === "terracotta") {
        const palette = ["#da7756", "#1c1b1a", "#ebe6dc"];
        state.shapes.forEach((s, i) => {
          s.fill = palette[i % palette.length];
        });
        showFeedback("Применена палитра «Терракота»");
      } else if (preset === "center") {
        state.shapes.forEach((s) => {
          s.x = Math.round((480 - s.w) / 2);
          s.y = Math.round((320 - s.h) / 2);
        });
        showFeedback("Слои выровнены по центру");
      } else if (preset === "outline-style") {
        state.shapes.forEach((s) => {
          s.fill = "#faf8f4";
          s.stroke = "#1c1b1a";
          s.strokeWidth = 2;
        });
        showFeedback("Применён стиль «Чертёж»");
      }
      render();
    });
  });

  function serializeCanvasSvg() {
    const items = state.shapes
      .map((s) => {
        if (s.type === "star") {
          const r = Math.min(s.w, s.h) / 2;
          return `  <polygon points="${starPoints(s.x + r, s.y + r, r, r * 0.44)}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" />`;
        }
        const rx = s.type === "capsule" ? Math.round(s.h / 2) : s.rx;
        return `  <rect x="${Math.round(s.x)}" y="${Math.round(s.y)}" width="${s.w}" height="${s.h}" rx="${rx}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" />`;
      })
      .join("\n");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">\n  <rect width="480" height="320" fill="#faf8f4" />\n${items}\n</svg>\n`;
  }

  function showFeedback(text) {
    feedbackEl.textContent = text;
    window.clearTimeout(showFeedback.timer);
    showFeedback.timer = window.setTimeout(() => {
      feedbackEl.textContent = "";
    }, 2200);
  }

  btnCopySvg.addEventListener("click", async () => {
    const svgCode = serializeCanvasSvg();
    try {
      await navigator.clipboard.writeText(svgCode);
      showFeedback("SVG скопирован в буфер");
    } catch {
      showFeedback("Буфер недоступен, используйте скачивание");
    }
  });

  btnDownloadSvg.addEventListener("click", () => {
    const blob = new Blob([serializeCanvasSvg()], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "locus-demo.svg";
    link.click();
    URL.revokeObjectURL(url);
    showFeedback("Файл locus-demo.svg скачан");
  });

  document.addEventListener("keydown", (e) => {
    if (document.activeElement?.tagName === "INPUT") return;
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
      if (state.undoStack.length > 0) {
        e.preventDefault();
        undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      state.wireframe = !state.wireframe;
      render();
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedId) {
      e.preventDefault();
      btnDelete.click();
    }
  });

  // OS Download Tabs
  const osTabs = document.querySelectorAll(".os-tab");
  const osPanels = document.querySelectorAll("[data-os-panel]");

  function selectOs(os) {
    osTabs.forEach((tab) => {
      const active = tab.dataset.os === os;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    osPanels.forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.osPanel !== os);
    });
  }

  osTabs.forEach((tab) => {
    tab.addEventListener("click", () => selectOs(tab.dataset.os));
  });

  if (/Win/i.test(navigator.platform || navigator.userAgent)) {
    selectOs("windows");
  }

  const btnCopyCli = document.getElementById("btn-copy-cli");
  const cliCommand = document.getElementById("cli-command");
  btnCopyCli.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cliCommand.textContent.trim());
      btnCopyCli.textContent = "Скопировано";
      setTimeout(() => {
        btnCopyCli.textContent = "Копировать команду";
      }, 1800);
    } catch {
      btnCopyCli.textContent = "Выделите вручную";
    }
  });

  render();
})();
