import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";

const posterPath = path.resolve(process.argv[2] || "artifacts/signal-form-access-poster.png");
const reportPath = path.resolve(process.argv[3] || "artifacts/verification.json");
const paramsPath = path.resolve("artifacts/signal-form-access-params.json");
const fallbackContent = "https://form-noise.studio/access";

const params = fs.existsSync(paramsPath)
  ? JSON.parse(fs.readFileSync(paramsPath, "utf8"))
  : null;
const expected = process.env.QR_EXPECTED || params?.qr?.content || fallbackContent;
const image = PNG.sync.read(fs.readFileSync(posterPath));
const rgba = new Uint8ClampedArray(image.data);
const luminance = new Uint8ClampedArray(image.width * image.height);

for (let index = 0; index < luminance.length; index += 1) {
  const offset = index * 4;
  luminance[index] = Math.round(
    rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
  );
}

const started = performance.now();
const jsQrResult = jsQR(rgba, image.width, image.height, { inversionAttempts: "attemptBoth" });
const jsQrMs = Math.round(performance.now() - started);

let zxingResult = null;
let zxingError = null;
const zxingStarted = performance.now();
try {
  const source = new RGBLuminanceSource(luminance, image.width, image.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  zxingResult = new QRCodeReader().decode(bitmap);
} catch (error) {
  zxingError = error?.message || String(error);
}
const zxingMs = Math.round(performance.now() - zxingStarted);

const report = {
  poster: path.relative(process.cwd(), posterPath),
  dimensions: { width: image.width, height: image.height },
  expected,
  decoders: [
    {
      name: "jsQR",
      version: "1.4.0",
      status: jsQrResult?.data === expected ? "passed" : "failed",
      decoded: jsQrResult?.data || null,
      durationMs: jsQrMs,
    },
    {
      name: "ZXing",
      version: "0.21.x",
      status: zxingResult?.getText() === expected ? "passed" : "failed",
      decoded: zxingResult?.getText() || null,
      error: zxingError,
      durationMs: zxingMs,
    },
  ],
  passed: jsQrResult?.data === expected && zxingResult?.getText() === expected,
  verifiedAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (!report.passed) process.exitCode = 1;
