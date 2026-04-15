import type {
	Campaign,
	ChatMessage,
	Combatant,
	QuestGiverProgressEntry,
	ScenarioContext,
	TurnState,
} from "@gate-life/shared";
import { getDb } from "../../db/connection.js";
import { broadcastToSession } from "../../ws/handler.js";
import {
	formatPartyCapabilitiesSection,
} from "../CharacterCapabilityService.js";
import { gameState } from "../GameStateService.js";
import type { LlmMessage } from "../LlmService.js";

// ── System prompt ────────────────────────────────────────────────────────────

export const BASE_SYSTEM_PROMPT = `You are the Game Master for "Gate Life", a Rifts-inspired tabletop RPG set in a post-apocalyptic Earth scarred by dimensional rifts. You narrate the world, control NPCs and enemies, describe environments, adjudicate rules, and drive the story forward.

RULES & STYLE:
- Keep responses concise but vivid — 2-4 paragraphs for narration, shorter for dialog responses.
- Use second person ("you") when addressing a single character, or name characters directly in a party.
- Maintain dark, gritty sci-fi atmosphere with moments of wonder near dimensional rifts.
- All characters are Dog Boys (Psi-Hound) — Coalition States mutant canine psychic trackers.
- Reference Rifts mechanics when relevant: SDC/MDC damage, ISP for psionics, APM for combat.
- When players ask what they can do, suggest concrete options.
- Never break character. You ARE the GM.
- Do not narrate player actions — only describe the world's response to what they say or do.
- If a player says something in-character, respond in the fiction. If they ask a meta question, answer as GM.

SCENARIO ADHERENCE:
- The CAMPAIGN SETTING section below contains the authoritative scenario description. ALL details about locations, structures, NPCs, and starting conditions come from this setting.
- DO NOT improvise or contradict the scenario description. If the setting says "pump station", do not describe "tents" or other structures unless explicitly mentioned.
- NPCs, buildings, terrain features, and plot hooks must match what is described in the CAMPAIGN SETTING.
- When in doubt, stay faithful to the written scenario rather than adding creative flourishes that conflict with it.

POSITION TRACKING (Grid Coordinates):
- The PARTY POSITIONS section shows each character's current tactical grid position (X, Y) where each unit = 10 feet.
- When players describe movement (entering buildings, moving to locations, traveling), you should acknowledge this in narrative BUT positions only change when actual movement commands are issued through tactical mode or explicit position updates.
- In conversation mode, narrative movement is descriptive only - the character's dot on the map will not move unless they use tactical movement commands.
- Be aware that a character's narrative location and their grid position may temporarily differ during conversation mode roleplay.

CAPABILITY ENFORCEMENT (inventory, skills, languages, psionics):
- The PARTY CAPABILITIES section lists each character's actual inventory items, skills (including languages/literacy), and psionic powers from the database. This is the source of truth.
- Before narrating success for using an object, tool, weapon, device, skill roll, language use, or psionic power, verify it appears on that character's list. If not on the list, they cannot succeed at using it unless the fiction provides it (found on scene, borrowed, GM grants) — default is: it fails, is absent, or they must correct themselves.
- Never assume standard loadout beyond what is listed. If a CAPABILITY AUDIT block appears for the latest message, treat those lines as high-priority hints about mismatches.
- Agents and players cannot "declare" equipment into existence — only the sheet (and explicit GM-granted scene items) counts.

COMBAT TRANSITION:
When your narration describes combat BEGINNING — the moment enemies attack, weapons are drawn in open hostility, or initiative is called — append this marker on its own line BEFORE the ACTIONS block:
<!--COMBAT-->
Rules:
- Only emit <!--COMBAT--> when a fight is actively starting RIGHT NOW in this response.
- Do NOT emit it for tense standoffs, perceived threats, or ongoing combat the party is already in.
- Do NOT emit it more than once per scene.
- If combat is NOT starting, omit this line entirely.

QUEST ACCEPTANCE — MAP POI REVEAL:
When a player clearly agrees to take on a mission from an NPC and that mission points to a specific named location (POI) listed in SCENARIO CONTEXT below, append one line per affected POI, using the EXACT POI name as written there:
<!--REVEAL_POI:Exact POI Name-->
Rules:
- Only emit when the party has just accepted the quest/mission in this exchange (not for vague maybes).
- Use the precise spelling from the Points of interest list. One marker per POI.
- If the mission does not involve a listed POI, omit this block entirely.
- Place these lines with your other meta-markers (they will be stripped from chat).

QUEST GIVERS — PRIORITY ORDER (multiple missions):
When an NPC in SCENARIO CONTEXT has more than one priority listed, that list is STRICTLY ORDERED from top to bottom.
- Lead with the **first** priority only: that is the mission they care about and pitch **until** it is clearly accepted, refused for good, completed in-fiction, or no longer possible — then move to the second priority, then the third, and so on.
- Do **not** ask the party to take a lower mission before the current (earlier) one has been addressed in play. Do not emit <!--REVEAL_POI:...--> for a later priority's POI until that mission is the one legitimately being offered and accepted under this order.
- If the party tries to jump ahead, the NPC can acknowledge later goals briefly, but should steer back to the outstanding first priority until that arc advances.

QUEST COMPLETION — CONVICTION (quest giver is the judge):
- A mission is **not** automatically complete when players claim success. It is only complete when the **quest giver NPC is convinced** in the fiction — their judgment is final.
- **Proof matters:** physical items, documents, photos, sensor data, or other hard evidence should be far more convincing than a vague or self-serving story. A thin story may be doubted, rejected, or met with demands for corroboration — play that tension.
- The NPC may still refuse credit if the proof does not match what was asked, looks fake, or the fiction demands suspicion — use discretion as GM.
- When (and only when) the NPC clearly accepts that the **current** mission per PROGRESS is fulfilled, append on its own line (exact name and mission number from PROGRESS):
<!--QUEST_COMPLETE:Exact NPC Name:missionNumber-->
missionNumber is **1-based** and must match the PROGRESS line for that NPC. The server awards XP to the party and unlocks the next priority. Never emit this marker without the NPC's in-scene acceptance. Never emit for a mission number that PROGRESS does not list as the next completable one.

RANGED WEAPON FIRE — POSITION REVEAL:
Whenever a scenario entity (enemy, vehicle, hostile NPC) fires a RANGED weapon (gun, energy weapon, missile, thrown weapon), append this marker with the exact entity name, EVEN IF the party has not yet spotted them:
<!--ENEMY_FIRE:EntityName-->
Rules:
- Use the exact name as placed in the scenario (e.g. <!--ENEMY_FIRE:Skulker--> or <!--ENEMY_FIRE:Coalition Grunt-->).
- Emit once per firing action per entity per response.
- Muzzle flash and sound mechanically reveal the shooter's grid position to the party regardless of line-of-sight or darkness.
- For MELEE-only attacks (claws, blades, unarmed), do NOT emit this marker — those do not produce sound or light that reveals position at range.
- If the entity is already detected, still emit it — it confirms the shot came from their known position.
- IMPORTANT: An attacker outside the party's visual range can still shoot them. Narrate the hit/miss without revealing where the shot came from in the text — the mechanical marker will handle the reveal.
- GUNFIRE ATTRACTS ATTENTION: Undetected enemies within hearing range (300ft day, 60ft night) should investigate gunfire by moving toward the sound source on their next opportunity. Narrate their approach as appropriate.

COMBAT — DICE ROLLING:
When a player character makes an attack, you MUST roll dice and display the results:
<!--ROLL:d20+bonus=total (CharacterName strike)-->
<!--ROLL:damageFormula=total (CharacterName damage)-->
<!--DAMAGE:EnemyName:amount:type-->
Rules:
- For attack rolls: Roll d20, add the character's strike_bonus from their stats, and narrate whether it hits based on the total vs. target defense (enemy dodge/parry). Standard target numbers: 12-15 for most enemies, 16+ for agile/armored foes.
- For damage rolls: Use the weapon's damage formula (e.g., "4d6" for a laser rifle, "1d6×10 MD" for a heavy energy weapon). Roll and report the total.
- ALWAYS show both rolls explicitly in your narration (e.g., "You roll 15 + 6 = 21 to strike — a solid hit! Damage: 18 MD").
- When damage is dealt, emit <!--DAMAGE:EnemyName:18:md--> using the EXACT enemy name as it appears in the detected enemies list (e.g., "Shambling Corpse" not "Zombie", "Diseased Cannibal" not "Cannibal"). The damage amount must be a number, and type must be either "sdc" or "md".
- The damage will be automatically applied to the enemy's stats. If an enemy is reduced to 0 HP, mark them as dead in your narrative.
- For enemy attacks on PCs, also roll and display strike/damage dice openly, and emit <!--DAMAGE:CharacterName:amount:type--> to apply damage to the PC using the exact character name.

PLAYER MOVEMENT TO NPC LOCATIONS:
When the player narratively moves to an NPC's location (approaches them, follows them, enters a building with them, is led somewhere by them), append this marker to update the player's map position:
<!--MOVE_PLAYER:Exact NPC Name-->
Rules:
- Use the EXACT NPC or entity name from SCENARIO ENTITIES or PARTY POSITIONS (e.g. <!--MOVE_PLAYER:PFC Marcus Chen-->).
- Emit this when the player clearly moves to be with/near that NPC in the narrative.
- The player's position on the world map will automatically update to match the NPC's location.
- Common scenarios: "I approach the officer", "I follow Chen inside", "lead me to the Lieutenant", "I enter the command room where Vance is waiting".
- **CRITICAL: Emit multiple markers in one response if the player moves through multiple locations.** For example:
  - Player says "follow to the LT" and you narrate them following Chen down a tunnel, then arriving at Vance's command center
  - You MUST emit BOTH: <!--MOVE_PLAYER:PFC Marcus Chen--> AND <!--MOVE_PLAYER:Lieutenant Marcus Vance-->
  - This ensures the player's map position updates to show each leg of their journey
- Do NOT emit if the NPC comes to the player — only when player moves to NPC.

ITEM TRANSFERS:
When an NPC or the environment gives an item to a player character (handed directly, found in a container, looted from a corpse), append this marker using a JSON payload:
<!--GIVE_ITEM:{"recipient":"CharacterName","item":{"name":"Item Name","type":"special","description":"Brief description","abilities":[{"ability_type":"spawn_support","name":"Call Gunship","description":"Summons 1-3 light gunships","config":{"unit_count_min":1,"unit_count_max":3,"unit_type":"gunship"}}]}}-->
Rules:
- recipient: EXACT character name receiving the item
- item.name: Clear, specific item name
- item.type: One of: weapon_melee, weapon_ranged, armor, consumable, ammo, container, misc, special
- item.description: Brief flavor text (1-2 sentences)
- item.uses: Optional number of uses before item is consumed (omit for unlimited)
- item.abilities: Optional array of special abilities for "special" type items
- Common ability_type values: spawn_support (summon allies), heal, buff, damage, reveal, teleport
- For spawn_support abilities, include config with unit_count_min, unit_count_max, and unit_type (gunship, transport, drone, reinforcement)
- Emit this marker BEFORE the narrative about giving/finding the item, so the item appears in inventory when mentioned
- Example: NPC hands player a homing beacon that calls gunships
- DO NOT emit for items the player already has in PARTY CAPABILITIES

SUGGESTED ACTIONS:
After EVERY narration or response, you MUST append exactly one line at the very end in this format (no extra whitespace, no line break inside it):
<!--ACTIONS:["action 1","action 2","action 3","action 4"]-->
- Always include 3-4 options. Write them in first person ("I...").
- Make them specific and grounded in the current scene — not generic.
- Vary the type: exploration, psionic, combat-readiness, social/communication.
- Never skip this block. It must be the absolute last thing in your response.`;

