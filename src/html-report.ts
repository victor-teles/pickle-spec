import { join } from 'path'
import { mkdir } from 'node:fs/promises'
import type { RunResult, FeatureResult, ScenarioResult, StepResult } from './types'

const ARTIFACTS_DIR = './.pickle/artifacts'

async function embedImage(imagePath: string): Promise<string> {
  try {
    const file = Bun.file(imagePath)
    if (!(await file.exists())) return ''
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const ext = imagePath.endsWith('.jpeg') || imagePath.endsWith('.jpg') ? 'jpeg' : 'png'
    return `data:image/${ext};base64,${base64}`
  } catch {
    return ''
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'passed': return '<span class="icon passed">&#x2714;</span>'
    case 'failed': return '<span class="icon failed">&#x2716;</span>'
    case 'skipped': return '<span class="icon skipped">&#x2298;</span>'
    default: return ''
  }
}

function scenarioStatus(scenario: ScenarioResult): string {
  if (scenario.steps.some(s => s.status === 'failed')) return 'failed'
  if (scenario.steps.every(s => s.status === 'skipped')) return 'skipped'
  return scenario.status
}

// Collect all trace frame + screenshot paths that need embedding
function collectImagePaths(result: RunResult): Set<string> {
  const paths = new Set<string>()
  for (const feature of result.features) {
    for (const scenario of feature.scenarios) {
      for (const step of scenario.steps) {
        if (step.screenshotPath) paths.add(step.screenshotPath)
        if (step.traceFramePaths) {
          for (const p of step.traceFramePaths) paths.add(p)
        }
      }
    }
  }
  return paths
}

function buildStepsHtml(steps: StepResult[]): string {
  let html = '<table class="steps">'
  for (const step of steps) {
    html += `<tr class="step ${step.status}">`
    html += `<td class="step-status">${statusIcon(step.status)}</td>`
    html += `<td class="step-text">${escapeHtml(step.step.text)}</td>`
    html += `<td class="step-duration">${formatDuration(step.durationMs)}</td>`
    html += '</tr>'
    if (step.status === 'failed' && step.error) {
      html += `<tr class="step-error"><td colspan="3">${escapeHtml(step.error)}</td></tr>`
    }
  }
  html += '</table>'
  return html
}

function buildTracePlayerHtml(
  scenarioId: string,
  steps: StepResult[],
  imageCache: Map<string, string>,
): string {
  // Build frames from trace data, with step boundary markers
  interface Frame { dataUri: string; stepIndex: number; stepLabel: string; stepStatus: string }
  const frames: Frame[] = []
  const stepBoundaries: number[] = [] // frame index where each step starts

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si]!
    if (step.traceFramePaths && step.traceFramePaths.length > 0) {
      stepBoundaries.push(frames.length)
      for (const p of step.traceFramePaths) {
        const dataUri = imageCache.get(p)
        if (dataUri) {
          frames.push({ dataUri, stepIndex: si, stepLabel: step.step.text, stepStatus: step.status })
        }
      }
    }
  }

  // Fallback: if no trace frames, try screenshots
  if (frames.length === 0) {
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si]!
      if (step.screenshotPath) {
        const dataUri = imageCache.get(step.screenshotPath)
        if (dataUri) {
          stepBoundaries.push(frames.length)
          frames.push({ dataUri, stepIndex: si, stepLabel: step.step.text, stepStatus: step.status })
        }
      }
    }
  }

  if (frames.length === 0) return ''

  const isDuplicate: boolean[] = frames.map((f, i) => i === 0 ? false : f.dataUri === frames[i - 1]!.dataUri)
  const duplicatesJson = JSON.stringify(isDuplicate)

  const boundariesJson = JSON.stringify(stepBoundaries)

  let html = `<div class="trace-player" data-scenario-id="${escapeHtml(scenarioId)}" data-step-boundaries="${escapeHtml(boundariesJson)}" data-duplicates="${escapeHtml(duplicatesJson)}">`

  // Main viewport
  html += '<div class="trace-viewport">'
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    html += `<img src="${frame.dataUri}" alt="Frame ${i}" style="display:${i === 0 ? 'block' : 'none'}" />`
  }
  html += '</div>'

  // Timeline scrubber
  html += '<div class="trace-timeline">'
  html += `<input type="range" class="scrubber" min="0" max="${frames.length - 1}" value="0" />`
  // Step markers on timeline
  html += '<div class="step-markers">'
  for (const boundary of stepBoundaries) {
    const pct = frames.length > 1 ? (boundary / (frames.length - 1) * 100) : 0
    const frame = frames[boundary]!
    html += `<div class="step-marker ${frame.stepStatus}" style="left:${pct}%" title="${escapeHtml(frame.stepLabel)}"></div>`
  }
  html += '</div>'
  html += '</div>'

  // Controls
  html += '<div class="trace-controls">'
  html += '<button class="trace-btn prev-step" title="Previous step">&#x23EE;</button>'
  html += '<button class="trace-btn prev" title="Previous frame">&larr;</button>'
  html += '<button class="trace-btn play-pause" title="Play">&#9654;</button>'
  html += '<button class="trace-btn next" title="Next frame">&rarr;</button>'
  html += '<button class="trace-btn next-step" title="Next step">&#x23ED;</button>'
  html += '<div class="speed-controls">'
  html += '<button class="trace-btn speed active" data-speed="100">1x</button>'
  html += '<button class="trace-btn speed" data-speed="50">2x</button>'
  html += '<button class="trace-btn speed" data-speed="25">4x</button>'
  html += '</div>'
  html += '<button class="trace-btn skip-idle" title="Auto-skip idle frames">Skip Idle</button>'
  html += `<span class="frame-counter">1 / ${frames.length}</span>`
  html += '</div>'

  // Step info bar
  html += '<div class="step-info">'
  html += `<span class="current-step-label">${escapeHtml(frames[0]!.stepLabel)}</span>`
  html += '</div>'

  html += '</div>'
  return html
}

