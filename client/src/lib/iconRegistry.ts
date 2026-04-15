interface IconEntry {
	emoji: string;
	label: string;
}

const ENTITY_TYPE_ICONS: Record<string, IconEntry> = {
	enemy: { emoji: "💀", label: "Enemy" },
	npc: { emoji: "🗣", label: "NPC" },
	friendly: { emoji: "🤝", label: "Friendly" },
	vehicle: { emoji: "🚗", label: "Vehicle" },
	poi: { emoji: "📍", label: "Point of Interest" },
	dungeon: { emoji: "🏰", label: "Dungeon" },
};

const ICON_TYPE_ICONS: Record<string, IconEntry> = {
	zombie: { emoji: "🧟", label: "Zombie" },
	soldier: { emoji: "🎖", label: "Soldier" },
	animal: { emoji: "🐾", label: "Animal" },
	robot: { emoji: "🤖", label: "Robot" },
	npc: { emoji: "🗣", label: "NPC" },
	skull: { emoji: "💀", label: "Hostile" },
};

const CLASS_ICONS: Record<string, IconEntry> = {
	dog_boy: { emoji: "🐕", label: "Dog Boy" },
};

const FALLBACK: IconEntry = { emoji: "❓", label: "Unknown" };

export function getEntityIcon(entityType: string, iconType?: string): IconEntry {
	if (iconType && ICON_TYPE_ICONS[iconType]) return ICON_TYPE_ICONS[iconType];
	return ENTITY_TYPE_ICONS[entityType] ?? FALLBACK;
}

export function getClassIcon(classId: string): IconEntry {
	return CLASS_ICONS[classId] ?? FALLBACK;
}