export function buildSystemPrompt(
	campaign: Campaign,
	party: Combatant[],
	extra?: {
		wanderingMonsterTriggered?: string;
		capabilityAudit?: string;
		sessionId?: string;
	},
): string {
	const config = campaign.gm_agent_config;
	const parts = [BASE_SYSTEM_PROMPT];

	if (config?.setting) {
		parts.push(`\nCAMPAIGN SETTING:\n${config.setting}`);
	}

	if (config?.tone) {
		parts.push(`\nTONE: ${config.tone}`);
	}
	if (config?.difficulty) {
		parts.push(`DIFFICULTY: ${config.difficulty}`);
	}
	if (config?.narrative_style) {
		parts.push(`NARRATIVE STYLE: ${config.narrative_style}`);
	}

	parts.push(`\nCAMPAIGN: "${campaign.name}"`);

	if (party.length > 0) {
		const partyDesc = party
			.map((c) => {
				const status = c.status === "dead" ? " [DEAD]" : "";
				const v = c.vitals;
				const posStr =
					c.tactical_x != null && c.tactical_y != null
						? ` at grid (${c.tactical_x}, ${c.tactical_y}) facing ${c.facing ?? "unknown"}`
						: "";
				return `- ${c.name} (${c.kind === "agent" ? "AI" : "Human"} Dog Boy, Level ${c.level}, HP ${v?.hp_current ?? "?"}/${v?.hp_max ?? "?"}, SDC ${v?.sdc_current ?? "?"}/${v?.sdc_max ?? "?"})${posStr}${status}`;
			})
			.join("\n");
		parts.push(
			`\nPARTY POSITIONS (1 grid unit = 10 feet; +x=East, +y=North from scenario start point):\n${partyDesc}`,
		);
		parts.push(formatPartyCapabilitiesSection(party));
	}

	if (extra?.sessionId) {
		const enemies = gameState
			.getSessionEnemies(extra.sessionId)
			.filter((e) => e.detected);
		if (enemies.length > 0) {
			const enemyList = enemies
				.map((e) => {
					const posStr =
						e.tactical_x != null && e.tactical_y != null
							? ` at grid (${e.tactical_x}, ${e.tactical_y})`
							: "";
					const hasMDC = e.mdc_max != null && e.mdc_max > 0;
					const hpInfo = hasMDC
						? `MDC ${e.mdc_current ?? 0}/${e.mdc_max}`
						: `HP ${e.hp_current}/${e.hp_max}, SDC ${e.sdc_current ?? 0}/${e.sdc_max ?? 0}`;
					const damageType = hasMDC ? "md" : "sdc";
					return `- ${e.name} (${hpInfo}${posStr}) [use damage type: ${damageType}]`;
				})
				.join("\n");
			parts.push(
				`\nDETECTED ENEMIES (use EXACT names and correct damage type in <!--DAMAGE:name:amount:type--> markers):\n${enemyList}`,
			);
		}
	}

	if (extra?.capabilityAudit) {
		parts.push(extra.capabilityAudit);
	}

	if (extra?.wanderingMonsterTriggered) {
		parts.push(
			`\n⚠ WANDERING MONSTER ENCOUNTER: A ${extra.wanderingMonsterTriggered} has just appeared. Incorporate this into your narration — describe how the party spots the threat approaching. This MUST trigger <!--COMBAT--> since the monster is actively hostile.`,
		);
	}

	const ctxStr = formatScenarioContext(
		config?.scenario_context,
		config?.quest_giver_progress,
	);
	if (ctxStr) parts.push(ctxStr);

	return parts.join("\n");
}

