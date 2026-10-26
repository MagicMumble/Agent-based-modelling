const SEARCH_DAYS = 365/2;
const POSTPONE_DAYS = 365/2;

const WIDTH = 1160;
const HEIGHT = 830;
const YEARS = 24; // until 2050
const DAYS = 365 * YEARS;
const CONTRACTORS = 80;
const CAPACITY = 10;
const BASE_ACCEPT = 0.10;
const QUOTATION_INTERVAL_DAYS = 30;
const DECISION_DAYS_WITHOUT_REVIEWS = 31;
const DECISION_DAYS_WITH_REVIEWS = 14;
const POSITIVE_REVIEW_PROB = 0.20; // 20% of vves who are satisfied leave a review (review is just a number 1 to the counter of positive reviews)
const NEGATIVE_REVIEW_PROB = 0.50; // 50% of vves who are not satisfied leave a review (review is just a number 1 to the counter of negative reviews)
const INITIAL_READY = 0.08;
const STATES = { WAIT: 0, SEARCH: 1, RENOVATING: 2, DONE: 3 }; // there's no transition from Done to Wait, the vves get renovated one time max
const PALETTE = {
  page: '#f5f7fa', panel: '#ffffff', line: '#dde4ec', ink: '#263344',
  muted: '#4d5c6d', idle: '#c2cad5', ready: '#e85b60',
  renovating: '#f4b44c', done: '#31a67b',
  base: '#758397', reviews: '#168d77'
};

let controls = {};
let settings;
let baseline;
let reviewed;
let currentDay = 0;
let stopped = false;
const seed = 19074;

// Math.random() cannot reproduce the same run. This small seeded generator
// always returns the same number for the same seed and identifying values,
// keeping the two scenarios directly comparable.
function randomFor(seedValue, ...identifiers) {
  let value = seedValue >>> 0;
  for (const identifier of identifiers) {
    value = (Math.imul(value ^ identifier, 1664525) + 1013904223) >>> 0;
  }
  return value / 4294967296;
}
function bound(v, a, b) { return Math.max(a, Math.min(b, v)); }
function fmt(v, n = 1) { return Number(v).toFixed(n); }
function percentage(k, n) { return n ? 100 * k / n : 0; }

function readSettings() {
  return {
    n: controls.population.value(),
    annualReadiness: controls.readiness.value() / 100,
    trust: controls.trust.value() / 100,
    renovationDays: controls.duration.value() * 365
  };
}

function makeWorld(reviewSystem, worldSeed, cfg) {
  const contractors = [];
  for (let j = 0; j < CONTRACTORS; j++) {
    contractors.push({
      quality: 0.68 + 0.27 * randomFor(worldSeed, j, 0, 1),
      active: 0, positive: 0, negative: 0
    });
  }
  const associations = [];
  const dailyReady = 1 - Math.pow(1 - cfg.annualReadiness, 1 / 365);
  for (let i = 0; i < cfg.n; i++) {
    const firstReady = randomFor(worldSeed, i, 0, 2) < INITIAL_READY;
    const u = randomFor(worldSeed, i, 0, 3);
    const firstReadyDay = firstReady ? 0 :
        1 + Math.floor(Math.log(1 - u) / Math.log(1 - dailyReady));
    associations.push({
      state: firstReady ? STATES.SEARCH : STATES.WAIT,
      readyAt: firstReady ? 0 : firstReadyDay,
      searchSince: firstReady ? 0 : -1,
      nextQuotationAt: firstReady ? 0 : -1,
      decisionAt: -1,
      pendingContractor: -1,
      quotationRound: 0,
      finishAt: -1, contractorIndex: -1, retries: 0
    });
  }
  return {
    reviewSystem, seed: worldSeed, associations, contractors,
    completed: 0, started: 0, postponed: 0, reviews: 0,
    waitingTotal: 0, waitCount: 0,
    byYear: Array(YEARS).fill(0),
    cumulative: Array(YEARS + 1).fill(0)
  };
}

