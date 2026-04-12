import { useRef, useEffect, useState, useCallback } from 'react';
import { useGame } from '../context/GameContext';

export function VitalsPanel({ combatantId }: { combatantId: string }) {
  const { ws } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<Array<{ bpm: number; time: number }>>([]);
  const [currentBpm, setCurrentBpm] = useState(72);
  const MAX_SAMPLES = 300;

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const samples = samplesRef.current;

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, width, height);

    if (samples.length < 2) return;

    ctx.strokeStyle = '#1a2230';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < height; y += height / 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const minBpm = 40;
    const maxBpm = 200;
    const range = maxBpm - minBpm;

    ctx.beginPath();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#c0392b';
    ctx.shadowBlur = 4;

    for (let i = 0; i < samples.length; i++) {
      const x = (i / MAX_SAMPLES) * width;
      const y = height - ((samples[i].bpm - minBpm) / range) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, []);

  useEffect(() => {
    const unsub = ws.subscribe('vital_sample', (msg) => {
      const payload = msg.payload as { combatant_id: string; pulse_bpm: number };
      if (payload.combatant_id !== combatantId) return;

      samplesRef.current.push({ bpm: payload.pulse_bpm, time: Date.now() });
      if (samplesRef.current.length > MAX_SAMPLES) {
        samplesRef.current.shift();
      }
      setCurrentBpm(payload.pulse_bpm);
      drawChart();
    });
    return unsub;
  }, [combatantId, ws.subscribe, drawChart]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  return (
    <div className="vitals-chart">
      <div className="vitals-chart-header">
        <span className="text-xs text-dim">PULSE</span>
        <span className="mono" style={{ color: currentBpm > 160 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
          {currentBpm} BPM
        </span>
      </div>
      <canvas ref={canvasRef} width={280} height={60} className="pulse-canvas" />
    </div>
  );
}
