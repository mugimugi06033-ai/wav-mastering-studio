const presets = {
  balanced: { brightness: 1.5, warmth: 1, glue: 4, ceiling: -1 },
  warm: { brightness: -0.5, warmth: 3.5, glue: 3, ceiling: -1.2 },
  punchy: { brightness: 2, warmth: 1.5, glue: 6, ceiling: -0.9 },
  loud: { brightness: 3, warmth: 1, glue: 8, ceiling: -0.7 },
};

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileStatus = document.querySelector("#fileStatus");
const processButton = document.querySelector("#processButton");
const demoButton = document.querySelector("#demoButton");
const playInputButton = document.querySelector("#playInputButton");
const playOutputButton = document.querySelector("#playOutputButton");
const downloadLink = document.querySelector("#downloadLink");
const levelText = document.querySelector("#levelText");
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

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
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

function stopCurrentPlayback() {
  if (currentSource) {
    currentSource.stop();
    currentSource.disconnect();
    currentSource = null;
  }
}

function playBuffer(buffer) {
  stopCurrentPlayback();
  const context = getAudioContext();
  context.resume();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  source.onended = () => {
    if (currentSource === source) currentSource = null;
  };
  currentSource = source;
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

function dbToGain(db) {
  return 10 ** (db / 20);
}

function softClip(sample, drive) {
  return Math.tanh(sample * drive) / Math.tanh(drive);
}

function applyLimiter(buffer, ceilingDb) {
  const ceiling = dbToGain(ceilingDb);
  const peak = getPeak(buffer);
  const gain = peak > 0 ? Math.min(1, ceiling / peak) : 1;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.max(-ceiling, Math.min(ceiling, data[i] * gain));
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

  const source = context.createBufferSource();
  source.buffer = buffer;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 28;
  highpass.Q.value = 0.7;

  const lowShelf = context.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 150;
  lowShelf.gain.value = warmth;

  const highShelf = context.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 5600;
  highShelf.gain.value = brightness;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -24 + glue * 0.9;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.2 + glue * 0.28;
  compressor.attack.value = 0.018;
  compressor.release.value = 0.18;

  const makeup = context.createGain();
  makeup.gain.value = dbToGain(2 + glue * 0.35);

  source.connect(highpass);
  highpass.connect(lowShelf);
  lowShelf.connect(highShelf);
  highShelf.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(context.destination);
  source.start();

  const rendered = await context.startRendering();
  const drive = 1 + glue * 0.03;

  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = softClip(data[i], drive);
    }
  }

  applyLimiter(rendered, ceiling);
  return rendered;
}

async function loadFile(file) {
  const context = getAudioContext();
  const buffer = await file.arrayBuffer();
  sourceBuffer = await context.decodeAudioData(buffer);
  masteredBuffer = null;
  fileStatus.textContent = `${file.name} を読み込みました。プリセットを選んでMaster WAVを押してください。`;
  processButton.disabled = false;
  playInputButton.disabled = false;
  playOutputButton.disabled = true;
  downloadLink.setAttribute("aria-disabled", "true");
  downloadLink.removeAttribute("href");
  levelText.textContent = "-";
  drawWaveform(inputCanvas, sourceBuffer, "#f0c05a", "Original");
  drawWaveform(outputCanvas, null, "#7ec7a3", "Mastered");
}

function loadDemoTone() {
  const context = getAudioContext();
  const sampleRate = context.sampleRate;
  const seconds = 4;
  const buffer = context.createBuffer(2, sampleRate * seconds, sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const time = i / sampleRate;
      const envelope = Math.min(1, time * 5, (seconds - time) * 4);
      const tone =
        Math.sin(time * Math.PI * 2 * 110) * 0.28 +
        Math.sin(time * Math.PI * 2 * 220) * 0.18 +
        Math.sin(time * Math.PI * 2 * 880) * 0.05;
      data[i] = tone * envelope * (channel === 0 ? 1 : 0.95);
    }
  }

  sourceBuffer = buffer;
  masteredBuffer = null;
  fileStatus.textContent = "デモ音源を読み込みました。Master WAVで処理を試せます。";
  processButton.disabled = false;
  playInputButton.disabled = false;
  playOutputButton.disabled = true;
  downloadLink.setAttribute("aria-disabled", "true");
  downloadLink.removeAttribute("href");
  levelText.textContent = "-";
  drawWaveform(inputCanvas, sourceBuffer, "#f0c05a", "Original");
  drawWaveform(outputCanvas, null, "#7ec7a3", "Mastered");
}

async function processAudio() {
  if (!sourceBuffer) return;
  processButton.disabled = true;
  processButton.textContent = "Processing...";
  try {
    masteredBuffer = await masterBuffer(sourceBuffer);
    const peakDb = 20 * Math.log10(Math.max(getPeak(masteredBuffer), 0.000001));
    levelText.textContent = `${peakDb.toFixed(1)} dB`;
    drawWaveform(outputCanvas, masteredBuffer, "#7ec7a3", "Mastered");

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(encodeWav(masteredBuffer));
    downloadLink.href = currentObjectUrl;
    downloadLink.download = "mastered.wav";
    downloadLink.setAttribute("aria-disabled", "false");
    playOutputButton.disabled = false;
    fileStatus.textContent = "マスタリングが完了しました。再生して確認し、WAVを書き出せます。";
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
playInputButton.addEventListener("click", () => playBuffer(sourceBuffer));
playOutputButton.addEventListener("click", () => playBuffer(masteredBuffer));

drawWaveform(inputCanvas, null, "#f0c05a", "Original");
drawWaveform(outputCanvas, null, "#7ec7a3", "Mastered");