// Neutral Bayesian smoothing (it eliminates the "1-review, 5-star" bias) + no rating is not a 0-star rating.
function publicRating(c) {
  const count = c.positive + c.negative;
  if (count === 0) return null;
  return (c.positive + 1) / (count + 2);
}

function updateWorld(world, day, cfg) {
  for (let i = 0; i < world.associations.length; i++) {
    const a = world.associations[i];

    if (a.state === STATES.WAIT && day >= a.readyAt) {
      a.state = STATES.SEARCH;
      a.searchSince = day;
      a.nextQuotationAt = day;
      a.decisionAt = -1;
      a.pendingContractor = -1;
      a.quotationRound = 0;
    }

    if (a.state === STATES.RENOVATING && day >= a.finishAt) {
      a.state = STATES.DONE;
      world.completed++;
      world.byYear[Math.min(YEARS - 1, Math.floor((day - 1) / 365))]++;
      const c = world.contractors[a.contractorIndex];
      c.active--;
      // The same contractor has the same real quality in both worlds.
      const satisfied = randomFor(world.seed, i, a.contractorIndex, 5) < c.quality;
      if (world.reviewSystem) {
        const p = satisfied ? POSITIVE_REVIEW_PROB : NEGATIVE_REVIEW_PROB;
        if (randomFor(world.seed, i, a.contractorIndex, 6) < p) {
          if (satisfied) c.positive++;
          else c.negative++;
          world.reviews++;
        }
      }
    }

    if (a.state !== STATES.SEARCH) continue;

    // An unsuccessful search can be paused instead of remaining
    // perpetually "ready".
    if (day - a.searchSince >= SEARCH_DAYS) {
      a.state = STATES.WAIT;
      a.readyAt = day + POSTPONE_DAYS;
      a.retries++;
      world.postponed++;
      continue;
    }

    // First process a quotation whose decision period has finished.
    if (a.pendingContractor !== -1 && day >= a.decisionAt) {
      const j = a.pendingContractor;
      const c = world.contractors[j];
      let accept = BASE_ACCEPT;
      if (world.reviewSystem) {
        const rating = publicRating(c);
        if (rating !== null) accept += cfg.trust * (rating - 0.5);
      }
      accept = bound(accept, 0.01, 0.95);

      const contractorStillAvailable = c.active < CAPACITY;
      const offerAccepted = randomFor(world.seed, i, a.quotationRound, 9) < accept;
      a.pendingContractor = -1;
      a.decisionAt = -1;

      if (contractorStillAvailable && offerAccepted) {
        a.state = STATES.RENOVATING;
        a.contractorIndex = j;
        a.finishAt = day + cfg.renovationDays;
        c.active++;
        world.started++;
        world.waitingTotal += day - a.searchSince;
        world.waitCount++;
        continue;
      }

      // Rejected or no longer available: wait before requesting new quotations.
      a.nextQuotationAt = day + QUOTATION_INTERVAL_DAYS;
    }

    // Do not request quotations every day, and do not start another round while
    // the current quotations are still being considered.
    if (a.pendingContractor !== -1 || day < a.nextQuotationAt) continue;

    // Busy preferred firms are skipped, so the VvE can reach firms outside its
    // initial top three. It then evaluates the first three available firms.
    a.quotationRound++;
    const available = Array.from({ length: CONTRACTORS }, (_, contractorIndex) => ({
      contractorIndex,
      preference: randomFor(world.seed, i, a.quotationRound, contractorIndex, 7)
    }))
        .sort((a, b) => a.preference - b.preference)
        .map(item => item.contractorIndex)
        .filter(contractorIndex => world.contractors[contractorIndex].active < CAPACITY)
        .slice(0, 3);

    if (available.length === 0) {
      a.nextQuotationAt = day + QUOTATION_INTERVAL_DAYS;
      continue;
    }

    let chosenContractor = available[0];
    if (world.reviewSystem && cfg.trust > 0) {
      for (const candidate of available.slice(1)) {
        const chosenRating = publicRating(world.contractors[chosenContractor]) ?? 0.5;
        const candidateRating = publicRating(world.contractors[candidate]) ?? 0.5;
        if (candidateRating > chosenRating) chosenContractor = candidate;
      }
    }

    a.pendingContractor = chosenContractor;
    a.decisionAt = day + (world.reviewSystem
        ? DECISION_DAYS_WITH_REVIEWS
        : DECISION_DAYS_WITHOUT_REVIEWS);
  }
  if (day % 365 === 0) world.cumulative[day / 365] = world.completed;
}

