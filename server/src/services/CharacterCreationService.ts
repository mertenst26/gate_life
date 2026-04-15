import { getTemplate, type ClassTemplate } from "./ClassTemplateService.js";
import { rollDogBoyCharacter } from "./DogBoyCreationService.js";

export interface RolledCharacterData {
	attributes: Record<string, number>;
	hp: number;
	sdc: number;
	isp: number;
	ppe: number;
	combat_delta: Record<string, number>;
	extra_psionic_power_ids: string[];
	breed_name?: string;
	mutation_rolls: Array<{ name: string; description: string }>;
	creation_summary: string;
}

/**
 * Roll a new character for the given class. Dispatches to class-specific
 * creation services when available, or falls back to base template stats.
 */
export function rollCharacter(classId: string): RolledCharacterData {
	const template = getTemplate(classId);
	if (!template) throw new Error(`Class template "${classId}" not found`);

	if (classId === "dog_boy") {
		return rollDogBoyCharacter(template);
	}

	return rollFromBaseTemplate(template);
}

/**
 * Generic fallback: use the template's base stats directly with minor random variance.
 */
function rollFromBaseTemplate(template: ClassTemplate): RolledCharacterData {
	const attrs = { ...template.attributes };

	// Apply small random variance (±2) to each attribute
	for (const key of Object.keys(attrs)) {
		const variance = Math.floor(Math.random() * 5) - 2;
		attrs[key] = Math.max(1, attrs[key] + variance);
	}

	const peBonus = Math.max(0, Math.floor((attrs.pe ?? 13) / 3));

	return {
		attributes: attrs,
		hp: template.base_hp + peBonus,
		sdc: template.base_sdc,
		isp: template.base_isp,
		ppe: template.base_ppe,
		combat_delta: {},
		extra_psionic_power_ids: [],
		mutation_rolls: [],
		breed_name: undefined,
		creation_summary: `${template.name} created from base template`,
	};
}
