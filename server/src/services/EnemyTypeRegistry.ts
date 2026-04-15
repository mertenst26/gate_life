import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "../../../content/enemies");

export interface EnemyTypeTemplate {
	id: string;
	name: string;
	enemy_type: string;
	icon_type?: string;
	hp_max: number;
	sdc_max?: number;
	mdc_max?: number | null;
	apm: number;
	initiative_bonus: number;
	strike_bonus: number;
	parry_bonus: number;
	dodge_bonus: number;
	damage: string;
	damage_type: string;
	abilities: any[];
	loot_table: any[];
	behavior_hints?: string;
}

let registry: Map<string, EnemyTypeTemplate> | null = null;

export function loadEnemyTypes(): Map<string, EnemyTypeTemplate> {
	if (registry) return registry;
	registry = new Map();

	if (!fs.existsSync(CONTENT_DIR)) {
		console.warn("[enemy-registry] Content directory not found:", CONTENT_DIR);
		return registry;
	}

	const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	for (const file of files) {
		const content = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
		const tmpl = YAML.parse(content) as EnemyTypeTemplate;
		registry.set(tmpl.id, tmpl);
		console.log(`[enemy-registry] Loaded: ${tmpl.id} (${tmpl.name})`);
	}
	return registry;
}

export function getEnemyType(id: string): EnemyTypeTemplate | undefined {
	return loadEnemyTypes().get(id);
}

export function listEnemyTypes(): EnemyTypeTemplate[] {
	return Array.from(loadEnemyTypes().values());
}