function newSimulation() {
  let seed = Math.floor(Math.random() * 4294967296);
  settings = readSettings();
  baseline = makeWorld(false, seed, settings);
  reviewed = makeWorld(true, seed, settings);
  currentDay = 0;
  stopped = false;
  updatePlayText();
}

function advance() {
  if (currentDay >= DAYS) {
    stopped = true;
    updatePlayText();
    return;
  }

  currentDay++;
  updateWorld(baseline, currentDay, settings);
  updateWorld(reviewed, currentDay, settings);

  if (currentDay >= DAYS) {
    stopped = true;
    updatePlayText();
  }
}

function setup() {
  createCanvas(WIDTH, HEIGHT);
  // Render at twice the display resolution so canvas text remains sharp.
  pixelDensity(2);
  frameRate(30);
  textFont('Arial');
  document.body.style.margin = '0';
  document.body.style.background = PALETTE.page;
  createControls();
  newSimulation();
}
function controlButton(label, x, y, w, cb) {
  const b = createButton(label);
  b.position(x, y); b.size(w, 34);
  b.mousePressed(cb);
  b.style('border', '1px solid #d1dbe5');
  b.style('border-radius', '7px');
  b.style('background', '#ffffff');
  b.style('font-weight', 'bold');
  b.style('cursor', 'pointer');
  return b;
}
function createControls() {
  const def = [
    ['population', 'VvEs', 100, 600, 350, 50],
    ['readiness', 'Become ready per year', 1, 20, 8, 1],
    ['trust', 'Influence of reviews', 0, 100, 85, 5],
    ['duration', 'Renovation duration (years)', 1, 4, 2, 1],
    ['speed', 'Speed (days/frame)', 1, 90, 30, 1]
  ];
  controls.sliders = [];
  for (let i = 0; i < def.length; i++) {
    const [key, label, minV, maxV, value, step] = def[i];
    const y = 214 + i * 65;
    controls[key] = createSlider(minV, maxV, value, step);
    controls[key].position(861, y + 29);
    controls[key].size(245, 14);
    controls[key].style('accent-color', PALETTE.reviews);
    if (key !== 'speed') controls[key].changed(newSimulation);
    controls.sliders.push({ key, label, y });
  }
  controls.play = controlButton('Pause', 888, 565, 94, () => {
    stopped = !stopped;
    updatePlayText();
  });
  controls.reset = controlButton('Restart', 994, 565, 94, newSimulation);
}
function updatePlayText() {
  if (controls.play) controls.play.html(stopped ? 'Play' : 'Pause');
}
function draw() {
  background(PALETTE.page);
  if (!stopped) {
    for (let i = 0; i < controls.speed.value() && currentDay < DAYS; i++) advance();
  }
  drawHeader();
  drawVves(baseline, 20, 153, 'Without review system', PALETTE.base);
  drawVves(reviewed, 417, 153, 'With verified reviews', PALETTE.reviews);
  drawGraph(20, 545, 775, 263);
  drawSidebar();
}
function frameRect(x, y, w, h) {
  fill(PALETTE.panel); stroke(PALETTE.line); strokeWeight(1);
  rect(x, y, w, h, 10);
}
function drawHeader() {
  noStroke(); fill(PALETTE.ink); textSize(24); textStyle(BOLD);
  text('VvE renovations: do verified reviews help?', 22, 43);
  textStyle(NORMAL); fill(PALETTE.muted); textSize(13);
  text('Paired agent-based simulation  ·  one day per tick  ·  identical initial conditions', 23, 69);
  fill(PALETTE.muted); textSize(11);
  text('All behavioural probabilities are illustrative assumptions, not estimates of Dutch renovation rates.', 23, 89);
  fill(PALETTE.ink); textSize(14);
  text('Year ' + Math.min(YEARS, Math.floor(currentDay / 365) + 1) + ' of ' + YEARS +
      '     |     Day ' + currentDay.toLocaleString() + ' / ' + DAYS.toLocaleString(), 23, 105);
  drawLegend(23, 124);
}
function drawLegend(x, y) {
  const labels = [ ['Not ready', PALETTE.idle], ['Searching', PALETTE.ready],
    ['Renovating', PALETTE.renovating], ['Renovated', PALETTE.done] ];
  textSize(13);
  labels.forEach((item, i) => {
    const xx = x + i * 133;
    noStroke(); fill(item[1]); rect(xx, y - 10, 11, 11, 2);
    fill(PALETTE.ink); text(item[0], xx + 17, y);
  });
}
function countStates(world) {
  const counts = [0, 0, 0, 0];
  for (const v of world.associations) counts[v.state]++;
  return counts;
}
function drawVves(world, x, y, name, color) {
  const w = 379, h = 370;
  frameRect(x, y, w, h);
  noStroke(); fill(color); textSize(17); textStyle(BOLD);
  text(name, x + 15, y + 29); textStyle(NORMAL);
  fill(PALETTE.ink); textSize(13);
  text('Completed: ' + world.completed + ' / ' + world.associations.length +
      ' (' + fmt(percentage(world.completed, world.associations.length)) + '%)', x + 15, y + 52);
  const c = countStates(world);
  fill(PALETTE.muted); textSize(12);
  text('Searching: ' + c[STATES.SEARCH] + '    In progress: ' + c[STATES.RENOVATING] +
      '    Waiting: ' + c[STATES.WAIT], x + 15, y + 70);
  const nCols = 25;
  const gap = world.associations.length > 475 ? 11 : 12.25;
  const dot = 9.7;
  for (let i = 0; i < world.associations.length; i++) {
    const a = world.associations[i];
    const cx = x + 20 + (i % nCols) * gap;
    const cy = y + 86 + Math.floor(i / nCols) * gap;
    const colour = [PALETTE.idle, PALETTE.ready, PALETTE.renovating, PALETTE.done][a.state];
    noStroke(); fill(colour); rect(cx, cy, dot, dot, 2);
  }
  noStroke(); fill(PALETTE.muted); textSize(11);
  const footer = world.reviewSystem
      ? world.reviews + ' verified reviews posted'
      : 'No public reviews available';
  text(footer, x + 16, y + h - 15);
}
function drawGraph(x, y, w, h) {
  frameRect(x, y, w, h);
  noStroke(); fill(PALETTE.ink); textSize(19); textStyle(BOLD);
  text('Completed renovations over time', x + 18, y + 30);
  textStyle(NORMAL); fill(PALETTE.muted); textSize(13);
  text('Cumulative % of VvEs  ·  higher means more completed projects', x + 18, y + 53);

  // Large, high-contrast legend; previously 11px labels were hard to read.
  const legendY = y + 29;
  const firstX = x + w - 258;
  const secondX = x + w - 130;
  stroke(PALETTE.base); strokeWeight(5);
  line(firstX, legendY - 5, firstX + 23, legendY - 5);
  noStroke(); fill(PALETTE.ink); textSize(14); textStyle(BOLD);
  text('No reviews', firstX + 29, legendY);
  stroke(PALETTE.reviews); strokeWeight(5);
  line(secondX, legendY - 5, secondX + 23, legendY - 5);
  noStroke(); fill(PALETTE.ink);
  text('Reviews', secondX + 29, legendY);
  textStyle(NORMAL);

  const left = x + 57, right = x + w - 25;
  const top = y + 75, bottom = y + h - 34;
  const maxY = 100;
  for (let p = 0; p <= 100; p += 25) {
    const py = bottom - p / maxY * (bottom - top);
    stroke(PALETTE.line); strokeWeight(1);
    line(left, py, right, py);
    noStroke(); fill(PALETTE.muted); textSize(13); textAlign(RIGHT);
    text(p + '%', left - 10, py + 5); textAlign(LEFT);
  }
  noStroke(); fill(PALETTE.muted); textSize(13);
  [0, 5, 10, 15].forEach(yr => {
    const gx = left + yr / YEARS * (right - left);
    textAlign(CENTER); text(yr, gx, bottom + 19); textAlign(LEFT);
  });
  drawGraphLine(baseline, PALETTE.base, left, top, right, bottom);
  drawGraphLine(reviewed, PALETTE.reviews, left, top, right, bottom);
}
function graphDataAt(world, yr) {
  if (yr <= Math.floor(currentDay / 365)) return world.cumulative[yr];
  return undefined;
}
function drawGraphLine(world, colour, left, top, right, bottom) {
  noFill(); stroke(colour); strokeWeight(3.5); beginShape();
  for (let yr = 0; yr <= Math.floor(currentDay / 365); yr++) {
    const value = graphDataAt(world, yr);
    if (value === undefined) continue;
    const px = left + yr / YEARS * (right - left);
    const py = bottom - percentage(value, world.associations.length) / 100 * (bottom - top);
    vertex(px, py);
  }
  if (currentDay % 365 !== 0) {
    const px = left + (currentDay / 365) / YEARS * (right - left);
    const py = bottom - percentage(world.completed, world.associations.length) / 100 * (bottom - top);
    vertex(px, py);
  }
  endShape();
}
function drawSidebar() {
  frameRect(816, 153, 326, 655);
  noStroke(); fill(PALETTE.ink); textSize(17); textStyle(BOLD);
  text('Model settings', 836, 182);
  textStyle(NORMAL); fill(PALETTE.muted); textSize(12);
  text('Move a slider to start a fresh paired run.', 837, 197);
  for (const {key, label, y} of controls.sliders) {
    const val = controls[key].value();
    const suffix = (key === 'readiness' || key === 'trust') ? '%' : '';
    noStroke(); fill(PALETTE.ink); textSize(13);
    text(label, 840, y + 4);
    textAlign(RIGHT); fill(PALETTE.reviews);
    text(val + suffix, 1121, y + 4); textAlign(LEFT);
  }
  stroke(PALETTE.line); line(839, 679, 1119, 679);
  noStroke(); fill(PALETTE.ink); textSize(13); textStyle(BOLD);
  text('Difference in completed renovations', 838, 702); textStyle(NORMAL);
  const diff = percentage(reviewed.completed - baseline.completed, settings.n);
  fill(diff > 0 ? PALETTE.reviews : diff < 0 ? PALETTE.ready : PALETTE.muted);
  textSize(24); textStyle(BOLD);
  text((diff >= 0 ? '+' : '') + fmt(diff, 1) + ' percentage points', 838, 734);
  textStyle(NORMAL); fill(PALETTE.muted); textSize(11);
  text('With reviews minus without reviews', 840, 752);
  const fullYear = Math.floor(currentDay / 365);
  if (fullYear > 0) {
    fill(PALETTE.ink); textSize(10);
    text('Last full year: ' + fmt(percentage(baseline.byYear[fullYear - 1], settings.n), 1) +
        '% vs ' + fmt(percentage(reviewed.byYear[fullYear - 1], settings.n), 1) + '%', 840, 767);
  }
}
