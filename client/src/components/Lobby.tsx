import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useGame } from '../context/GameContext';

export function Lobby({ onStartGame }: { onStartGame: () => void }) {
  const { state, dispatch, actions } = useGame();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [gmKind, setGmKind] = useState<'human' | 'agent'>('agent');
  const [playerName, setPlayerName] = useState('');
  const [role, setRole] = useState<'gm' | 'player' | 'spectator'>('player');
  const [step, setStep] = useState<'campaigns' | 'join' | 'create_character'>('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  useEffect(() => {
    api.getCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) return;
    const result = await api.createCampaign({
      name: campaignName.trim(),
      gm_kind: gmKind,
      gm_user_id: gmKind === 'human' ? state.userId : undefined,
    }) as any;
    if (result) {
      setSelectedCampaign(result.campaign);
      dispatch({ type: 'SET_CAMPAIGN', payload: result.campaign });
      dispatch({ type: 'SET_SESSION', payload: result.session });
      setStep('create_character');
      setCreating(false);
    }
  };

  const handleJoinCampaign = async (campaign: any) => {
    setSelectedCampaign(campaign);
    dispatch({ type: 'SET_USER', payload: { userId: state.userId, role } });
    await actions.loadCampaign(campaign.id);
    setStep('join');
  };

  const handleCreateCharacter = async () => {
    if (!playerName.trim() || !selectedCampaign) return;
    const combatant = await api.createCombatant({
      campaign_id: selectedCampaign.id,
      name: playerName.trim(),
      kind: 'human',
    }) as any;
    if (combatant) {
      dispatch({ type: 'SET_MY_CHARACTER', payload: combatant.id });
      dispatch({ type: 'ADD_COMBATANT', payload: combatant });
      await actions.loadCampaign(selectedCampaign.id);
      onStartGame();
    }
  };

  const handleJoinAsSpectator = async () => {
    if (!selectedCampaign) return;
    dispatch({ type: 'SET_USER', payload: { userId: state.userId, role: 'spectator' } });
    await actions.loadCampaign(selectedCampaign.id);
    onStartGame();
  };

  const handleJoinExisting = async () => {
    if (!selectedCampaign) return;
    const party = state.party;
    if (party.length > 0) {
      dispatch({ type: 'SET_MY_CHARACTER', payload: party[0].id });
    }
    onStartGame();
  };

  return (
    <div className="lobby fade-in">
      {step === 'campaigns' && (
        <>
          <div className="lobby-hero">
            <h1 className="lobby-title">GATE<span className="accent">LIFE</span></h1>
            <p className="tagline">Dimensional gate runners. Psionic hunters. Survivors.</p>
            <p className="subtitle text-dim">A Rifts-inspired tactical RPG</p>
          </div>

          <div className="lobby-section">
            <div className="lobby-actions">
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                New Campaign
              </button>
              <div className="role-selector">
                <label className="text-xs text-dim">Join as:</label>
                <select value={role} onChange={(e) => setRole(e.target.value as any)}>
                  <option value="gm">Game Master</option>
                  <option value="player">Player</option>
                  <option value="spectator">Spectator</option>
                </select>
              </div>
            </div>

            {campaigns.length > 0 && (
              <div className="campaign-list">
                <h3 className="text-sm">Existing Campaigns</h3>
                {campaigns.map(c => (
                  <div key={c.id} className="campaign-card panel" onClick={() => handleJoinCampaign(c)}>
                    <span className="campaign-card-name">{c.name}</span>
                    <span className="text-xs text-dim">GM: {c.gm_kind}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {creating && (
            <div className="create-dialog panel fade-in">
              <h3>Create New Campaign</h3>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Campaign name..."
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCampaign()}
              />
              <div className="gm-selector">
                <label className="text-xs">Game Master:</label>
                <select value={gmKind} onChange={(e) => setGmKind(e.target.value as any)}>
                  <option value="human">Human</option>
                  <option value="agent">AI Agent</option>
                </select>
              </div>
              <div className="dialog-actions">
                <button className="btn btn-primary" onClick={handleCreateCampaign}>Create</button>
                <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {step === 'join' && selectedCampaign && (
        <div className="join-screen fade-in">
          <h2>Join: {selectedCampaign.name}</h2>
          {state.party.length > 0 ? (
            <div>
              <p className="text-sm text-secondary">Party already has members. Join existing session?</p>
              <div className="dialog-actions">
                <button className="btn btn-primary" onClick={handleJoinExisting}>Join Game</button>
                <button className="btn" onClick={handleJoinAsSpectator}>Watch as Spectator</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-secondary">Create your character to join.</p>
              <button className="btn btn-primary" onClick={() => setStep('create_character')}>Create Character</button>
              <button className="btn" onClick={handleJoinAsSpectator}>Watch as Spectator</button>
            </div>
          )}
        </div>
      )}

      {step === 'create_character' && (
        <div className="create-character fade-in">
          <h2>Create Your Dog Boy</h2>
          <p className="text-sm text-secondary">
            Choose a name for your Dog Boy. All stats are pre-set from the Psi-Hound template.
          </p>
          <div className="create-form">
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Name your Dog Boy..."
              className="name-input"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCharacter()}
              autoFocus
            />
            <div className="class-preview panel">
              <h4>Dog Boy (Psi-Hound)</h4>
              <p className="text-xs text-dim">Coalition mutant canine psychic tracker</p>
              <div className="preview-stats text-xs">
                <span>HP 13 | SDC 40 | ISP 21</span>
                <span>Armor: CA-3 (70 MDC)</span>
                <span>Weapon: CP-40 Pulse Laser</span>
                <span>Powers: Sixth Sense, Empathy, See Aura</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={handleCreateCharacter}>
                Enter the Gate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
