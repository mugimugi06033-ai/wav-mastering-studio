# Wav Mastering Studio Handoff

Last updated: 2026-07-05

This file is the single handoff document for the WAV mastering tool. It is written so another coding agent or developer can understand the product intent, current implementation, audio design, deployment state, and next improvement points without reading the full conversation history.

## 1. Project Summary

Wav Mastering Studio is a browser-only WAV mastering web app.

The user goal is:

- Upload or drag in a WAV file.
- Make it sound "better" and louder without requiring deep mastering knowledge.
- Compare Original and Mastered at the same playback position.
- Export the mastered audio as a WAV file.
- Keep the audio private: processing happens in the browser, not on a server.

Current public page:

```text
https://mugimugi06033-ai.github.io/wav-mastering-studio/
```

GitHub repository:

```text
https://github.com/mugimugi06033-ai/wav-mastering-studio
```

Repository visibility is public because GitHub Pages is used.

## 2. Current File Structure

```text
wav-mastering-studio/
  .gitignore
  README.md
  PROJECT_HANDOFF.md
  index.html
  styles.css
  app.js
```

There are no package dependencies. The app is plain HTML, CSS, and JavaScript.

## 3. How To Run Locally

From the project folder:

```bash
python3 -m http.server 4173
```

Open:

```text
http://localhost:4173
```

Why a local server is used:

- It makes the browser load `index.html`, `styles.css`, and `app.js` in the same way as GitHub Pages.
- There is no build step.

## 4. Product Direction

The app should feel like:

- Simple enough that a non-engineer or non-mastering expert can use it.
- Focused on quick improvement, not surgical mastering.
- Useful for demo tracks, social posts, and rough release checks.
- Safer than the first version: less harsh high end, less clipping impression, more headroom.

The user liked:

- It can make a file feel better and louder without much thinking.

The user found issues:

- Original and Mastered could not be switched at the same playback position.
- Limiter behavior was hard to understand.
- The previous processing felt like it was pushing all frequencies too evenly.
- Clipping or harshness was noticeable.
- The default high end felt slightly sharp.
- The settings sounded too tight for streaming platforms.

The current version addresses these by:

- Adding A/B comparison at the same playback position.
- Adding Peak and Limiter GR displays.
- Adding a Limiter GR visual bar.
- Adding a light De-click step before mastering to reduce small impulse clicks.
- Making the default preset more conservative.
- Adding a Streaming preset with more ceiling headroom.
- Reducing high shelf intensity and adding a small presence dip around 3.3 kHz.
- Making saturation much more subtle.
- Smoothing the Demo tone pulse so it is less likely to create unintended click noise.

## 5. Current UI

Main sections in `index.html`:

- Header:
  - App title.
  - Peak meter.
  - Limiter GR meter and reduction bar.

- File input:
  - WAV file picker and drag/drop zone.
  - User-facing status text.

- Waveform previews:
  - Original canvas.
  - Mastered canvas.

- Mastering controls:
  - Preset buttons.
  - Sliders for Brightness, Warmth, Glue, and Output Ceiling.

- A/B comparison:
  - Original button.
  - Mastered button.
  - Play/Pause button.
  - Seek bar.
  - Time display.

- Actions:
  - Master WAV.
  - Load Demo.
  - Download WAV.

## 6. Presets

Defined in `app.js`:

```js
const presets = {
  balanced: { brightness: 0.5, warmth: 0.8, glue: 3, ceiling: -1.4 },
  warm: { brightness: -0.8, warmth: 2.8, glue: 3, ceiling: -1.5 },
  punchy: { brightness: 0.8, warmth: 1.2, glue: 5, ceiling: -1.2 },
  loud: { brightness: 1.0, warmth: 0.6, glue: 6, ceiling: -1.1 },
  streaming: { brightness: 0, warmth: 0.7, glue: 2, ceiling: -1.8 },
};
```

Preset intent:

- `Balanced`: default. Natural improvement with headroom.
- `Warm`: more low-mid/body, less bright.
- `Punchy`: more forward and compressed.
- `Loud`: louder, but less extreme than the first version.
- `Streaming`: safer headroom and less tonal hype for streaming platforms.

## 7. Audio Processing Pipeline

All audio processing is client-side in `app.js`.

Main entry point:

```js
async function masterBuffer(buffer)
```

Current signal chain:

```text
Input WAV buffer
  -> Light De-click preparation
  -> AudioBufferSource
  -> High-pass filter
  -> Low shelf EQ
  -> Presence dip EQ
  -> High shelf EQ
  -> Dynamics compressor
  -> Makeup gain
  -> Offline rendering
  -> Gentle saturation
  -> Peak limiter
  -> WAV export
```

Detailed processing:

