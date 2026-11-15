import { flattenSyllables } from "./model.js";

// 纯函数：把播放状态翻译成逐字高亮描述，视图层只负责套用
export function describeHighlight(song, state) {
  const syllables = flattenSyllables(song);
  const syllableStates = syllables.map((syllable, index) => {
    let status = "upcoming";
    if (index < state.activeIndex) status = "done";
    if (index === state.activeIndex && state.progress < 1) status = "active";
    return {
      id: syllable.id,
      index,
      status,
      progress: index === state.activeIndex ? state.progress : status === "done" ? 1 : 0,
    };
  });

  const lineStates = song.bars.map((bar, barIndex) => ({
    barIndex,
    active: barIndex === state.barIndex,
    // 节拍脉冲：每拍起点最强，随相位衰减；每帧由 transport 位置重算
    pulse: barIndex === state.barIndex ? 1 - state.beatPhase : 0,
  }));

  return { syllableStates, lineStates };
}
