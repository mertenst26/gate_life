import type { Enemy } from "@gate-life/shared";
import { enemyMapTokenKind } from "@gate-life/shared";

function StatBar({
	label,
	current,
	max,
	color,
}: {
	label: string;
	current: number;
	max: number;
	color: string;
}) {
	const pct = max > 0 ? (current / max) * 100 : 0;
	return (
		<div className="stat-bar-row">
			<span className="stat-label text-xs">{label}</span>
			<div className="stat-bar">
				<div
					className="stat-fill"
					style={{ width: `${Math.max(0, pct)}%`, background: color }}
				/>
			</div>
			<span className="stat-value text-xs mono">
				{current}/{max}
			</span>
		</div>
	);
}

export function EnemyInspector({
	enemy,
	onClose,
}: {
	enemy: Enemy;
	onClose: () => void;
}) {
	const kind = enemyMapTokenKind(enemy);

	return (
		<div
			className="inspector-overlay"
			onClick={(e) => e.target === e.currentTarget && onClose()}
		>
			<div className="inspector panel fade-in">
				<div className="inspector-header">
					<div>
						<h3 className="inspector-name">
							{enemy.name}
							{enemy.status === "dead" && (
								<span
									className="text-sm text-dim"
									style={{ color: "#c0392b", marginLeft: "8px" }}
								>
									☠ DEAD
								</span>
							)}
						</h3>
						<span className="text-sm text-dim">
							{kind} · {enemy.enemy_type}
						</span>
					</div>
					<div className="inspector-badges">
						<span
							className={`kind-badge ${enemy.status === "dead" ? "dead" : kind}`}
						>
							{enemy.status === "dead" ? "CORPSE" : kind.toUpperCase()}
						</span>
						<button className="btn text-xs" onClick={onClose}>
							&#x2715;
						</button>
					</div>
				</div>

				<div className="inspector-body">
					{/* Vitals */}
					<section className="inspector-section">
						<h4>Vitals</h4>
						<StatBar
							label="HP"
							current={enemy.hp_current}
							max={enemy.hp_max}
							color="var(--accent-red)"
						/>
						<StatBar
							label="SDC"
							current={enemy.sdc_current}
							max={enemy.sdc_max}
							color="var(--accent-amber)"
						/>
						{enemy.mdc_max && enemy.mdc_max > 0 && (
							<StatBar
								label="MDC"
								current={enemy.mdc_current ?? 0}
								max={enemy.mdc_max}
								color="var(--accent-purple)"
							/>
						)}
					</section>

					{/* Combat Stats */}
					<section className="inspector-section">
						<h4>Combat</h4>
						<div className="combat-stats">
							<div className="stat-row">
								<span>APM</span>
								<span className="mono">{enemy.apm}</span>
							</div>
							<div className="stat-row">
								<span>Initiative</span>
								<span className="mono">+{enemy.initiative_bonus}</span>
							</div>
							<div className="stat-row">
								<span>Strike</span>
								<span className="mono">+{enemy.strike_bonus}</span>
							</div>
							<div className="stat-row">
								<span>Parry</span>
								<span className="mono">+{enemy.parry_bonus}</span>
							</div>
							<div className="stat-row">
								<span>Dodge</span>
								<span className="mono">+{enemy.dodge_bonus}</span>
							</div>
							<div className="stat-row">
								<span>Damage</span>
								<span className="mono">
									{enemy.damage} ({enemy.damage_type})
								</span>
							</div>
						</div>
					</section>

					{/* Position */}
					{enemy.tactical_x != null && enemy.tactical_y != null && (
						<section className="inspector-section">
							<h4>Position</h4>
							<div className="combat-stats">
								<div className="stat-row">
									<span>Grid X</span>
									<span className="mono">{enemy.tactical_x}</span>
								</div>
								<div className="stat-row">
									<span>Grid Y</span>
									<span className="mono">{enemy.tactical_y}</span>
								</div>
								{enemy.facing && (
									<div className="stat-row">
										<span>Facing</span>
										<span className="mono">{enemy.facing}</span>
									</div>
								)}
							</div>
						</section>
					)}

					{/* Abilities */}
					{enemy.abilities && enemy.abilities.length > 0 && (
						<section className="inspector-section">
							<h4>Abilities</h4>
							<ul className="entity-detail-list">
								{enemy.abilities.map((ability, i) => (
									<li key={i} className="entity-detail-list-item text-sm">
										{ability}
									</li>
								))}
							</ul>
						</section>
					)}

					{/* Search Body / Loot */}
					{enemy.status === "dead" &&
						enemy.loot_table &&
						enemy.loot_table.length > 0 && (
							<section
								className="inspector-section"
								style={{ borderColor: "#d4a057" }}
							>
								<h4 style={{ color: "#d4a057" }}>🔍 Search Body</h4>
								<p className="text-sm text-dim" style={{ marginBottom: "8px" }}>
									You can search this corpse for items:
								</p>
								<ul className="entity-detail-list">
									{enemy.loot_table.map((loot, i) => (
										<li key={i} className="entity-detail-list-item text-sm">
											{loot.item_id} ({loot.chance}% chance, qty:{" "}
											{loot.quantity_min}-{loot.quantity_max})
										</li>
									))}
								</ul>
							</section>
						)}

					{/* Loot Table (for alive enemies) */}
					{enemy.status !== "dead" &&
						enemy.loot_table &&
						enemy.loot_table.length > 0 && (
							<section className="inspector-section">
								<h4>Loot Table</h4>
								<ul className="entity-detail-list">
									{enemy.loot_table.map((loot, i) => (
										<li key={i} className="entity-detail-list-item text-sm">
											{loot.item_id} ({loot.chance}% chance, qty:{" "}
											{loot.quantity_min}-{loot.quantity_max})
										</li>
									))}
								</ul>
							</section>
						)}
				</div>
			</div>
		</div>
	);
}
