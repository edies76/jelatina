export const SYSTEMS = [
  { id: "energy", name: "Energía", label: "ENERGÍA", icon: 0, color: 0xffba35, cssColor: "#ffba35" },
  { id: "oxygen", name: "Oxígeno / agua", label: "O₂ / AGUA", icon: 1, color: 0x42d9f0, cssColor: "#42d9f0" },
  { id: "food", name: "Comida", label: "COMIDA", icon: 2, color: 0x79e478, cssColor: "#79e478" },
  { id: "shield", name: "Escudo", label: "ESCUDO", icon: 3, color: 0xae8cff, cssColor: "#ae8cff" },
] as const;

export type SystemId = (typeof SYSTEMS)[number]["id"];
export type ResourceBars = Record<SystemId, number>;
export type Effects = Partial<Record<SystemId, number>>;
export type FamilyId = "energy" | "support" | "biodome" | "armor";

export const FAMILIES: Record<FamilyId, { name: string; color: number; cssColor: string; icon: number }> = {
  energy: { name: "ENERGÍA", color: 0xffb92f, cssColor: "#ffb92f", icon: 4 },
  support: { name: "SOPORTE VITAL", color: 0x40d9f0, cssColor: "#40d9f0", icon: 5 },
  biodome: { name: "BIO-DOMO", color: 0x76e472, cssColor: "#76e472", icon: 6 },
  armor: { name: "BLINDAJE", color: 0xb08bff, cssColor: "#b08bff", icon: 7 },
};

export interface SurvivalCardDefinition {
  id: string;
  name: string;
  shortName: string;
  family: FamilyId;
  cost: number;
  effects: Effects;
  art: number;
  science: string;
  detail?: string;
}

export interface EventDefinition {
  id: string;
  name: string;
  shortName: string;
  effects?: Effects;
  choice?: number;
  art: number;
  science: string;
}

export type CardDefinition = SurvivalCardDefinition;
export type CardKind = "survival";
export interface CardInstance {
  uid: string;
  kind: CardKind;
  definition: CardDefinition;
}
export interface EventInstance {
  uid: string;
  definition: EventDefinition;
}

export const SURVIVAL_CARDS: SurvivalCardDefinition[] = [
  { id: "solar-panels", name: "Paneles Solares Gigantes", shortName: "Paneles solares", family: "energy", cost: 1, effects: { energy: 30, shield: -15 }, art: 0, science: "Amplia superficie expuesta a micrometeoritos." },
  { id: "kilopower", name: "Mini-Reactor Kilopower", shortName: "Mini-reactor", family: "energy", cost: 2, effects: { energy: 40, shield: -20 }, art: 1, science: "Fisión compacta constante; exige disipación térmica." },
  { id: "solid-batteries", name: "Baterías de Estado Sólido", shortName: "Baterías sólidas", family: "energy", cost: 1, effects: { energy: 20, food: -10 }, art: 2, science: "La instalación pesada reduce el turno de cosecha." },
  { id: "hibernation", name: "Modo Hibernación", shortName: "Hibernación", family: "energy", cost: 2, effects: { energy: 25, oxygen: 15, shield: -20 }, art: 3, science: "Apaga sistemas no vitales y deja el escudo sin mantenimiento." },
  { id: "sabatier", name: "Reactor Sabatier", shortName: "Reactor Sabatier", family: "support", cost: 2, effects: { oxygen: 35, energy: -25 }, art: 4, science: "Recupera agua del CO₂; el reactor de la ISS opera a 400 °C." },
  { id: "recycler", name: "Reciclador de Orina / Sudor", shortName: "Reciclador", family: "support", cost: 1, effects: { oxygen: 25, energy: -15 }, art: 5, science: "Bombas y destiladores de alto consumo eléctrico." },
  { id: "lunar-electrolysis", name: "Electrólisis de Hielo Lunar", shortName: "Electrólisis lunar", family: "support", cost: 2, effects: { oxygen: 30, shield: 10, energy: -30 }, art: 6, science: "Extrae oxígeno del hielo polar del cráter Shackleton." },
  { id: "zeolite", name: "Depurador de Zeolita", shortName: "Depurador", family: "support", cost: 1, effects: { oxygen: 20, food: -10 }, art: 7, science: "Regenera el aire con química; ocupa espacio de cultivo." },
  { id: "hydroponics", name: "Cultivo Hidropónico LED", shortName: "Cultivo LED", family: "biodome", cost: 2, effects: { food: 30, oxygen: -5, energy: -20 }, art: 8, science: "La producción de O₂ (+10) y el riego (−15) dejan un neto de −5.", detail: "O₂/agua: +10% de producción y −15% por riego; cambio neto −5%." },
  { id: "spirulina", name: "Biorreactor de Espirulina", shortName: "Espirulina", family: "biodome", cost: 1, effects: { food: 20, oxygen: 15, energy: -20 }, art: 9, science: "Microalgas proteicas que capturan CO₂." },
  { id: "rations", name: "Raciones Deshidratadas", shortName: "Raciones", family: "biodome", cost: 1, effects: { food: 20, oxygen: -10 }, art: 10, science: "Alimento listo de Tierra; requiere rehidratación." },
  { id: "intensive-harvest", name: "Cosecha Intensiva", shortName: "Cosecha intensiva", family: "biodome", cost: 2, effects: { food: 35, energy: -15, shield: -15 }, art: 11, science: "Abre los domos a luz directa y expone la estructura." },
  { id: "regolith-wall", name: "Muro de Regolito", shortName: "Muro de regolito", family: "armor", cost: 2, effects: { shield: 35, energy: -15, food: -10 }, art: 12, science: "El suelo lunar o marciano frena los rayos cósmicos." },
  { id: "ice-dome", name: "Cúpula de Hielo Protectora", shortName: "Cúpula de hielo", family: "armor", cost: 2, effects: { shield: 40, oxygen: -25, energy: -10 }, art: 13, science: "El hidrógeno del hielo bloquea la radiación." },
  { id: "lava-tube", name: "Túnel de Lava Subterráneo", shortName: "Túnel de lava", family: "armor", cost: 3, effects: { shield: 45, energy: -30 }, art: 14, science: "La excavación profunda necesita iluminación artificial." },
  { id: "emergency-seal", name: "Sellado de Emergencia", shortName: "Sellado", family: "armor", cost: 1, effects: { shield: 20, oxygen: -10 }, art: 15, science: "Los compresores del casco purgan aire de las esclusas." },
];

