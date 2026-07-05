const presets = {
  balanced: { brightness: 0.5, warmth: 0.8, glue: 3, ceiling: -1.4 },
  warm: { brightness: -0.8, warmth: 2.8, glue: 3, ceiling: -1.5 },
  punchy: { brightness: 0.8, warmth: 1.2, glue: 5, ceiling: -1.2 },
  loud: { brightness: 1.0, warmth: 0.6, glue: 6, ceiling: -1.1 },
  streaming: { brightness: 0, warmth: 0.7, glue: 2, ceiling: -1.8 },
};

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileStatus = document.querySelector("#fileStatus");
const processButton = document.querySelector("#processButton");
const demoButton = document.querySelector("#demoButton");
const playToggleButton = document.querySelector("#playToggleButton");
const monitorOriginal = document.querySelector("#monitorOriginal");
const monitorMastered = document.querySelector("#monitorMastered");
const seekBar = document.querySelector("#seekBar");
const timeText = document.querySelector("#timeText");
const downloadLink = document.querySelector("#downloadLink");
const levelText = document.querySelector("#levelText");
const reductionText = document.querySelector("#reductionText");
const reductionBar = document.querySelector("#reductionBar");
const inputCanvas = document.querySelector("#inputCanvas");
const outputCanvas = document.querySelector("#outputCanvas");
const sliders = {
  brightness: document.querySelector("#brightness"),
  warmth: document.querySelector("#warmth"),
  glue: document.querySelector("#glue"),
  ceiling: document.querySelector("#ceiling"),
};

let audioContext;
let sourceBuffer;
let masteredBuffer;
let currentObjectUrl;
let currentSource;
let isPlaying = false;
let activeMonitor = "original";
let playbackOffset = 0;
let playbackStartedAt = 0;
let seekTimer;
let lastAnalysis = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function gainToDb(gain) {
  return 20 * Math.log10(Math.max(gain, 0.000001));
}

function getCurrentBuffer() {
  return activeMonitor === "mastered" && masteredBuffer ? masteredBuffer : sourceBuffer;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function currentPosition() {
  const buffer = getCurrentBuffer();
  if (!buffer) return 0;
  if (!isPlaying) return playbackOffset;
  const context = getAudioContext();
  return Math.min(buffer.duration, playbackOffset + context.currentTime - playbackStartedAt);
}

function updateTransport() {
  const buffer = getCurrentBuffer();
  const position = currentPosition();
  if (!buffer) {
    seekBar.value = 0;
    timeText.textContent = "0:00 / 0:00";
    return;
  }

  seekBar.value = buffer.duration > 0 ? Math.round((position / buffer.duration) * 1000) : 0;
  timeText.textContent = `${formatTime(position)} / ${formatTime(buffer.duration)}`;
}

function startSeekTimer() {
  clearInterval(seekTimer);
  seekTimer = setInterval(updateTransport, 120);
}

function stopSeekTimer() {
  clearInterval(seekTimer);
  seekTimer = null;
}

function stopCurrentPlayback(keepOffset = true) {
  if (keepOffset) {
    playbackOffset = currentPosition();
  }
  if (currentSource) {
    currentSource.onended = null;
    currentSource.stop();
    currentSource.disconnect();
    currentSource = null;
  }
  isPlaying = false;
  playToggleButton.textContent = "Play";
  stopSeekTimer();
  updateTransport();
}

async function playFrom(offset = playbackOffset) {
  const buffer = getCurrentBuffer();
  if (!buffer) return;

  stopCurrentPlayback(false);
  const context = getAudioContext();
  await context.resume();
  playbackOffset = Math.min(Math.max(offset, 0), Math.max(buffer.duration - 0.05, 0));
  playbackStartedAt = context.currentTime;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0, playbackOffset);
  source.onended = () => {
    if (currentSource !== source) return;
    playbackOffset = 0;
    currentSource = null;
    isPlaying = false;
    playToggleButton.textContent = "Play";
    stopSeekTimer();
    updateTransport();
  };

  currentSource = source;
  isPlaying = true;
  playToggleButton.textContent = "Pause";
  startSeekTimer();
  updateTransport();
}

async function setMonitor(nextMonitor) {
  const wasPlaying = isPlaying;
  const position = currentPosition();
  activeMonitor = nextMonitor;
  monitorOriginal.classList.toggle("is-active", activeMonitor === "original");
  monitorMastered.classList.toggle("is-active", activeMonitor === "mastered");

  if (wasPlaying) {
    await playFrom(position);
  } else {
    playbackOffset = position;
    updateTransport();
  }
}

function setPreset(name) {
  const preset = presets[name];
  Object.entries(preset).forEach(([key, value]) => {
    sliders[key].value = value;
  });
  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === name);
  });
}

