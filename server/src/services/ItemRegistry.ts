import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "../../../content/items");

export interface ItemTemplate {
	id: string;
	name: string;
	type: string;
	damage?: string;
	damage_type?: string;
	mdc?: number;
	weight: number;
	value: number;
	rarity: string;
	description?: string;
	abilities?: Array<{
		ability_type: string;
		name: string;
		description: string;
		config?: Record<string, unknown>;
	}>;
}

let registry: Map<string, ItemTemplate> | null = null;

export function loadItemTemplates(): Map<string, ItemTemplate> {
	if (registry) return registry;
	registry = new Map();

	if (!fs.existsSync(CONTENT_DIR)) {
		console.warn("[item-registry] Content directory not found:", CONTENT_DIR);
		return registry;
	}

	const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	for (const file of files) {
		const content = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
		const tmpl = YAML.parse(content) as ItemTemplate;
		registry.set(tmpl.id, tmpl);
		console.log(`[item-registry] Loaded: ${tmpl.id} (${tmpl.name})`);
	}
	return registry;
}

export function getItemTemplate(id: string): ItemTemplate | undefined {
	return loadItemTemplates().get(id);
}

export function listItemTemplates(): ItemTemplate[] {
	return Array.from(loadItemTemplates().values());
}
