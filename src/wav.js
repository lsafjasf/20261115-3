(function () {
  "use strict";

  function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  function encodeWav(channels, sampleRate, bitDepth) {
    const bytesPerSample = bitDepth / 8;
    const channelCount = channels.length;
    const frameCount = channels[0].length;
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    if (bitDepth === 16) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const value = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
          const integer = Math.round(value < 0 ? value * 32768 : value * 32767);
          view.setInt16(offset, integer, true);
          offset += 2;
        }
      }
    } else if (bitDepth === 24) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const value = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
          const integer = Math.round(value < 0 ? value * 8388608 : value * 8388607);
          view.setUint8(offset, integer & 0xff);
          view.setUint8(offset + 1, (integer >> 8) & 0xff);
          view.setUint8(offset + 2, (integer >> 16) & 0xff);
          offset += 3;
        }
      }
    } else {
      throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
    }

    return buffer;
  }

  function analyzeChannels(channels, sampleRate) {
    const channelCount = channels.length;
    const frameCount = channels.length ? channels[0].length : 0;
    let peak = 0;
    let sumSquares = 0;
    let clippedSamples = 0;
    const channelPeaks = new Array(channelCount).fill(0);
    const channelSums = new Array(channelCount).fill(0);
    const segmentCount = 16;
    const segmentSums = new Array(segmentCount).fill(0);

    for (let channel = 0; channel < channelCount; channel += 1) {
      const samples = channels[channel];
      for (let frame = 0; frame < samples.length; frame += 1) {
        const value = samples[frame];
        const magnitude = Math.abs(value);
        peak = Math.max(peak, magnitude);
        channelPeaks[channel] = Math.max(channelPeaks[channel], magnitude);
        sumSquares += value * value;
        channelSums[channel] += value * value;
        const segment = Math.min(
          segmentCount - 1,
          Math.floor((frame / Math.max(1, frameCount)) * segmentCount)
        );
        segmentSums[segment] += value * value;
        if (magnitude >= 0.999) clippedSamples += 1;
      }
    }

    const totalSamples = Math.max(1, frameCount * channelCount);
    const segmentSamples = Math.max(1, frameCount / segmentCount);
    return {
      sampleRate,
      channels: channelCount,
      frames: frameCount,
      duration: frameCount / sampleRate,
      peak,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      rms: Math.sqrt(sumSquares / totalSamples),
      rmsDb: sumSquares > 0 ? 10 * Math.log10(sumSquares / totalSamples) : -Infinity,
      clippedSamples,
      channelPeaks,
      channelRms: channelSums.map((sum) => Math.sqrt(sum / Math.max(1, frameCount))),
      waveformRms: segmentSums.map((sum) =>
        Math.sqrt(sum / (segmentSamples * Math.max(1, channelCount)))
      )
    };
  }

  function analyzeAudioBuffer(audioBuffer) {
    const channels = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      channels.push(audioBuffer.getChannelData(channel));
    }
    return analyzeChannels(channels, audioBuffer.sampleRate);
  }

  function encodeAudioBuffer(audioBuffer, bitDepth) {
    const channels = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      channels.push(audioBuffer.getChannelData(channel));
    }
    return encodeWav(channels, audioBuffer.sampleRate, bitDepth || 16);
  }

  window.WavEncoder = {
    encodeWav,
    analyzeChannels,
    analyzeAudioBuffer,
    encodeAudioBuffer
  };
})();