function formatScenarioContext(
	ctx: ScenarioContext | undefined,
	progress: Record<string, QuestGiverProgressEntry> | undefined,
): string {
	if (!ctx || (ctx.pois.length === 0 && ctx.quest_givers.length === 0))
		return "";
	const lines: string[] = [
		"SCENARIO CONTEXT — exact names for <!--REVEAL_POI:...--> and <!--QUEST_COMPLETE:Name:N--> (N = 1-based mission index):",
	];
	if (ctx.pois.length > 0) {
		lines.push("Points of interest (on the tactical/world map):");
		for (const p of ctx.pois) lines.push(`- ${p.name}`);
	}
	if (ctx.quest_givers.length > 0) {
		lines.push(
			"Quest NPCs — priorities are ORDERED. Missions unlock one at a time. Completion needs the NPC convinced (proof > story); markers must match PROGRESS.",
		);
		for (const g of ctx.quest_givers) {
			lines.push(`- ${g.name}`);
			const pri = g.priorities ?? [];
			const mp = g.priority_mission_pois ?? [];
			for (let i = 0; i < pri.length; i++) {
				const poiName = mp[i];
				const n = i + 1;
				lines.push(
					poiName
						? `  ${n}. "${pri[i]}" → on acceptance (when this step is active), reveal POI: ${poiName}`
						: `  ${n}. "${pri[i]}"`,
				);
			}
			const nextIdx = progress?.[g.name]?.next_priority_index ?? 0;
			if (nextIdx >= pri.length) {
				lines.push(
					`  PROGRESS: **${g.name}** — all listed missions resolved (no further QUEST_COMPLETE).`,
				);
			} else {
				const mission1Based = nextIdx + 1;
				lines.push(
					`  PROGRESS: next mission that can be **completed for XP** is **#${mission1Based}** of ${pri.length}: "${pri[nextIdx]}". ` +
						`Emit <!--QUEST_COMPLETE:${g.name}:${mission1Based}--> only after this NPC is convinced mission #${mission1Based} is done.`,
				);
			}
		}
	}
	return "\n\n" + lines.join("\n");
}

