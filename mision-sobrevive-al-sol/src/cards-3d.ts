import "./cards-3d.css";
import {
  ATTACK_CARDS,
  FAMILIES,
  GLOBAL_EVENTS,
  SURVIVAL_CARDS,
  SYSTEMS,
  type Effects,
} from "./data";

type CardKind = "survival" | "attack" | "event";

interface CatalogCard {
  id: string;
  name: string;
  kind: CardKind;
  familyKey: string;
  familyName: string;
  accent: string;
  icon: string;
  cost?: number;
  art: number;
  effects: Effects;
  selfCost?: Effects;
  science: string;
  detail?: string;
  choice?: number;
  special?: "conceal";
}

const root = document.querySelector<HTMLDivElement>("#cards-app");
if (!root) throw new Error("No se encontró el catálogo de cartas.");

const icons: Record<string, string> = {
  energy: "⚡", support: "◌", biodome: "✦", armor: "⬡", attack: "☄", event: "✧",
};

const cards: CatalogCard[] = [
  ...SURVIVAL_CARDS.map((card): CatalogCard => ({
    id: card.id, name: card.name, kind: "survival", familyKey: card.family,
    familyName: FAMILIES[card.family].name, accent: FAMILIES[card.family].cssColor,
    icon: icons[card.family], cost: card.cost, art: card.art,
    effects: card.effects, science: card.science, detail: card.detail,
  })),
  ...ATTACK_CARDS.map((card): CatalogCard => ({
    id: card.id, name: card.name, kind: "attack", familyKey: "attack",
    familyName: "ATAQUE", accent: FAMILIES.attack.cssColor, icon: icons.attack,
    cost: card.cost, art: card.art, effects: card.effects, selfCost: card.selfCost,
    science: card.science, special: card.special,
  })),
  ...GLOBAL_EVENTS.map((card): CatalogCard => ({
    id: card.id, name: card.name, kind: "event", familyKey: "event",
    familyName: "EVENTO GLOBAL", accent: "#91b8ff", icon: icons.event,
    art: card.art, effects: card.effects ?? {}, choice: card.choice, science: card.science,
  })),
];

function countFor(key: string): number {
  if (key === "survival") return cards.filter((card) => card.kind === "survival").length;
  return cards.filter((card) => card.familyKey === key).length;
}

const filters = [
  { id: "all", label: "Todas", count: cards.length },
  { id: "survival", label: "Supervivencia", count: countFor("survival") },
  { id: "energy", label: "Energía", count: countFor("energy") },
  { id: "support", label: "Soporte vital", count: countFor("support") },
  { id: "biodome", label: "Bio-domo", count: countFor("biodome") },
  { id: "armor", label: "Blindaje", count: countFor("armor") },
  { id: "attack", label: "Ataque", count: countFor("attack") },
  { id: "event", label: "Eventos NASA", count: countFor("event") },
];

let activeFilter = "all";
let query = "";

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function signed(value: number): string {
  return (value > 0 ? "+" : "−") + Math.abs(value);
}

function effectTags(effects: Effects, tone: "normal" | "danger" = "normal"): string {
  return Object.entries(effects)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0)
    .map(([system, amount]) => {
      const resource = SYSTEMS.find((item) => item.id === system)?.label ?? system.toUpperCase();
      const color = tone === "danger" ? "is-danger" : amount > 0 ? "is-positive" : "is-negative";
      return '<span class="effect-chip ' + color + '"><strong>' + signed(amount) +
        '%</strong><span>' + escapeHtml(resource) + "</span></span>";
    })
    .join("");
}

function effectGroup(label: string, effects: Effects, tone: "normal" | "danger" = "normal"): string {
  const tags = effectTags(effects, tone);
  return tags
    ? '<span class="effect-group"><span class="effect-label">' + label +
      '</span><span class="effect-tags">' + tags + "</span></span>"
    : "";
}

function renderEffects(card: CatalogCard): string {
  if (card.kind === "event" && card.choice) {
    return '<span class="effect-group"><span class="effect-label">ELIGE UNA BARRA</span>' +
      '<span class="effect-tags"><span class="effect-chip is-positive"><strong>+' + card.choice +
      '%</strong><span>AL SISTEMA ELEGIDO</span></span></span></span>';
  }
  if (card.kind === "attack" && card.special === "conceal") {
    return '<span class="effect-group"><span class="effect-label">RIVAL</span>' +
      '<span class="effect-tags"><span class="effect-chip is-special"><strong>···</strong>' +
      "<span>TELEMETRÍA OCULTA</span></span></span></span>" +
      effectGroup("COSTO PROPIO", card.selfCost ?? {});
  }
  if (card.kind === "attack") {
    return effectGroup("OBJETIVO · RIVAL", card.effects, "danger") +
      effectGroup("COSTO PROPIO", card.selfCost ?? {});
  }
  return effectGroup(card.kind === "event" ? "IMPACTO GLOBAL" : "IMPACTO", card.effects);
}

