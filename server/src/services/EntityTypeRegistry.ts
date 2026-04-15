import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "../../../content/entity-types");

export interface EntityTypeTemplate {
	id: string;
	label: string;
	icon: string;
	spawn_as: string;
	hostile: boolean;
}

let registry: Map<string, EntityTypeTemplate> | null = null;

export function loadEntityTypes(): Map<string, EntityTypeTemplate> {
	if (registry) return registry;
	registry = new Map();

	if (!fs.existsSync(CONTENT_DIR)) {
		console.warn("[entity-type-registry] Content directory not found:", CONTENT_DIR);
		return registry;
	}

	const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	for (const file of files) {
		const content = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8");
		const tmpl = YAML.parse(content) as EntityTypeTemplate;
		registry.set(tmpl.id, tmpl);
		console.log(`[entity-type-registry] Loaded: ${tmpl.id} (${tmpl.label})`);
	}
	return registry;
}

export function getEntityType(id: string): EntityTypeTemplate | undefined {
	return loadEntityTypes().get(id);
}

export function listEntityTypes(): EntityTypeTemplate[] {
	return Array.from(loadEntityTypes().values());
}