- De-click:
  - Function: `deClickBuffer(buffer)`
  - Runs on a copied buffer before the EQ/compressor chain.
  - Detects obvious one-sample impulse spikes by looking for a large jump into and out of a sample.
  - Repairs only the detected sample by blending it toward the average of its neighbors.
  - Purpose: reduce small accidental `click` or `pop` noise without softening the whole track.
  - Important: this is intentionally light. It is not a full spectral repair or restoration tool.

- High-pass:
  - Type: `highpass`
  - Frequency: `26 Hz`
  - Q: `0.62`
  - Purpose: remove very low rumble without thinning the track too much.

- Low shelf:
  - Type: `lowshelf`
  - Frequency: `135 Hz`
  - Gain: `warmth`
  - Purpose: add or reduce body.

- Presence dip:
  - Type: `peaking`
  - Frequency: `3300 Hz`
  - Q: `0.85`
  - Gain:
    - `-0.6 dB` if brightness is above `1`
    - otherwise `-0.25 dB`
  - Purpose: reduce harsh or刺さる feeling.

- High shelf:
  - Type: `highshelf`
  - Frequency: `7800 Hz`
  - Gain: `brightness * 0.65`
  - Purpose: add air, but less aggressively than the first version.

- Compressor:
  - Threshold: `-20 + glue * 0.65`
  - Knee: `24`
  - Ratio: `1.7 + glue * 0.18`
  - Attack: `0.028`
  - Release: `0.24`
  - Purpose: gentle glue, not heavy crushing.

- Makeup gain:
  - Gain: `1.1 + glue * 0.23` dB converted to linear gain.
  - Purpose: moderate loudness lift.

- Gentle saturation:
  - Function: `gentlySaturate(buffer, Math.max(0, glue - 4))`
  - Very subtle blend.
  - Only meaningfully applies when Glue is above `4`.
  - Purpose: slight density without obvious clipping.

- Limiter:
  - Function: `applyLimiter(buffer, ceiling)`
  - Current limiter is a peak-based gain reduction over the whole rendered buffer.
  - It measures pre-limiter peak and scales the whole file down only if needed.
  - It then clamps samples to the ceiling as a safety measure.
  - It reports `limiterReductionDb`.

Important limitation:

- This is not a true lookahead limiter or true-peak limiter.
- It is closer to a simple peak safety limiter.
- Future improvement should replace or enhance this with a more mastering-like limiter.

## 8. A/B Playback Design

The current A/B system keeps one shared playback position.

Important state variables:

```js
let currentSource;
let isPlaying = false;
let activeMonitor = "original";
let playbackOffset = 0;
let playbackStartedAt = 0;
let seekTimer;
```

Key functions:

- `getCurrentBuffer()`
  - Returns `masteredBuffer` when monitor is Mastered and mastered audio exists.
  - Otherwise returns `sourceBuffer`.

- `currentPosition()`
  - Calculates the current playback time using `playbackOffset`, `audioContext.currentTime`, and `playbackStartedAt`.

- `playFrom(offset)`
  - Starts current buffer from the given offset.
  - Updates Play/Pause UI.

- `setMonitor(nextMonitor)`
  - Captures the current position.
  - Switches Original/Mastered state.
  - If audio was playing, restarts playback from the same position in the other buffer.

This was added because real mastering comparison requires repeatedly switching Original and Mastered while listening to the same moment.

## 9. Meters And Analysis

Displayed meters:

- Peak:
  - DOM id: `levelText`
  - Shows final peak in dB.

- Limiter GR:
  - DOM id: `reductionText`
  - Shows gain reduction in dB.

- Limiter bar:
  - DOM id: `reductionBar`
  - Width is set by:

```js
reductionBar.style.width = `${Math.min(100, lastAnalysis.limiterReductionDb * 18)}%`;
```

Analysis object:

```js
lastAnalysis = {
  peakDb,
  rmsDb,
  limiterReductionDb,
  preLimiterPeakDb,
  ceilingDb,
  deClickRepairs,
};
```

Current UI only shows `peakDb` and `limiterReductionDb`.
`deClickRepairs` is kept in the analysis object for debugging and future UI work, but is not shown to the user yet.

Potential future UI:

- Show RMS or approximate loudness.
- Show ceiling value beside Peak.
- Add warning when Limiter GR is high.
- Add "Streaming safe" note when ceiling is `-1.8 dB` or below.

## 10. WAV Input And Output

Input:

- Accepts WAV through `<input type="file" accept="audio/wav,audio/x-wav">`.
- Also supports drag/drop.
- Uses `AudioContext.decodeAudioData()`.

Output:

- Function: `encodeWav(buffer)`
- Exports 16-bit PCM WAV.
- Download filename: `mastered.wav`.

Privacy:

- WAV is not uploaded anywhere.
- The file stays in the browser memory.
- GitHub Pages only serves app files.

## 11. Demo Tone

The `Load Demo` button creates an 8-second stereo demo buffer in the browser.

Purpose:

- Allows testing without a user-provided WAV.
- Helps verify mastering, waveform, A/B, and download flow.