function buildScenarioHtml(
  scenario: ScenarioResult,
  featureIndex: number,
  scenarioIndex: number,
  imageCache: Map<string, string>,
): string {
  const status = scenarioStatus(scenario)
  const isOpen = status === 'failed' ? ' open' : ''
  const scenarioId = `f${featureIndex}-s${scenarioIndex}`

  let html = `<details class="scenario ${status}"${isOpen}>`
  html += `<summary>${statusIcon(status)} <span class="scenario-name">${escapeHtml(scenario.pickle.name)}</span> <span class="duration">${formatDuration(scenario.durationMs)}</span></summary>`
  html += '<div class="scenario-body">'
  html += buildStepsHtml(scenario.steps)
  html += buildTracePlayerHtml(scenarioId, scenario.steps, imageCache)
  html += '</div>'
  html += '</details>'
  return html
}

function buildFeatureHtml(
  feature: FeatureResult,
  featureIndex: number,
  imageCache: Map<string, string>,
): string {
  const hasFailed = feature.scenarios.some(s => scenarioStatus(s) === 'failed')
  const status = hasFailed ? 'failed' : 'passed'

  let html = `<section class="feature ${status}">`
  html += '<div class="feature-header">'
  html += `<h2>${statusIcon(status)} Feature: ${escapeHtml(feature.featureName)} <span class="duration">${formatDuration(feature.durationMs)}</span></h2>`
  html += `<p class="feature-file">${escapeHtml(feature.featureFile)}</p>`
  html += '</div>'

  for (let i = 0; i < feature.scenarios.length; i++) {
    html += buildScenarioHtml(feature.scenarios[i]!, featureIndex, i, imageCache)
  }

  html += '</section>'
  return html
}