// ── Marker regexes ───────────────────────────────────────────────────────────

export const ACTIONS_RE = /<!--ACTIONS:.*?-->/gs;
export const COMBAT_RE = /<!--COMBAT-->/g;
export const FIRE_RE = /<!--ENEMY_FIRE:([^-]+)-->/g;
export const REVEAL_POI_RE = /<!--REVEAL_POI:[\s\S]*?-->/g;
export const QUEST_COMPLETE_RE = /<!--QUEST_COMPLETE:[^:]+:\d+-->/g;
export const MOVE_PLAYER_RE = /<!--MOVE_PLAYER:([^-]+)-->/g;
export const ROLL_RE = /<!--ROLL:([^-]+)-->/g;
export const DAMAGE_RE = /<!--DAMAGE:([^:]+):(\d+):(sdc|md)-->/g;
export const GIVE_ITEM_RE = /<!--GIVE_ITEM:.+?-->/g;

export function stripMetaMarkers(content: string): string {
	return content
		.replace(ACTIONS_RE, "")
		.replace(COMBAT_RE, "")
		.replace(FIRE_RE, "")
		.replace(REVEAL_POI_RE, "")
		.replace(QUEST_COMPLETE_RE, "")
		.replace(MOVE_PLAYER_RE, "")
		.replace(ROLL_RE, "")
		.replace(DAMAGE_RE, "")
		.trim();
}