The demo tone originally used a sharper pulse that could sound like unintended noise. It now uses a smoother pulse shape. Current demo tone is still synthetic and not a real music master. Do not use it as proof of mastering quality.

## 12. Styling And Layout

CSS file:

```text
styles.css
```

Design characteristics:

- Dark utility-style interface.
- Accent colors:
  - Yellow: primary action and original waveform.
  - Green: mastered waveform and active A/B monitor.
  - Red: limiter reduction bar.
- No heavy framework.
- Responsive breakpoint at `780px`.
- On mobile:
  - Header stacks vertically.
  - Waveforms stack.
  - Controls stack.
  - Presets become one column.
  - Compare/transport becomes one column.

Known visual constraints:

- Avoid making it feel like a marketing landing page.
- Keep it a usable tool first.
- Avoid overly decorative cards or big hero sections.

## 13. Deployment

Deployment target:

```text
GitHub Pages
```

Source:

```text
branch: main
path: /
```

Public URL:

```text
https://mugimugi06033-ai.github.io/wav-mastering-studio/
```

After pushing to `main`, GitHub Pages rebuilds automatically.

Useful status command:

```bash
gh api repos/mugimugi06033-ai/wav-mastering-studio/pages --jq '{status: .status, html_url: .html_url}'
```

Expected status after deploy:

```text
built
```

## 14. Validation Already Performed

Checks previously performed:

- `node --check app.js`
- Local browser test with demo audio.
- Confirmed:
  - Demo audio loads.
  - Mastering completes.
  - Download link becomes enabled.
  - Peak and Limiter GR show.
  - Original/Mastered A/B controls exist.
  - Streaming preset appears.
  - Mobile width does not horizontally overflow.
  - Public GitHub Pages URL loads updated UI.

Latest known commit at time of this handoff:

```text
c8edce3 Improve mastering comparison
```

Initial commit:

```text
274217a Create WAV mastering app
```

## 15. Known Limitations

Audio limitations:

- Limiter is not a professional lookahead or true-peak limiter.
- De-click is light impulse smoothing only, not full audio restoration.
- Loudness is not measured in LUFS.
- Export is 16-bit PCM WAV with no dithering.
- No oversampling.
- No inter-sample peak detection.
- No frequency analyzer.
- No per-band compression.
- No undo/history.
- No saved presets.

UX limitations:

- A/B switching restarts the selected buffer at the same calculated time; it is good for comparison, but not sample-perfect.
- The app does not remember user settings after refresh.
- The limiter may show `0.0 dB` if the processed audio does not exceed the ceiling.
- The app has no explicit bypass label; it uses `Original` and `Mastered`.

Browser limitations:

- Very large WAV files may use a lot of memory.
- Mobile browsers may be less reliable with large audio buffers.

## 16. Recommended Next Improvements

High priority:

1. Replace the simple peak limiter with a real lookahead limiter.
2. Improve De-click into a safer multi-sample click repair and add a clear on/off control if needed.
3. Add approximate LUFS or at least integrated RMS/loudness display.
4. Add a clear warning when Limiter GR is too high, such as over `3 dB`.
5. Add a `Bypass` label or keyboard shortcut for A/B.
6. Add a visual marker showing current playback position on both waveforms.

Medium priority:

1. Add a frequency analyzer before/after mastering.
2. Add true-peak style oversampling check.
3. Add export options such as 24-bit WAV.
4. Add a "Reset sliders" button.
5. Add user preset saving in localStorage.

Lower priority:

1. Add keyboard shortcuts:
   - Space: Play/Pause.
   - B: Original/Mastered toggle.
   - M: Master WAV.
2. Add drag handle on waveform to seek.
3. Add peak clipping warning if exported samples approach 0 dBFS.

## 17. Suggested Coding Principles For Future Work

Keep these rules:

- Do not send audio to a server unless the user explicitly asks.
- Keep the default sound conservative enough for streaming.
- Preserve the "Louder quickly" appeal through the Loud preset.
- Keep A/B comparison central to the workflow.
- When adding audio features, expose enough meter feedback that users know what is happening.
- Keep the app dependency-free unless a real audio-quality reason appears.

Before changing audio behavior:

- Test with at least:
  - A quiet file.
  - A loud file.
  - A bright vocal-heavy file.
  - A bass-heavy file.
  - A file with obvious small clicks or pops.
- Compare Original and Mastered at the same playback position.
- Check that default Balanced does not feel harsh.
- Check that Streaming leaves enough headroom.
- Check that De-click reduces accidental clicks without dulling drum attacks.

## 18. Important User Context

The user is non-engineer and prefers gentle explanations.

When reporting changes:

- Avoid unexplained jargon.
- If using terms like limiter, compression, LUFS, or clipping, explain briefly.
- Keep status updates short.
- Mention what changed, why it matters, and how to try it.

The user cares about practical listening results more than technical purity, but feedback shows they have good musical judgment about mastering comparison, harshness, limiter behavior, and streaming translation.