function drawWaveform(canvas, buffer, color, label) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#10120e";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(245, 241, 231, 0.15)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.fillStyle = "rgba(245, 241, 231, 0.72)";
  context.font = "16px system-ui";
  context.fillText(label, 16, 28);

  if (!buffer) return;

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * step;
    const end = Math.min(start + step, data.length);
    for (let i = start; i < end; i += 1) {
      const sample = data[i];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    context.moveTo(x, (1 + min) * height * 0.5);
    context.lineTo(x, (1 + max) * height * 0.5);
  }

  context.stroke();
}

function getPeak(buffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  return peak;
}

function getRms(buffer) {
  let total = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      total += data[i] * data[i];
      count += 1;
    }
  }
  return Math.sqrt(total / Math.max(count, 1));
}

function copyAudioBuffer(context, buffer) {
  const copy = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    copy.getChannelData(channel).set(buffer.getChannelData(channel));
  }

  return copy;
}

function deClickBuffer(buffer) {
  const threshold = 0.24;
  let repairs = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const source = new Float32Array(data);

    for (let i = 1; i < source.length - 1; i += 1) {
      const previous = source[i - 1];
      const current = source[i];
      const next = source[i + 1];
      const jumpIn = Math.abs(current - previous);
      const jumpOut = Math.abs(next - current);
      const isImpulse =
        jumpIn > threshold &&
        jumpOut > threshold &&
        Math.sign(current - previous) !== Math.sign(next - current);

      if (isImpulse) {
        data[i] = current * 0.15 + ((previous + next) / 2) * 0.85;
        repairs += 1;
      }
    }
  }

  return repairs;
}

function applyLimiter(buffer, ceilingDb) {
  const ceiling = dbToGain(ceilingDb);
  const preLimiterPeak = getPeak(buffer);
  const gain = preLimiterPeak > 0 ? Math.min(1, ceiling / preLimiterPeak) : 1;
  const reductionDb = gain < 1 ? Math.abs(gainToDb(gain)) : 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.max(-ceiling, Math.min(ceiling, data[i] * gain));
    }
  }

  return { preLimiterPeak, gain, reductionDb, ceilingDb };
}

function gentlySaturate(buffer, amount) {
  if (amount <= 0) return;
  const drive = 1 + amount * 0.018;
  const blend = Math.min(0.18, amount * 0.018);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const clean = data[i];
      const shaped = Math.tanh(clean * drive) / Math.tanh(drive);
      data[i] = clean * (1 - blend) + shaped * blend;
    }
  }
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  function writeString(value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

async function masterBuffer(buffer) {
  const brightness = Number(sliders.brightness.value);
  const warmth = Number(sliders.warmth.value);
  const glue = Number(sliders.glue.value);
  const ceiling = Number(sliders.ceiling.value);
  const context = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  const preparedBuffer = copyAudioBuffer(context, buffer);
  const deClickRepairs = deClickBuffer(preparedBuffer);

  const source = context.createBufferSource();
  source.buffer = preparedBuffer;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 26;
  highpass.Q.value = 0.62;

  const lowShelf = context.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 135;
  lowShelf.gain.value = warmth;

  const presenceDip = context.createBiquadFilter();
  presenceDip.type = "peaking";
  presenceDip.frequency.value = 3300;
  presenceDip.Q.value = 0.85;
  presenceDip.gain.value = brightness > 1 ? -0.6 : -0.25;

  const highShelf = context.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 7800;
  highShelf.gain.value = brightness * 0.65;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20 + glue * 0.65;
  compressor.knee.value = 24;
  compressor.ratio.value = 1.7 + glue * 0.18;
  compressor.attack.value = 0.028;
  compressor.release.value = 0.24;

  const makeup = context.createGain();
  makeup.gain.value = dbToGain(1.1 + glue * 0.23);

  source.connect(highpass);
  highpass.connect(lowShelf);
  lowShelf.connect(presenceDip);
  presenceDip.connect(highShelf);
  highShelf.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(context.destination);
  source.start();

  const rendered = await context.startRendering();
  gentlySaturate(rendered, Math.max(0, glue - 4));
  const limiter = applyLimiter(rendered, ceiling);
  const peak = getPeak(rendered);
  const rms = getRms(rendered);
  lastAnalysis = {
    peakDb: gainToDb(peak),
    rmsDb: gainToDb(rms),
    limiterReductionDb: limiter.reductionDb,
    preLimiterPeakDb: gainToDb(limiter.preLimiterPeak),
    ceilingDb: ceiling,
    deClickRepairs,
  };
  return rendered;
}

function resetMasterState() {
  stopCurrentPlayback();
  masteredBuffer = null;
  lastAnalysis = null;
  activeMonitor = "original";
  playbackOffset = 0;
  monitorOriginal.classList.add("is-active");
  monitorMastered.classList.remove("is-active");
  monitorMastered.disabled = true;
  downloadLink.setAttribute("aria-disabled", "true");
  downloadLink.removeAttribute("href");
  levelText.textContent = "-";
  reductionText.textContent = "-";
  reductionBar.style.width = "0%";
  drawWaveform(outputCanvas, null, "#7ec7a3", "Mastered");
  updateTransport();
}

function setLoadedBuffer(buffer, message) {
  sourceBuffer = buffer;
  resetMasterState();
  fileStatus.textContent = message;
  processButton.disabled = false;
  playToggleButton.disabled = false;
  monitorOriginal.disabled = false;
  seekBar.disabled = false;
  drawWaveform(inputCanvas, sourceBuffer, "#f0c05a", "Original");
  updateTransport();
}

async function loadFile(file) {
  const context = getAudioContext();
  const buffer = await file.arrayBuffer();
  const decoded = await context.decodeAudioData(buffer);
  setLoadedBuffer(decoded, `${file.name} を読み込みました。プリセットを選んでMaster WAVを押してください。`);
}

function loadDemoTone() {
  const context = getAudioContext();
  const sampleRate = context.sampleRate;
  const seconds = 8;
  const buffer = context.createBuffer(2, sampleRate * seconds, sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const time = i / sampleRate;
      const envelope = Math.min(1, time * 4, (seconds - time) * 3);
      const pulsePhase = (time * 2) % 1;
      const pulse = pulsePhase < 0.18 ? Math.sin((pulsePhase / 0.18) * Math.PI) * 0.055 : 0;
      const tone =
        Math.sin(time * Math.PI * 2 * 82.41) * 0.24 +
        Math.sin(time * Math.PI * 2 * 164.82) * 0.16 +
        Math.sin(time * Math.PI * 2 * 659.25) * 0.05 +
        pulse;
      data[i] = tone * envelope * (channel === 0 ? 1 : 0.96);
    }
  }

  setLoadedBuffer(buffer, "デモ音源を読み込みました。Master WAVで処理とA/B比較を試せます。");
}