export function stripMetaMarkersKeepActions(content: string): string {
	return content
		.replace(COMBAT_RE, "")
		.replace(FIRE_RE, "")
		.replace(REVEAL_POI_RE, "")
		.replace(QUEST_COMPLETE_RE, "")
		.replace(MOVE_PLAYER_RE, "")
		.replace(GIVE_ITEM_RE, "")
		.replace(ROLL_RE, "")
		.replace(DAMAGE_RE, "")
		.trim();
}

export function extractFireMarkers(content: string): string[] {
	const names: string[] = [];
	let m: RegExpExecArray | null;
	const re = /<!--ENEMY_FIRE:([^-]+)-->/g;
	while ((m = re.exec(content)) !== null) {
		names.push(m[1].trim());
	}
	return names;
}

export function extractMovePlayerMarkers(content: string): string[] {
	const names: string[] = [];
	let m: RegExpExecArray | null;
	const re = /<!--MOVE_PLAYER:([^-]+)-->/g;
	while ((m = re.exec(content)) !== null) {
		names.push(m[1].trim());
	}
	return names;
}

// ── Marker processors ────────────────────────────────────────────────────────

export function processGmRolls(
	content: string,
	sessionId: string,
	campaignId: string,
): void {
	const re = /<!--ROLL:(.+?)-->/g;
	let m: RegExpExecArray | null;
	const seenRolls = new Set<string>();

	while ((m = re.exec(content)) !== null) {
		const payload = m[1].trim();
		const match = payload.match(/^(.+?)=(\d+)\s*\((.+?)\)$/);
		if (!match) continue;

		const [, formula, totalStr, label] = match;
		const total = parseInt(totalStr, 10);

		const rollKey = `${formula}=${total} (${label})`;
		if (seenRolls.has(rollKey)) continue;
		seenRolls.add(rollKey);

		const diceMatch = formula.match(/^(\d*)d(\d+)([+-]\d+)?$/);
		if (!diceMatch) continue;

		const [, countStr, sidesStr, modStr] = diceMatch;
		const count = countStr ? parseInt(countStr, 10) : 1;
		const sides = parseInt(sidesStr, 10);
		const modifier = modStr ? parseInt(modStr, 10) : 0;

		const targetSum = total - modifier;
		const results: number[] = [];
		let remaining = targetSum;
		for (let i = 0; i < count; i++) {
			if (i === count - 1) {
				results.push(Math.max(1, Math.min(sides, remaining)));
			} else {
				const avg = Math.ceil(remaining / (count - i));
				const roll = Math.max(1, Math.min(sides, avg));
				results.push(roll);
				remaining -= roll;
			}
		}

		const now = new Date().toISOString();
		broadcastToSession(sessionId, {
			type: "dice_roll",
			payload: { dice: `d${sides}`, results, modifier, total, natural: results[0], label },
			timestamp: now,
		});

		const rollMsg = gameState.createMessage({
			campaign_id: campaignId,
			session_id: sessionId,
			message_type: "system_alert",
			content: `🎲 **${label}**: ${formula} = ${total}`,
			visibility: "party",
		});
		broadcastToSession(sessionId, {
			type: "chat_message",
			payload: rollMsg,
			timestamp: now,
		});
	}
}

