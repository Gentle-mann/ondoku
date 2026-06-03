import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "assets", "audio");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "stylesgo-ops-groove.wav");

const sampleRate = 44100;
const duration = 54;
const frames = Math.floor(sampleRate * duration);
const bpm = 92;
const beat = 60 / bpm;
const twoPi = Math.PI * 2;

const chords = [
  { root: 82.41, notes: [164.81, 196.0, 246.94, 329.63] },
  { root: 65.41, notes: [130.81, 164.81, 196.0, 261.63] },
  { root: 73.42, notes: [146.83, 196.0, 246.94, 392.0] },
  { root: 73.42, notes: [146.83, 185.0, 220.0, 293.66] },
];

function chordAt(t) {
  return chords[Math.floor(t / (beat * 8)) % chords.length];
}

function decay(phase, speed) {
  return Math.exp(-speed * phase);
}

let seed = 123456789;
function rand() {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return (seed / 0xffffffff) * 2 - 1;
}

const data = Buffer.alloc(44 + frames * 4);
function writeString(offset, value) {
  data.write(value, offset, "ascii");
}
function writeU32(offset, value) {
  data.writeUInt32LE(value >>> 0, offset);
}
function writeU16(offset, value) {
  data.writeUInt16LE(value, offset);
}

writeString(0, "RIFF");
writeU32(4, 36 + frames * 4);
writeString(8, "WAVE");
writeString(12, "fmt ");
writeU32(16, 16);
writeU16(20, 1);
writeU16(22, 2);
writeU32(24, sampleRate);
writeU32(28, sampleRate * 4);
writeU16(32, 4);
writeU16(34, 16);
writeString(36, "data");
writeU32(40, frames * 4);

for (let i = 0; i < frames; i += 1) {
  const t = i / sampleRate;
  const chord = chordAt(t);
  const beatPhase = (t % beat) / beat;
  const halfBeat = beat / 2;
  const halfPhase = (t % halfBeat) / halfBeat;
  const fadeIn = Math.min(1, t / 2.5);
  const fadeOut = Math.min(1, (duration - t) / 3.5);
  const fade = Math.max(0, Math.min(fadeIn, fadeOut));

  let pad = 0;
  chord.notes.forEach((note, index) => {
    pad += Math.sin(twoPi * note * t + index * 0.31) * 0.022;
  });
  pad *= 0.72 + 0.28 * Math.sin(twoPi * 0.085 * t);

  const bassEnv = decay((t % (beat * 2)) / (beat * 2), 2.8);
  const bass = Math.sin(twoPi * chord.root * t) * 0.045 * bassEnv;

  const arpIndex = Math.floor(t / halfBeat) % chord.notes.length;
  const arpFreq = chord.notes[arpIndex] * 2;
  const pluck = Math.sin(twoPi * arpFreq * t) * 0.035 * decay(halfPhase, 7.5);

  const kickEnv = beatPhase < 0.22 ? decay(beatPhase / 0.22, 4.5) : 0;
  const kick = Math.sin(twoPi * (54 + 24 * kickEnv) * t) * 0.055 * kickEnv;

  const offBeat = Math.abs(beatPhase - 0.5);
  const hatEnv = offBeat < 0.055 ? decay(offBeat / 0.055, 5.5) : 0;
  const hat = rand() * 0.012 * hatEnv;

  const mix = (pad + bass + pluck + kick + hat) * fade;
  const left = Math.max(-1, Math.min(1, mix * 0.88 + pad * 0.1));
  const right = Math.max(
    -1,
    Math.min(
      1,
      mix * 0.88 +
        Math.sin(twoPi * chord.notes[(arpIndex + 1) % chord.notes.length] * 2 * t + 0.18) *
          0.006 *
          decay(halfPhase, 7.5),
    ),
  );

  data.writeInt16LE(Math.round(left * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(right * 32767), 44 + i * 4 + 2);
}

fs.writeFileSync(outPath, data);
console.log(outPath);
