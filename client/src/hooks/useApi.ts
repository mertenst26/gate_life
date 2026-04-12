import { useState, useCallback } from 'react';

const BASE_URL = '/api';

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || res.statusText);
  }
  return res.json();
}

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <T>(url: string, opts?: RequestInit): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<T>(url, opts);
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { request, loading, error };
}

// Direct API functions (no hook, for use in callbacks)
export const api = {
  getCampaigns: () => fetchJson<unknown[]>('/campaigns'),
  createCampaign: (data: { name: string; gm_kind: string; gm_user_id?: string }) =>
    fetchJson<unknown>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),

  getSession: (id: string) => fetchJson<unknown>(`/sessions/${id}`),
  getActiveSession: (campaignId: string) => fetchJson<unknown>(`/sessions/campaign/${campaignId}/active`),
  changeMode: (sessionId: string, mode: string) =>
    fetchJson<unknown>(`/sessions/${sessionId}/mode`, { method: 'POST', body: JSON.stringify({ mode }) }),

  getParty: (campaignId: string) => fetchJson<unknown[]>(`/combatants?campaign_id=${campaignId}`),
  getCombatant: (id: string) => fetchJson<unknown>(`/combatants/${id}`),
  createCombatant: (data: { campaign_id: string; name: string; kind: string; personality_preset?: string }) =>
    fetchJson<unknown>('/combatants', { method: 'POST', body: JSON.stringify(data) }),
  respawnAgent: (data: { campaign_id: string; name: string; personality_preset?: string }) =>
    fetchJson<unknown>('/combatants/respawn', { method: 'POST', body: JSON.stringify(data) }),
  getVitalHistory: (combatantId: string) => fetchJson<unknown[]>(`/combatants/${combatantId}/vitals/history`),

  getMessages: (campaignId: string, sessionId?: string) =>
    fetchJson<unknown[]>(`/messages?campaign_id=${campaignId}${sessionId ? `&session_id=${sessionId}` : ''}`),
  sendMessage: (data: { campaign_id: string; session_id?: string; actor_id?: string; message_type: string; content: string; visibility?: string }) =>
    fetchJson<unknown>('/messages', { method: 'POST', body: JSON.stringify(data) }),

  performAction: (data: { session_id: string; combatant_id: string; action_type: string; target_id?: string; data?: unknown }) =>
    fetchJson<unknown>('/actions', { method: 'POST', body: JSON.stringify(data) }),
  endTurn: (sessionId: string) =>
    fetchJson<unknown>('/actions/end-turn', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) }),
  changeGameMode: (sessionId: string, mode: string) =>
    fetchJson<{ success: boolean; mode: string; turn_state: unknown }>(`/sessions/${sessionId}/mode`, { method: 'POST', body: JSON.stringify({ mode }) }),

  getGameState: (campaignId: string) => fetchJson<unknown>(`/state/campaign/${campaignId}`),
  getTemplates: () => fetchJson<unknown[]>('/state/templates'),

  getTerrain: (sessionId: string, cx: number, cy: number, radius = 60) =>
    fetchJson<{
      tiles: Array<{ x: number; y: number; terrain_type: string; metadata?: Record<string, unknown> }>;
      buildings: Array<{ gridPoly: Array<[number, number]> }>;
      roads: Array<{ gridLine: Array<[number, number]>; highway: string }>;
    }>(`/terrain?session_id=${sessionId}&cx=${cx}&cy=${cy}&radius=${radius}`),
};