export function processDamageMarkers(
	content: string,
	sessionId: string,
	campaignId: string,
): string[] {
	const re = /<!--DAMAGE:([^:]+):(\d+):(sdc|md)-->/g;
	let m: RegExpExecArray | null;
	const killedEnemies: string[] = [];

	while ((m = re.exec(content)) !== null) {
		const [, targetName, amountStr, damageType] = m;
		const amount = parseInt(amountStr, 10);

		const enemies = gameState.getSessionEnemies(sessionId);
		const enemy = enemies.find(
			(e) => e.name.toLowerCase() === targetName.trim().toLowerCase(),
		);

		if (enemy) {
			const isMD = damageType === "md";
			let newHp = enemy.hp_current;
			let newSdc = enemy.sdc_current ?? 0;
			let newMdc = enemy.mdc_current ?? null;

			if (isMD) {
				if (enemy.mdc_max != null && enemy.mdc_current != null) {
					newMdc = Math.max(0, enemy.mdc_current - amount);
				} else {
					const sdcAmount = amount * 100;
					if (newSdc > 0) {
						const sdcDamage = Math.min(newSdc, sdcAmount);
						newSdc -= sdcDamage;
						const overflow = sdcAmount - sdcDamage;
						if (overflow > 0) newHp = Math.max(0, newHp - overflow);
					} else {
						newHp = Math.max(0, newHp - sdcAmount);
					}
				}
			} else {
				if (newSdc > 0) {
					const sdcDamage = Math.min(newSdc, amount);
					newSdc -= sdcDamage;
					const overflow = amount - sdcDamage;
					if (overflow > 0) newHp = Math.max(0, newHp - overflow);
				} else {
					newHp = Math.max(0, newHp - amount);
				}
			}

			const isDead = newHp <= 0 || (newMdc != null && newMdc <= 0);
			const wasAlive = enemy.status !== "dead";
			const newStatus = isDead ? "dead" : enemy.status;

			const db = getDb();
			const updated = db
				.prepare(
					`UPDATE enemies SET hp_current = ?, sdc_current = ?, mdc_current = ?, status = ? WHERE id = ?`,
				)
				.run(newHp, newSdc, newMdc, newStatus, enemy.id);

			if (updated.changes > 0) {
				broadcastToSession(sessionId, {
					type: "enemy_update",
					payload: { ...enemy, hp_current: newHp, sdc_current: newSdc, mdc_current: newMdc, status: newStatus },
					timestamp: new Date().toISOString(),
				});
				if (wasAlive && isDead) killedEnemies.push(enemy.name);
			}
		} else {
			const party = gameState.getPartyCombatants(campaignId);
			const combatant = party.find(
				(c) => c.name.toLowerCase() === targetName.trim().toLowerCase(),
			);

			if (combatant && combatant.combat) {
				const isMD = damageType === "md";
				let newHp = (combatant.combat as any).hp_current;
				let newSdc = (combatant.combat as any).sdc_current ?? 0;
				let newMdc = (combatant.combat as any).mdc_current ?? null;

				if (isMD) {
					if ((combatant.combat as any).mdc_max != null && newMdc != null) {
						newMdc = Math.max(0, newMdc - amount);
					} else {
						const sdcAmount = amount * 100;
						if (newSdc > 0) {
							const sdcDamage = Math.min(newSdc, sdcAmount);
							newSdc -= sdcDamage;
							const overflow = sdcAmount - sdcDamage;
							if (overflow > 0) newHp = Math.max(0, newHp - overflow);
						} else {
							newHp = Math.max(0, newHp - sdcAmount);
						}
					}
				} else {
					if (newSdc > 0) {
						const sdcDamage = Math.min(newSdc, amount);
						newSdc -= sdcDamage;
						const overflow = amount - sdcDamage;
						if (overflow > 0) newHp = Math.max(0, newHp - overflow);
					} else {
						newHp = Math.max(0, newHp - amount);
					}
				}

				const isDead = newHp <= 0 || (newMdc != null && newMdc <= 0);
				const newStatus = isDead ? "dead" : combatant.status;

				const db = getDb();
				db.prepare(
					`UPDATE combatants SET hp_current = ?, sdc_current = ?, mdc_current = ?, status = ? WHERE id = ?`,
				).run(newHp, newSdc, newMdc, newStatus, combatant.id);

				const updatedCombatant = gameState.getCombatant(combatant.id);
				if (updatedCombatant) {
					broadcastToSession(sessionId, {
						type: "combatant_update",
						payload: updatedCombatant,
						timestamp: new Date().toISOString(),
					});
				}
			}
		}
	}

	return killedEnemies;
}

