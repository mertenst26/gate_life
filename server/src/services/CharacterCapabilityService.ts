import type { Combatant, InventoryItem } from '@gate-life/shared';

/** Substrings that suggest the player is referring to gear (reduces false positives on "use the door"). */
const GEAR_HINT = new Set([
  'rifle', 'laser', 'pistol', 'gun', 'armor', 'radio', 'phone', 'grenade', 'medkit', 'knife',
  'sword', 'binocular', 'scope', 'clip', 'ammo', 'helmet', 'uniform', 'tablet', 'datapad',
  'rope', 'kit', 'tool', 'device', 'weapon', 'blade', 'shield', 'mask', 'goggles', 'optic',
  'launcher', 'cannon', 'mace', 'axe', 'bow', 'crossbow', 'mine', 'charge', 'detonator',
  'scanner', 'sensor', 'comm', 'backpack', 'holster', 'e-clip', 'eclip', 'pulse', 'coalition',
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/['']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Strip trailing parenthetical from power names, e.g. "Sixth Sense (2 ISP)" → "sixth sense". */
function stripPowerAnnotation(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

function tokenizeMeaningful(s: string): string[] {
  return norm(s)
    .split(/[\s/\-_,]+/)
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(w));
}

/** True if phrase plausibly refers to equipment (not just any verb object). */
function looksLikeGearPhrase(phrase: string): boolean {
  const n = norm(phrase);
  if (n.length < 3) return false;
  for (const h of GEAR_HINT) {
    if (n.includes(h)) return true;
  }
  // Model-style names: CP-40, M-16
  if (/\b[a-z]?\d{2,}|[a-z]{1,3}-\d+/i.test(phrase)) return true;
  return false;
}

function inventoryItemText(it: InventoryItem): string {
  const bits = [it.name];
  if (it.type) bits.push(String(it.type));
  return bits.join(' ');
}

/** Fuzzy: declared phrase matches an item name or shares significant tokens. */
function phraseMatchesInventory(phrase: string, items: InventoryItem[]): boolean {
  const p = norm(phrase);
  if (p.length < 2) return false;
  const ptoks = new Set(tokenizeMeaningful(phrase));

  for (const it of items) {
    const iname = norm(it.name);
    const full = norm(inventoryItemText(it));
    if (p.length >= 4 && (iname.includes(p) || p.includes(iname))) return true;
    if (iname.includes(p) || p.includes(iname)) return true;

    const itoks = new Set(tokenizeMeaningful(it.name));
    if (ptoks.size === 0) continue;
    let overlap = 0;
    for (const t of ptoks) {
      if (itoks.has(t) || iname.includes(t) || full.includes(t)) overlap++;
    }
    if (overlap >= 1 && (overlap >= Math.min(2, ptoks.size) || ptoks.size === 1)) return true;
  }
  return false;
}

function listMatchesSheet(candidate: string, entries: string[]): boolean {
  const c = norm(stripPowerAnnotation(candidate));
  if (c.length < 3) return false;
  for (const raw of entries) {
    const e = norm(stripPowerAnnotation(raw));
    if (!e) continue;
    if (c.includes(e) || e.includes(c)) return true;
    const ct = tokenizeMeaningful(candidate);
    const et = tokenizeMeaningful(raw);
    if (ct.some(t => et.includes(t)) || et.some(t => c.includes(t))) return true;
  }
  return false;
}

/**
 * Human-readable authoritative block for the GM prompt — full party sheets.
 */
export function formatPartyCapabilitiesSection(party: Combatant[]): string {
  if (party.length === 0) return '';
  const lines: string[] = [
    '',
    'PARTY CAPABILITIES (AUTHORITATIVE SHEET DATA — cross-check every declared item, skill, language, and psionic):',
  ];
  for (const c of party) {
    if (c.status === 'dead') continue;
    lines.push(...formatOneCombatantLines(c));
  }
  return lines.join('\n');
}

function formatOneCombatantLines(c: Combatant): string[] {
  const inv = (c.inventory ?? [])
    .map(it => {
      const q = it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : '';
      const eq = it.equipped ? ' (equipped)' : '';
      return `    - ${it.name}${q}${eq} [${it.type}]`;
    })
    .join('\n');
  const eq = c.equipped && Object.keys(c.equipped).length
    ? Object.entries(c.equipped).map(([slot, id]) => `    - ${slot}: ${id}`).join('\n')
    : '    (none recorded)';

  const skills = (c.skills ?? []).length
    ? (c.skills ?? []).map(s => `    - ${s}`).join('\n')
    : '    (none on record)';
  const psi = (c.psionic_powers ?? []).length
    ? (c.psionic_powers ?? []).map(s => `    - ${s}`).join('\n')
    : '    (none on record)';

  return [
    `  ${c.name} (id ends …${c.id.slice(-6)}):`,
    `  Inventory:`,
    inv || '    (empty)',
    `  Equipped slots:`,
    eq,
    `  Skills & languages (exact strings):`,
    skills,
    `  Psionic powers:`,
    psi,
    '',
  ];
}

export interface CapabilityAuditResult {
  /** Extra system lines to inject into the GM prompt for this exchange only. */
  gmInjection: string;
  /** Issues found (for logging). */
  issues: string[];
}

/**
 * Heuristic audit of a single message: declared use of gear / skills / psionics vs sheet.
 * False negatives/positives are possible; the GM prompt still lists full sheets.
 */
export function auditPlayerCapabilityClaims(
  message: string,
  actor: Combatant | undefined,
): CapabilityAuditResult {
  const issues: string[] = [];
  if (!actor || actor.status === 'dead') {
    return { gmInjection: '', issues };
  }

  const text = message;
  const inv = actor.inventory ?? [];
  const skills = actor.skills ?? [];
  const psi = actor.psionic_powers ?? [];

  // ── Equipment-like declarations ──
  const equipRe =
    /\b(?:use|draw|pull\s+out|take\s+out|wield|fire|shoot\s+with|activate|read|open|consult|scan\s+with|throw|toss)\s+(?:my|the|a|an)?\s*([^.,;!?\n]{2,55})/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = equipRe.exec(text)) !== null) {
    let phrase = m[1].trim();
    phrase = phrase.replace(/\s+(to|at|on|against)\s+.+$/i, '').trim();
    if (phrase.length < 3 || seen.has(norm(phrase))) continue;
    seen.add(norm(phrase));
    if (!looksLikeGearPhrase(phrase)) continue;
    if (phraseMatchesInventory(phrase, inv)) continue;
    issues.push(`Declared gear "${phrase.slice(0, 48)}" does not match any inventory item for ${actor.name}.`);
  }

  // ── Explicit "X skill" ──
  const skillRe = /\b(?:use|roll|rely\s+on)\s+(?:my\s+)?([^.!?,;]{3,60}?)\s+skill\b/gi;
  while ((m = skillRe.exec(text)) !== null) {
    const phrase = m[1].trim();
    if (listMatchesSheet(phrase, skills)) continue;
    issues.push(`Declared skill "${phrase.slice(0, 48)}" is not listed on ${actor.name}'s sheet.`);
  }

  // ── Speak/read a named language (avoid "speak to the guard") ──
  const langRe =
    /\b(?:speak|read|write|understand)\s+(?!to\b|with\b|up\b|out\b)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:language|tongue|dialect)?\b/g;
  const langRe2 = /\bin\s+([A-Z][a-z]+)\s+(?:language|tongue|dialect)\b/g;
  for (const re of [langRe, langRe2]) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const lang = m[1].trim();
      if (lang.length < 3) continue;
      const langNorm = norm(lang);
      const covered = skills.some(s => {
        const sn = norm(s);
        if (!sn.includes('language') && !sn.includes('literacy')) return false;
        return sn.includes(langNorm) || tokenizeMeaningful(lang).some(t => t.length > 3 && sn.includes(t));
      });
      if (!covered) {
        issues.push(`Language claim "${lang}" — verify ${actor.name} has a matching Language / Literacy skill entry.`);
      }
    }
  }
  const langLoose = /\b(?:speak|read)\s+(?!to\b|with\b)([a-z]{4,16})\s+fluently\b/gi;
  while ((m = langLoose.exec(text)) !== null) {
    const lang = m[1].trim();
    const langNorm = norm(lang);
    const covered = skills.some(s => norm(s).includes(langNorm));
    if (!covered) {
      issues.push(`Language fluency claim "${lang}" — not found on ${actor.name}'s skills list.`);
    }
  }

  // ── Psionic use ──
  const psiRe =
    /\b(?:manifest|cast|activate|use|channel|spend\s+isp\s+on)\s+(?:my\s+|the\s+)?(?:psi\s+|psionic\s+)?([A-Za-z][a-z0-9 '\-]{2,42})/gi;
  while ((m = psiRe.exec(text)) !== null) {
    let phrase = m[1].trim();
    phrase = phrase.replace(/\s+power$/i, '').trim();
    if (['isp', 'psionics', 'power', 'psi'].includes(norm(phrase))) continue;
    if (listMatchesSheet(phrase, psi)) continue;
    if (psi.length === 0) {
      issues.push(`${actor.name} has no psionic powers on record but declared psionic use: "${phrase.slice(0, 40)}".`);
    } else {
      issues.push(`Declared psionic "${phrase.slice(0, 40)}" does not match ${actor.name}'s known powers list.`);
    }
  }

  if (issues.length === 0) {
    return { gmInjection: '', issues };
  }

  const gmInjection = [
    '',
    `CAPABILITY AUDIT (this message from ${actor.name}) — treat as authoritative hints; if the player claims something not on their sheet above, narrate failure, absence, or correction — do NOT grant success for unavailable items/skills/powers:`,
    ...issues.map(line => `- ${line}`),
    '',
  ].join('\n');

  return { gmInjection, issues };
}

/**
 * Compact block for a single combatant (AI party member self-knowledge).
 */
export function formatSingleCombatantSelfKnowledge(c: Combatant): string {
  const inv = (c.inventory ?? []).map(it => it.name + (it.equipped ? ' (equipped)' : '')).join(', ') || 'nothing listed';
  const sk = (c.skills ?? []).join('; ') || 'none listed';
  const ps = (c.psionic_powers ?? []).join('; ') || 'none listed';
  return [
    `YOUR SHEET (you may ONLY claim to use these; invent nothing else):`,
    `- Inventory: ${inv}`,
    `- Skills / languages: ${sk}`,
    `- Psionic powers: ${ps}`,
  ].join('\n');
}