function buildHtml(result: RunResult, imageCache: Map<string, string>): string {
  const total = result.passed + result.failed + result.skipped
  const passPercent = total ? (result.passed / total * 100).toFixed(1) : '0'
  const failPercent = total ? (result.failed / total * 100).toFixed(1) : '0'
  const skipPercent = total ? (result.skipped / total * 100).toFixed(1) : '0'
  const timestamp = new Date().toLocaleString()

  let featuresHtml = ''
  for (let i = 0; i < result.features.length; i++) {
    featuresHtml += buildFeatureHtml(result.features[i]!, i, imageCache)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pickle-spec Report</title>
<style>
:root {
  --green: #16a34a;
  --green-bg: #dcfce7;
  --red: #dc2626;
  --red-bg: #fee2e2;
  --amber: #d97706;
  --amber-bg: #fef3c7;
  --blue: #2563eb;
  --blue-bg: #dbeafe;
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-500: #6b7280;
  --gray-700: #374151;
  --gray-900: #111827;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--gray-50);
  color: var(--gray-900);
  line-height: 1.6;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
header { margin-bottom: 32px; }
header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
.timestamp { color: var(--gray-500); font-size: 0.85rem; margin-bottom: 16px; }
.summary-cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.card {
  padding: 16px 24px;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 1.1rem;
  box-shadow: var(--shadow);
  min-width: 120px;
}
.card .label { font-size: 0.75rem; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 2px; }
.card.passed { background: var(--green-bg); color: var(--green); }
.card.failed { background: var(--red-bg); color: var(--red); }
.card.skipped { background: var(--amber-bg); color: var(--amber); }
.card.duration { background: var(--blue-bg); color: var(--blue); }
.progress-bar { height: 8px; border-radius: 4px; overflow: hidden; display: flex; background: var(--gray-200); }
.progress-bar .seg { height: 100%; }
.progress-bar .seg.passed { background: var(--green); }
.progress-bar .seg.failed { background: var(--red); }
.progress-bar .seg.skipped { background: var(--amber); }
.cancelled-banner {
  background: var(--amber-bg); color: var(--amber);
  padding: 12px 16px; border-radius: var(--radius); font-weight: 600; margin-bottom: 16px;
}

/* Features */
.feature { background: white; border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 16px; overflow: hidden; }
.feature-header { padding: 16px 20px 12px; border-bottom: 1px solid var(--gray-100); }
.feature-header h2 { font-size: 1.1rem; font-weight: 600; }
.feature-file { color: var(--gray-500); font-size: 0.8rem; font-family: ui-monospace, monospace; margin-top: 2px; }

/* Scenarios */
.scenario { border-top: 1px solid var(--gray-100); }
.scenario summary { padding: 12px 20px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 8px; user-select: none; }
.scenario summary:hover { background: var(--gray-50); }
.scenario-name { flex: 1; }
.scenario-body { padding: 0 20px 16px; }

/* Steps */
.steps { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.steps .step td { padding: 6px 8px; border-bottom: 1px solid var(--gray-100); }
.step-status { width: 28px; text-align: center; }
.step-duration { width: 80px; text-align: right; color: var(--gray-500); font-size: 0.8rem; font-family: ui-monospace, monospace; }
.step-error td {
  padding: 8px 8px 8px 36px; color: var(--red); font-size: 0.85rem;
  font-family: ui-monospace, monospace; background: var(--red-bg);
  white-space: pre-wrap; word-break: break-word;
}

/* Icons */
.icon { font-weight: bold; }
.icon.passed { color: var(--green); }
.icon.failed { color: var(--red); }
.icon.skipped { color: var(--amber); }
.duration { color: var(--gray-500); font-size: 0.8rem; font-weight: 400; font-family: ui-monospace, monospace; }

/* Trace Player */
.trace-player { margin-top: 16px; border: 1px solid var(--gray-200); border-radius: var(--radius); overflow: hidden; background: var(--gray-900); }
.trace-viewport { position: relative; width: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #000; }
.trace-viewport img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* Timeline */
.trace-timeline { position: relative; padding: 12px 12px 20px; background: var(--gray-900); }
.scrubber {
  width: 100%; height: 6px; -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.15); border-radius: 3px; outline: none; cursor: pointer;
}
.scrubber::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: var(--blue); cursor: pointer; border: 2px solid white;
}
.step-markers { position: absolute; left: 12px; right: 12px; bottom: 8px; height: 6px; pointer-events: none; }
.step-marker {
  position: absolute; width: 3px; height: 12px; top: -3px; border-radius: 1px;
  transform: translateX(-1px);
}
.step-marker.passed { background: var(--green); }
.step-marker.failed { background: var(--red); }
.step-marker.skipped { background: var(--amber); }

/* Controls */
.trace-controls {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: var(--gray-900); border-top: 1px solid rgba(255,255,255,0.1);
}
.trace-btn {
  background: rgba(255,255,255,0.1); border: none; color: white;
  padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;
}
.trace-btn:hover { background: rgba(255,255,255,0.2); }
.speed-controls { display: flex; gap: 2px; margin-left: 8px; }
.speed-controls .trace-btn { padding: 3px 8px; font-size: 0.75rem; }
.speed-controls .trace-btn.active { background: var(--blue); }
.skip-idle.active { background: var(--blue); }
.frame-counter { color: rgba(255,255,255,0.7); font-size: 0.8rem; font-family: ui-monospace, monospace; margin-left: auto; }

/* Step info */
.step-info {
  padding: 6px 12px; background: rgba(255,255,255,0.05);
  border-top: 1px solid rgba(255,255,255,0.1);
}
.current-step-label { color: rgba(255,255,255,0.8); font-size: 0.8rem; }
</style>
</head>
<body>
<header>
  <h1>pickle-spec Report</h1>
  <p class="timestamp">${escapeHtml(timestamp)}</p>
  ${result.cancelled ? '<div class="cancelled-banner">Run was cancelled by user</div>' : ''}
  <div class="summary-cards">
    <div class="card passed"><span class="label">Passed</span>${result.passed}</div>
    <div class="card failed"><span class="label">Failed</span>${result.failed}</div>
    <div class="card skipped"><span class="label">Skipped</span>${result.skipped}</div>
    <div class="card duration"><span class="label">Duration</span>${formatDuration(result.totalDurationMs)}</div>
  </div>
  <div class="progress-bar">
    <div class="seg passed" style="width:${passPercent}%"></div>
    <div class="seg failed" style="width:${failPercent}%"></div>
    <div class="seg skipped" style="width:${skipPercent}%"></div>
  </div>
</header>
<main>
${featuresHtml}
</main>
<script>
document.querySelectorAll('.trace-player').forEach(function(player) {
  var images = player.querySelectorAll('.trace-viewport img');
  var scrubber = player.querySelector('.scrubber');
  var counter = player.querySelector('.frame-counter');
  var stepLabel = player.querySelector('.current-step-label');
  var boundaries = JSON.parse(player.dataset.stepBoundaries || '[]');
  var current = 0;
  var interval = null;
  var total = images.length;
  var speed = 100; // ms per frame
  var duplicates = JSON.parse(player.dataset.duplicates || '[]');
  var skipIdle = false;

  // Build step label map from image alt + data
  var stepLabels = [];
  images.forEach(function(img) { stepLabels.push(img.alt); });

  function show(index) {
    if (index < 0) index = 0;
    if (index >= total) index = total - 1;
    images.forEach(function(img, i) { img.style.display = i === index ? 'block' : 'none'; });
    scrubber.value = index;
    counter.textContent = (index + 1) + ' / ' + total;
    current = index;
    // Find which step this frame belongs to
    var stepIdx = 0;
    for (var b = boundaries.length - 1; b >= 0; b--) {
      if (index >= boundaries[b]) { stepIdx = b; break; }
    }
    // Update step label from the first frame of that step's boundary
    if (boundaries.length > 0 && boundaries[stepIdx] < images.length) {
      var firstFrameOfStep = images[boundaries[stepIdx]];
      if (firstFrameOfStep) stepLabel.textContent = firstFrameOfStep.alt || '';
    }
  }

  function stop() {
    if (interval) { clearInterval(interval); interval = null; }
    player.querySelector('.play-pause').innerHTML = '&#9654;';
  }

  function play() {
    interval = setInterval(function() {
      if (current >= total - 1) { stop(); return; }
      var next = current + 1;
      if (skipIdle) {
        while (next < total - 1 && duplicates[next]) { next++; }
      }
      show(next);
    }, speed);
    player.querySelector('.play-pause').innerHTML = '&#9646;&#9646;';
  }

  // Frame navigation
  player.querySelector('.prev').onclick = function() { stop(); show(current - 1); };
  player.querySelector('.next').onclick = function() { stop(); show(current + 1); };
  player.querySelector('.play-pause').onclick = function() {
    if (interval) { stop(); }
    else { if (current >= total - 1) { show(0); } play(); }
  };

  // Step navigation
  player.querySelector('.prev-step').onclick = function() {
    stop();
    for (var b = boundaries.length - 1; b >= 0; b--) {
      if (boundaries[b] < current) { show(boundaries[b]); return; }
    }
    show(0);
  };
  player.querySelector('.next-step').onclick = function() {
    stop();
    for (var b = 0; b < boundaries.length; b++) {
      if (boundaries[b] > current) { show(boundaries[b]); return; }
    }
    show(total - 1);
  };

  // Scrubber
  scrubber.oninput = function() { stop(); show(parseInt(scrubber.value)); };

  // Speed controls
  player.querySelectorAll('.speed').forEach(function(btn) {
    btn.onclick = function() {
      player.querySelectorAll('.speed').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      speed = parseInt(btn.dataset.speed);
      if (interval) { stop(); play(); }
    };
  });

  // Skip idle toggle
  var skipBtn = player.querySelector('.skip-idle');
  skipBtn.onclick = function() {
    skipIdle = !skipIdle;
    skipBtn.classList.toggle('active', skipIdle);
  };

  // Keyboard: arrow keys when player is focused
  player.tabIndex = 0;
  player.onkeydown = function(e) {
    if (e.key === 'ArrowLeft') { stop(); show(current - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { stop(); show(current + 1); e.preventDefault(); }
    if (e.key === ' ') { if (interval) { stop(); } else { if (current >= total - 1) { show(0); } play(); } e.preventDefault(); }
  };
});
</script>
</body>
</html>`
}

export async function generateHtmlReport(result: RunResult): Promise<string> {
  const outputDir = result.artifactsDir ?? ARTIFACTS_DIR
  await mkdir(outputDir, { recursive: true })

  // Collect all image paths (trace frames + screenshots) and build base64 cache
  const imageCache = new Map<string, string>()
  const allPaths = collectImagePaths(result)

  await Promise.all(
    [...allPaths].map(async (p) => {
      const dataUri = await embedImage(p)
      if (dataUri) imageCache.set(p, dataUri)
    })
  )

  const html = buildHtml(result, imageCache)
  const reportPath = join(outputDir, 'report.html')
  await Bun.write(reportPath, html)
  return reportPath
}