function renderCard(card: CatalogCard, index: number): string {
  const atlas = card.kind === "survival"
    ? "/assets/survival-cards-atlas.png"
    : "/assets/attack-events-atlas.png";
  const column = card.art % 4;
  const row = Math.floor(card.art / 4);
  const position = (column * 100 / 3) + "% " + (row * 100 / 3) + "%";
  const cost = card.cost
    ? '<span class="cost-gem"><strong>' + card.cost + '</strong><span>PA</span></span>'
    : '<span class="event-gem"><span>NASA</span><strong>✦</strong></span>';
  const descriptor = card.kind === "event"
    ? "Evento global."
    : (card.kind === "attack" ? "Ataque." : "Supervivencia.") +
      " Cuesta " + card.cost + " puntos de acción.";
  const note = card.detail ?? card.science;

  return '<article class="card-stage" style="--accent:' + card.accent + '">' +
    '<button class="card-tilt" type="button" data-card-id="' + escapeHtml(card.id) +
    '" aria-pressed="false" aria-label="Girar ' + escapeHtml(card.name) + '. ' +
    escapeHtml(descriptor) + '">' +
    '<span class="card-depth" aria-hidden="true"></span><span class="card-inner">' +
    '<span class="card-face card-front"><span class="card-content">' +
    '<span class="card-header"><span class="family-pill"><span class="family-icon" aria-hidden="true">' +
    card.icon + "</span><span>" + escapeHtml(card.familyName) + "</span></span>" + cost + "</span>" +
    '<span class="art-panel"><span class="art-orbit" aria-hidden="true"></span>' +
    '<span class="artwork" role="img" aria-label="Ilustración de ' + escapeHtml(card.name) +
    '" style="--atlas:url(&quot;' + atlas + '&quot;);--art-position:' + position + '"></span>' +
    '<span class="art-index" aria-hidden="true">MS · ' + String(index + 1).padStart(2, "0") + "</span></span>" +
    '<span class="card-title">' + escapeHtml(card.name) + "</span>" +
    '<span class="card-effects">' + renderEffects(card) + "</span>" +
    '<span class="science-line"><span class="science-stamp">NASA DATA</span>' +
    '<span class="science-copy">' + escapeHtml(card.science) + "</span></span></span></span>" +
    '<span class="card-face card-back"><span class="back-orbit orbit-one" aria-hidden="true"></span>' +
    '<span class="back-orbit orbit-two" aria-hidden="true"></span><span class="back-content">' +
    '<span class="back-topline"><span class="back-mark">MS</span><span>ARCHIVO DE MISIÓN</span></span>' +
    '<span class="back-emblem" aria-hidden="true"><span>' + card.icon + "</span></span>" +
    '<span class="back-family">' + escapeHtml(card.familyName) + "</span>" +
    '<span class="back-title">' + escapeHtml(card.name) + '</span><span class="back-rule"></span>' +
    '<span class="back-note-label">' + (card.kind === "event" ? "DATO DE MISIÓN" : "FUNDAMENTO NASA") + "</span>" +
    '<span class="back-note">' + escapeHtml(note) + "</span>" +
    (card.kind === "attack" && card.selfCost
      ? '<span class="back-cost">COSTO DEL LANZADOR ' + effectTags(card.selfCost) + "</span>"
      : "") +
    '<span class="back-bottomline"><span>NASA SPACE APPS</span><span>15 DÍAS · 1 COLONIA</span></span>' +
    "</span></span>" +
    "</span></button></article>";
}

function matchesFilter(card: CatalogCard): boolean {
  if (activeFilter === "all") return true;
  if (activeFilter === "survival") return card.kind === "survival";
  return card.familyKey === activeFilter;
}