export function processGiveItemMarkers(
	content: string,
	sessionId: string,
	campaignId: string,
): void {
	const re = /<!--GIVE_ITEM:(\{.+?\})-->/g;
	let m: RegExpExecArray | null;

	while ((m = re.exec(content)) !== null) {
		const [, jsonPayload] = m;
		try {
			const data = JSON.parse(jsonPayload) as {
				recipient: string;
				item: {
					name: string;
					type: string;
					description?: string;
					uses?: number;
					abilities?: Array<{
						ability_type: string;
						name: string;
						description: string;
						config?: Record<string, unknown>;
						uses?: number | null;
						cooldown_rounds?: number;
					}>;
				};
			};

			const party = gameState.getPartyCombatants(campaignId);
			const recipient = party.find(
				(c) =>
					c.name.toLowerCase() === data.recipient.trim().toLowerCase() ||
					c.id === data.recipient,
			);

			if (!recipient) return;

			const newItem = {
				id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
				template_id: data.item.name.toLowerCase().replace(/\s+/g, "_"),
				name: data.item.name,
				type: data.item.type as any,
				weight: 1,
				quantity: 1,
				equipped: false,
				description: data.item.description,
				uses: data.item.uses,
				max_uses: data.item.uses,
				abilities: data.item.abilities,
			};

			const updatedInventory = [...recipient.inventory, newItem];
			gameState.updateCombatantInventory(recipient.id, updatedInventory);

			const now = new Date().toISOString();
			broadcastToSession(sessionId, {
				type: "item_received",
				payload: { recipient: recipient.name, item: newItem },
				timestamp: now,
			});

			const msg = gameState.createMessage({
				campaign_id: campaignId,
				session_id: sessionId,
				message_type: "system_alert",
				content: `📦 **${recipient.name}** received: ${data.item.name}${data.item.description ? ` — ${data.item.description}` : ""}`,
				visibility: "party",
			});
			broadcastToSession(sessionId, {
				type: "chat_message",
				payload: msg,
				timestamp: now,
			});
		} catch (err) {
			console.error("[AiGm] Failed to parse GIVE_ITEM marker:", err, jsonPayload);
		}
	}
}

