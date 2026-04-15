import type {
	GmKind,
	ScenarioEntity,
	WanderingMonsterConfig,
} from "@gate-life/shared";

export interface ReviewStepProps {
	name: string;
	description: string;
	gmKind: GmKind;
	startLat: number;
	startLng: number;
	wanderingMonsterConfig: WanderingMonsterConfig | null;
	entities: ScenarioEntity[];
	saving: boolean;
	onSave: () => void;
	onBackToMap: () => void;
	onDeleteEntity: (entityId: string) => void;
}

export function ReviewStep({
	name,
	description,
	gmKind,
	startLat,
	startLng,
	wanderingMonsterConfig,
	entities,
	saving,
	onSave,
	onBackToMap,
	onDeleteEntity,
}: ReviewStepProps) {
	return (
		<div className="scenario-review-step fade-in">
			<div className="scenario-review panel">
				<h3>Review Scenario</h3>
				<div className="review-meta">
					<p>
						<strong>Name:</strong> {name}
					</p>
					{description && (
						<p>
							<strong>Description:</strong> {description}
						</p>
					)}
					<p>
						<strong>GM:</strong> {gmKind === "agent" ? "AI Agent" : "Human"}
					</p>
					<p>
						<strong>Start:</strong> ({startLat.toFixed(4)},{" "}
						{startLng.toFixed(4)})
					</p>
					{wanderingMonsterConfig?.enabled ? (
						<p>
							<strong>Wandering Monster:</strong>{" "}
							{wanderingMonsterConfig.monster_name}{" "}
							<span className="text-dim">
								({wanderingMonsterConfig.encounter_chance}% per turn)
							</span>
						</p>
					) : (
						<p>
							<strong>Wandering Monster:</strong>{" "}
							<span className="text-dim">Disabled</span>
						</p>
					)}
				</div>

				<h4>Entities ({entities.length})</h4>
				{entities.length === 0 ? (
					<p className="text-sm text-dim">No entities placed yet.</p>
				) : (
					<div className="entity-list">
						{entities.map((e) => (
							<div key={e.id} className="entity-card panel">
								<div className="entity-card-info">
									<span className={`entity-type-badge ${e.entity_type}`}>
										{e.entity_type.toUpperCase()}
									</span>
									<strong>{e.name}</strong>
									<span className="text-xs text-dim">
										({e.lat.toFixed(4)}, {e.lng.toFixed(4)})
									</span>
								</div>
								<button
									className="btn btn-sm btn-danger"
									onClick={() => onDeleteEntity(e.id)}
								>
									Remove
								</button>
							</div>
						))}
					</div>
				)}

				<div className="dialog-actions">
					<button className="btn" onClick={onBackToMap}>
						&larr; Back to Map
					</button>
					<button
						className="btn btn-primary"
						onClick={onSave}
						disabled={saving}
					>
						{saving ? "Saving..." : "Save Scenario"}
					</button>
				</div>
			</div>
		</div>
	);
}
