import {
  GRID,
  auditFlow,
  channelMetrics,
  createSimulation,
  generateTerrain,
  hydrologySignature,
  stepSimulation,
} from './engine.js';

export const COMPARISON_RAINFALLS = Object.freeze([45, 100, 175]);
export const COMPARISON_STEPS = 18;

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function simulateComparisonScenario(seed, rainfall, hardness, dt, steps = COMPARISON_STEPS) {
  const terrain = generateTerrain(seed);
  const simulation = createSimulation(terrain, { rainfall, hardness, dt });
  stepSimulation(simulation, steps);
  const audit = auditFlow(simulation);
  const channels = channelMetrics(simulation);
  const cellArea = GRID.cellSize * GRID.cellSize;
  return {
    rainfall,
    seed,
    hardness,
    dt,
    steps,
    outletFlow: simulation.hydrology.outletFlow,
    eroded: simulation.totals.eroded,
    deposited: simulation.totals.deposited,
    erodedVolume: simulation.totals.eroded * cellArea,
    depositedVolume: simulation.totals.deposited * cellArea,
    channelLengthKm: channels.lengthKm,
    conservationError: audit.relativeError,
    discontinuity: audit.discontinuity,
    cycles: audit.cycles,
    signature: hydrologySignature(simulation),
    terrainHash: hydrologySignature(simulation).split('-')[0],
    hydrologyHash: hydrologySignature(simulation).split('-').slice(1).join('-'),
    finalElevation: simulation.terrain.elevation,
    finalFlow: simulation.hydrology.flow,
  };
}

export async function runRainfallComparison({
  seed,
  hardness,
  dt,
  rainfalls = COMPARISON_RAINFALLS,
  steps = COMPARISON_STEPS,
  yieldControl = true,
}) {
  const results = [];
  for (let index = 0; index < rainfalls.length; index += 1) {
    if (yieldControl) await new Promise((resolve) => setTimeout(resolve, 0));
    const first = simulateComparisonScenario(seed, rainfalls[index], hardness, dt, steps);
    if (yieldControl) await new Promise((resolve) => setTimeout(resolve, 0));
    const replay = simulateComparisonScenario(seed, rainfalls[index], hardness, dt, steps);
    results.push({
      id: ['low', 'mid', 'high'][index] || `run-${index + 1}`,
      label: index === 0 ? '低雨强' : index === 1 ? '中雨强' : '高雨强',
      ...first,
      replaySignature: replay.signature,
      reproducible: first.signature === replay.signature
        && first.discontinuity === replay.discontinuity,
      signature: first.signature,
      finalElevation: undefined,
      finalFlow: undefined,
    });
  }

  const maxEroded = Math.max(...results.map((result) => result.eroded));
  const maxDeposited = Math.max(...results.map((result) => result.deposited));
  return {
    seed,
    hardness,
    dt,
    steps,
    generatedAt: new Date().toISOString(),
    results: results.map((result) => ({
      ...result,
      erosionIndex: rounded(result.eroded / maxEroded, 3),
      depositionIndex: rounded(result.deposited / maxDeposited, 3),
      outletFlow: rounded(result.outletFlow, 3),
      erodedVolume: rounded(result.erodedVolume, 0),
      depositedVolume: rounded(result.depositedVolume, 0),
      channelLengthKm: rounded(result.channelLengthKm, 2),
    })),
    allReproducible: results.every((result) => result.reproducible),
  };
}

export function comparisonCsv(comparison) {
  const header = [
    'rainfall_mm_h',
    'outlet_flow_m3_s',
    'eroded_m3',
    'deposited_m3',
    'channel_km',
    'conservation_rel_error',
    'signature',
    'reproducible',
  ];
  const lines = comparison.results.map((result) => [
    result.rainfall,
    result.outletFlow,
    result.erodedVolume,
    result.depositedVolume,
    result.channelLengthKm,
    result.conservationError.toExponential(6),
    result.signature,
    result.reproducible ? 'yes' : 'no',
  ].join(','));
  return [header.join(','), ...lines].join('\n');
}
