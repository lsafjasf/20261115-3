// Replay engine + validator.
// Replays recorded inputs from the initial state and compares the
// state hash after every tick, locating the FIRST divergent tick.
import { initialState, update, hashState, serialize } from './game.js';

// Step-through replayer for the UI (pause / single-step / timeline).
export function createReplayer(recording) {
  const state = initialState(recording.seed);
  return {
    recording,
    state,
    cursor: 0, // how many recorded inputs have been applied
    done: false,
    step() {
      if (this.done) return null;
      const input = this.recording.inputs[this.cursor];
      update(this.state, input);
      this.cursor += 1;
      const actual = hashState(this.state);
      const expected = this.recording.hashes[this.cursor - 1] ?? null;
      if (this.cursor >= this.recording.inputs.length) this.done = true;
      return {
        tick: this.cursor, // 1-based tick just applied
        input,
        expected,
        actual,
        match: expected === actual,
      };
    },
  };
}

// Full validation: returns the first tick where the replayed state
// diverges from the recording, plus a per-tick diff timeline.
export function validate(recording) {
  const replayer = createReplayer(recording);
  const timeline = [];
  let firstDivergence = null;
  while (!replayer.done) {
    const r = replayer.step();
    timeline.push(r);
    if (!r.match && firstDivergence === null) {
      firstDivergence = {
        tick: r.tick,
        input: r.input,
        expected: r.expected,
        actual: r.actual,
        replayedState: serialize(replayer.state),
      };
    }
  }
  const finalHash = hashState(replayer.state);
  return {
    ok: firstDivergence === null && finalHash === recording.finalHash,
    firstDivergence,
    finalHash,
    expectedFinalHash: recording.finalHash,
    ticks: timeline.length,
    timeline,
  };
}
