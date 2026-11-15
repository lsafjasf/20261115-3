'use strict';

// Canonical event specification for the 20 s / 24 fps timeline.
// Flash times are authored on frame boundaries (or half-frame slots),
// beat times come from an upstream musical analysis pass and are not
// frame aligned, which is why a calibration offset is required.

const FLASH_TIMES = [
  1,
  2.625,
  4.291666666666666,
  5.916666666666666,
  7.541666666666666,
  9.166666666666666,
  10.833333333333332,
  12.458333333333332,
  14.083333333333332,
  15.708333333333332,
  17.375,
  19,
];

const BEAT_TIMES = [
  0.438657,
  2.09015,
  3.720999,
  5.350145,
  6.981353,
  8.600608,
  10.307996,
  11.931003,
  13.547489,
  15.145426,
  16.849802,
  18.465001,
];

module.exports = {
  EVENT_COUNT: 12,
  FLASH_TIMES,
  BEAT_TIMES,
};
