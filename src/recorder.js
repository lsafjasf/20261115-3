// Records everything needed to reproduce a run deterministically:
// the RNG seed, one input per tick, and the state hash after each tick.
import { hashState } from './game.js';

export function createRecording(seed) {
  return {
    version: 1,
    seed,
    inputs: [],      // inputs[t] is applied to go from tick t to tick t+1
    hashes: [],      // hashes[t] is the state hash AFTER tick t+1
    finalHash: null, // hashes[hashes.length - 1] once the run ends
  };
}

export function recordTick(recording, input, state) {
  recording.inputs.push(input);
  recording.hashes.push(hashState(state));
}

export function finalize(recording, state) {
  recording.finalHash = hashState(state);
  return recording;
}