async function processAudio() {
  if (!sourceBuffer) return;
  stopCurrentPlayback();
  processButton.disabled = true;
  processButton.textContent = "Processing...";
  try {
    masteredBuffer = await masterBuffer(sourceBuffer);
    levelText.textContent = `${lastAnalysis.peakDb.toFixed(1)} dB`;
    reductionText.textContent = `${lastAnalysis.limiterReductionDb.toFixed(1)} dB`;
    reductionBar.style.width = `${Math.min(100, lastAnalysis.limiterReductionDb * 18)}%`;
    drawWaveform(outputCanvas, masteredBuffer, "#7ec7a3", "Mastered");

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(encodeWav(masteredBuffer));
    downloadLink.href = currentObjectUrl;
    downloadLink.download = "mastered.wav";
    downloadLink.setAttribute("aria-disabled", "false");
    monitorMastered.disabled = false;
    await setMonitor("mastered");
    fileStatus.textContent = `マスタリング完了。Peak ${lastAnalysis.peakDb.toFixed(1)} dB / Limiter ${lastAnalysis.limiterReductionDb.toFixed(1)} dB。OriginalとMasteredを同じ位置で切り替えられます。`;
  } catch (error) {
    fileStatus.textContent = "処理中にエラーが出ました。別のWAVファイルでもう一度試してください。";
    console.error(error);
  } finally {
    processButton.disabled = false;
    processButton.textContent = "Master WAV";
  }
}

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-hover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-hover");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-hover");
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => setPreset(button.dataset.preset));
});

processButton.addEventListener("click", processAudio);
demoButton.addEventListener("click", loadDemoTone);
playToggleButton.addEventListener("click", async () => {
  if (isPlaying) {
    stopCurrentPlayback();
  } else {
    await playFrom(playbackOffset);
  }
});
monitorOriginal.addEventListener("click", () => setMonitor("original"));
monitorMastered.addEventListener("click", () => setMonitor("mastered"));
seekBar.addEventListener("input", () => {
  const buffer = getCurrentBuffer();
  if (!buffer) return;
  const position = (Number(seekBar.value) / 1000) * buffer.duration;
  playbackOffset = position;
  updateTransport();
});
seekBar.addEventListener("change", () => {
  const buffer = getCurrentBuffer();
  if (!buffer) return;
  const position = (Number(seekBar.value) / 1000) * buffer.duration;
  if (isPlaying) {
    playFrom(position);
  } else {
    playbackOffset = position;
    updateTransport();
  }
});

drawWaveform(inputCanvas, null, "#f0c05a", "Original");
drawWaveform(outputCanvas, null, "#7ec7a3", "Mastered");
updateTransport();
