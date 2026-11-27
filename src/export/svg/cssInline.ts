export function parseStyleDeclarations(styleText: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const chunk of styleText.split(';')) {
    const colonIdx = chunk.indexOf(':');
    if (colonIdx <= 0) continue;
    const prop = chunk.slice(0, colonIdx).trim().toLowerCase();
    const val = chunk.slice(colonIdx + 1).trim();
    if (prop && val) {
      result.push([prop, val]);
    }
  }
  return result;
}

export function serializeStyleDeclarations(entries: Array<[string, string]>): string {
  return entries.map(([prop, val]) => `${prop}: ${val}`).join('; ');
}

function stripCssAtRules(css: string): string {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = css[i];
        out += c;
        i += 1;
        if (c === '\\' && i < n) {
          out += css[i];
          i += 1;
        } else if (c === q) {
          break;
        }
      }
      continue;
    }
    if (ch === '@') {
      let inQuote: string | null = null;
      i += 1;
      let depth = 0;
      let startedBlock = false;
      while (i < n) {
        const c = css[i];
        i += 1;
        if (inQuote) {
          if (c === '\\' && i < n) {
            i += 1;
          } else if (c === inQuote) {
            inQuote = null;
          }
          continue;
        }
        if (c === '"' || c === "'") {
          inQuote = c;
          continue;
        }
        if (c === ';' && !startedBlock) {
          break;
        }
        if (c === '{') {
          startedBlock = true;
          depth += 1;
        } else if (c === '}' && startedBlock) {
          depth -= 1;
          if (depth <= 0) break;
        }
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function inlineSvgStyles(svgEl: SVGSVGElement): void {
  const styleNodes = Array.from(svgEl.querySelectorAll('style'));
  if (styleNodes.length === 0) return;

  const withoutComments = styleNodes
    .map((node) => node.textContent ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rawCss = stripCssAtRules(withoutComments);

  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const elementPrepends = new Map<Element, string[]>();
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(rawCss)) !== null) {
    const selectorsRaw = match[1].trim();
    const decls = match[2].trim();
    if (!selectorsRaw || !decls) continue;

    for (const sel of selectorsRaw.split(',')) {
      const selector = sel.trim();
      if (!selector) continue;
      try {
        const matched = svgEl.querySelectorAll(selector);
        for (const el of matched) {
          const list = elementPrepends.get(el) ?? [];
          list.push(decls);
          elementPrepends.set(el, list);
        }
      } catch {
        // Игнорируем неподдерживаемые CSS-селекторы.
      }
    }
  }

  for (const [el, declsList] of elementPrepends) {
    const existing = el.getAttribute('style')?.trim() ?? '';
    const merged = existing
      ? `${declsList.join('; ')}; ${existing}`
      : declsList.join('; ');
    el.setAttribute('style', merged);
  }

  for (const node of styleNodes) {
    node.remove();
  }
}

export function extractInlineStyleProp(el: Element, propName: string): string | null {
  const styleAttr = el.getAttribute('style');
  if (!styleAttr) return null;
  let found: string | null = null;
  for (const [prop, val] of parseStyleDeclarations(styleAttr)) {
    if (prop === propName) {
      found = val;
    }
  }
  return found;
}
