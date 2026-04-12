import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../../../class_templates');

export interface ClassTemplate {
  id: string;
  name: string;
  description: string;
  attributes: Record<string, number>;
  base_hp: number;
  base_sdc: number;
  base_isp: number;
  base_ppe: number;
  combat: Record<string, number>;
  innate_abilities: any[];
  starting_psionic_powers: any[];
  unlockable_psionic_powers: any[];
  skills: string[];
  starting_gear: any[];
  unique_actions: any[];
  progression: any;
  personality_presets: any[];
}

let templates: Map<string, ClassTemplate> | null = null;

export function loadTemplates(): Map<string, ClassTemplate> {
  if (templates) return templates;
  templates = new Map();
  
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.warn('[templates] Templates directory not found:', TEMPLATES_DIR);
    return templates;
  }

  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    const tmpl = YAML.parse(content) as ClassTemplate;
    templates.set(tmpl.id, tmpl);
    console.log(`[templates] Loaded class template: ${tmpl.id} (${tmpl.name})`);
  }
  return templates;
}

export function getTemplate(classId: string): ClassTemplate | undefined {
  return loadTemplates().get(classId);
}

export function listTemplates(): ClassTemplate[] {
  return Array.from(loadTemplates().values());
}
