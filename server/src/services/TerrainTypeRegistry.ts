import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "../../../content/terrain");

export interface TerrainTypeTemplate {
	id: string;
	name: string;
	movement_cost: number;
	cover: string | null;
	elevation: number;
	hazard_effect: string | null;
	tile_color: string;
	tile_label: string;
}

let registry: Map<string, TerrainTypeTemplate> | null = null;

export function loadTerrainTypes(): Map<string, TerrainTypeTemplate> {
	if (registry) return registry;
	registry = new Map();

	if (!fs.existsSync(CONTENT_DIR)) {
		console.warn("[terrain-registry] Content directory not found:", CONTENT_DIR);
		return registry;
	}

	const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	for (const file of files) {
		const content = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
		const tmpl = YAML.parse(content) as TerrainTypeTemplate;
		registry.set(tmpl.id, tmpl);
		console.log(`[terrain-registry] Loaded: ${tmpl.id} (${tmpl.name})`);
	}
	return registry;
}

export function getTerrainType(id: string): TerrainTypeTemplate | undefined {
	return loadTerrainTypes().get(id);
}

export function listTerrainTypes(): TerrainTypeTemplate[] {
	return Array.from(loadTerrainTypes().values());
}