export const GLOBAL_EVENTS: EventDefinition[] = [
  { id: "lunar-night", name: "Noche Lunar de 14 Días", shortName: "Noche lunar", effects: { energy: -25, food: -10 }, art: 8, science: "En la Luna, la noche dura cerca de 354 horas terrestres." },
  { id: "class-x-flare", name: "Fulguración Solar Clase X", shortName: "Fulguración clase X", effects: { shield: -30, energy: 15 }, art: 9, science: "Una eyección de masa coronal eleva radiación y satura paneles." },
  { id: "martian-dust", name: "Tormenta Global Marciana", shortName: "Tormenta marciana", effects: { energy: -20, food: -15 }, art: 10, science: "El polvo en suspensión puede bloquear casi toda la luz solar en Marte." },
  { id: "calm-solar-wind", name: "Viento Solar Calmo", shortName: "Viento calmo", effects: { energy: 15, shield: 10 }, art: 11, science: "Un periodo de irradiancia estable favorece los sistemas solares." },
  { id: "resupply", name: "Cápsula de Reabastecimiento", shortName: "Reabastecimiento", choice: 20, art: 12, science: "Una carga comercial tipo CLPS repone un sistema crítico." },
  { id: "galactic-radiation", name: "Pico de Radiación Galáctica", shortName: "Radiación galáctica", effects: { shield: -25, oxygen: -10 }, art: 13, science: "Los rayos cósmicos galácticos penetran hábitats sin regolito." },
];

export const STARTING_RESOURCE: ResourceBars = { energy: 50, oxygen: 50, food: 50, shield: 50 };
export const HAND_LIMIT = { survival: 3 } as const;
export const ACTION_POINTS = 3;
export const MAX_DAY = 15;
export const PLAN_SECONDS = 15;
export const RESOLVE_SECONDS = 5;
export const SURVIVAL_ATLAS = { cols: 4, rows: 4 } as const;
export const EVENTS_ATLAS = { cols: 4, rows: 4 } as const;
export const ICONS_ATLAS = { cols: 4, rows: 2 } as const;
export const EFFECTS_ATLAS = { cols: 4, rows: 3 } as const;