function renderGrid(): void {
  const grid = document.querySelector<HTMLDivElement>("#card-grid");
  const count = document.querySelector<HTMLParagraphElement>("#results-count");
  if (!grid || !count) return;

  const visible = cards.filter((card) => {
    const terms = (card.name + " " + card.familyName + " " + card.science).toLocaleLowerCase("es");
    return matchesFilter(card) && terms.includes(query.toLocaleLowerCase("es"));
  });

  grid.innerHTML = visible.length
    ? visible.map((card) => renderCard(card, cards.indexOf(card))).join("")
    : '<div class="empty-state"><span class="empty-symbol">⌕</span><strong>No encontramos esa carta</strong><span>Prueba otro nombre, familia o sistema.</span></div>';

  const active = filters.find((filter) => filter.id === activeFilter);
  count.textContent = visible.length + (visible.length === 1 ? " CARTA" : " CARTAS") +
    (activeFilter === "all" ? " · MAZO COMPLETO" : " · " + (active?.label.toUpperCase() ?? "FILTRO"));

  grid.querySelectorAll<HTMLButtonElement>(".card-tilt").forEach((button) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    button.addEventListener("pointermove", (event: PointerEvent) => {
      if (reducedMotion || event.pointerType === "touch") return;
      const bounds = button.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      button.style.setProperty("--tilt-x", ((0.5 - y) * 12).toFixed(2) + "deg");
      button.style.setProperty("--tilt-y", ((x - 0.5) * 14).toFixed(2) + "deg");
      button.style.setProperty("--shine-x", (x * 100).toFixed(1) + "%");
      button.style.setProperty("--shine-y", (y * 100).toFixed(1) + "%");
    });
    button.addEventListener("pointerleave", () => {
      button.style.setProperty("--tilt-x", "0deg");
      button.style.setProperty("--tilt-y", "0deg");
      button.style.setProperty("--shine-x", "50%");
      button.style.setProperty("--shine-y", "50%");
    });
    button.addEventListener("click", () => {
      const flipped = button.classList.toggle("is-flipped");
      button.setAttribute("aria-pressed", String(flipped));
      const card = cards.find((item) => item.id === button.dataset.cardId);
      if (card) button.setAttribute("aria-label", (flipped ? "Volver a " : "Ver datos de ") + card.name);
    });
  });
}

root.innerHTML =
  '<div class="app-shell"><header class="masthead">' +
  '<a class="brand" href="/" aria-label="Misión: Sobrevive al Sol, catálogo de cartas">' +
  '<span class="brand-sigil" aria-hidden="true"><span>✹</span></span>' +
  '<span class="brand-copy"><span class="brand-overline">NASA SPACE APPS CHALLENGE</span>' +
  '<span class="brand-title">MISIÓN: <strong>SOBREVIVE AL SOL</strong></span></span></a>' +
  '<div class="mission-chip"><span class="status-dot"></span><span>ARCHIVO DE CARTAS</span>' +
  "<strong>" + cards.length + "</strong></div></header>" +
  '<main class="catalog-main"><section class="catalog-heading" aria-labelledby="page-title">' +
  '<div class="heading-copy"><p class="eyebrow"><span>01</span> · CATÁLOGO DE MISIÓN</p>' +
  '<h1 id="page-title">Cartas con <em>otra dimensión.</em></h1>' +
  '<p class="heading-note">Pasa el cursor para inclinar; haz clic o toca una carta para ver su reverso científico.</p></div>' +
  '<label class="search-box"><span class="search-icon" aria-hidden="true">⌕</span>' +
  '<span class="sr-only">Buscar cartas por nombre, familia o dato NASA</span>' +
  '<input id="card-search" type="search" placeholder="Buscar en el mazo…" autocomplete="off" /><kbd>/</kbd></label>' +
  '</section><nav id="filter-bar" class="filter-bar" aria-label="Filtrar cartas"></nav>' +
  '<section class="results-section" aria-label="Cartas del mazo">' +
  '<p id="results-count" class="results-count" aria-live="polite"></p>' +
  '<div id="card-grid" class="card-grid"></div></section>' +
  '<footer class="page-footer"><span>UNA COLONIA · 15 DÍAS ESPACIALES</span>' +
  '<span class="footer-rule"></span><span>MANTÉN EL EQUILIBRIO</span></footer></main></div>';

const filterBar = document.querySelector<HTMLElement>("#filter-bar");
filterBar!.innerHTML = filters.map((filter) =>
  '<button class="filter-chip' + (filter.id === activeFilter ? " is-active" : "") +
  '" type="button" data-filter="' + filter.id + '" aria-pressed="' + String(filter.id === activeFilter) + '">' +
  "<span>" + filter.label + '</span><span class="filter-count">' + filter.count + "</span></button>",
).join("");
filterBar!.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter ?? "all";
    filterBar!.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((filterButton) => {
      const selected = filterButton.dataset.filter === activeFilter;
      filterButton.classList.toggle("is-active", selected);
      filterButton.setAttribute("aria-pressed", String(selected));
    });
    renderGrid();
  });
});

const search = document.querySelector<HTMLInputElement>("#card-search");
search?.addEventListener("input", () => {
  query = search.value.trim();
  renderGrid();
});
search?.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    search.value = "";
    query = "";
    renderGrid();
  }
});
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "/" && document.activeElement !== search) {
    event.preventDefault();
    search?.focus();
  }
});

renderGrid();