// ── Tactical mode entry ──────────────────────────────────────────────────────

export async function enterTacticalMode(
	sessionId: string,
	campaignId: string,
): Promise<void> {
	const session = gameState.getSession(sessionId);
	if (!session || session.current_mode === "tactical") return;

	const party = gameState.getPartyCombatants(campaignId);
	const rolled = party.map((c) => {
		const natural = Math.floor(Math.random() * 20) + 1;
		const bonus = c.combat?.initiative_bonus ?? 0;
		broadcastToSession(sessionId, {
			type: "dice_roll",
			payload: { dice: "d20", results: [natural], modifier: bonus, total: natural + bonus, natural, label: `${c.name} initiative` },
			timestamp: new Date().toISOString(),
		});
		return { id: c.id, roll: natural + bonus };
	});
	rolled.sort((a, b) => b.roll - a.roll);
	const turn_order = rolled.map((r) => r.id);

	const turn_state: TurnState = {
		turn_order,
		current_actor_index: 0,
		round: 1,
		tick: 0,
		action_budget: Object.fromEntries(party.map((c) => [c.id, c.combat?.apm ?? 4])),
		pending_input: turn_order.length > 0 ? { actor_id: turn_order[0], input_type: "free_text" } : undefined,
	};

	gameState.updateSessionMode(sessionId, "tactical");
	gameState.updateTurnState(sessionId, turn_state);

	broadcastToSession(sessionId, {
		type: "mode_change",
		payload: { mode: "tactical", turn_state },
		timestamp: new Date().toISOString(),
	});

	const firstActorName = party.find((c) => c.id === turn_order[0])?.name ?? "Unknown";
	const alertMsg = gameState.createMessage({
		campaign_id: campaignId,
		session_id: sessionId,
		message_type: "system_alert",
		content: `⚔ COMBAT BEGINS — Initiative rolled. ${firstActorName} acts first.`,
		visibility: "party",
	});
	broadcastToSession(sessionId, {
		type: "chat_message",
		payload: alertMsg,
		timestamp: new Date().toISOString(),
	});
}

// ── Chat history conversion ──────────────────────────────────────────────────

export function chatHistoryToLlmMessages(
	messages: ChatMessage[],
	party: Combatant[],
): LlmMessage[] {
	const llmMsgs: LlmMessage[] = [];
	for (const msg of messages) {
		if (msg.message_type === "system_alert" || msg.message_type === "dice_result") continue;
		if (msg.message_type === "gm_narration") {
			llmMsgs.push({ role: "assistant", content: stripMetaMarkers(msg.content) });
		} else {
			const actor = party.find((c) => c.id === msg.actor_id);
			const name = actor?.name || "Unknown";
			llmMsgs.push({ role: "user", content: `[${name}]: ${msg.content}` });
		}
	}
	return llmMsgs;
}

export function consolidateAdjacentRoles(messages: LlmMessage[]): LlmMessage[] {
	if (messages.length === 0) return messages;
	const result: LlmMessage[] = [messages[0]];
	for (let i = 1; i < messages.length; i++) {
		const prev = result[result.length - 1];
		if (messages[i].role === prev.role) {
			prev.content += "\n" + messages[i].content;
		} else {
			result.push({ ...messages[i] });
		}
	}
	return result;
}
