import { t } from './text';
import type { ChosenChoice, CrewMember, EffectiveJob, Forecast, GameState, MessageOption, Mode, Morning, Phase, Plan, RadioMessageId, RealEvent, ResultLine, SolRecord, Storm } from './types';
import { MODES, SYSTEMS } from './types';
import { cardDef, cards, cfg, crewDefs, siteDef, words } from './content';
import { missionSetup, taskText, updateTasks } from './tasks';
import { hashString } from './rng';
import { buildSchedule, normSeed, prettyName } from './schedule';
import {
  addProblem, badgeOf, cellsAvailable, clamp, clone, crewById, currentEvent, dayAt, doseFor, effectiveCells, effectiveJobs, enterMedbay, eventChoices,
  findCard, fmt, isBlackout, isUnlocked, jobAllowed, know, knownForecast, planTotal, plural, problemNeed, r3, radioBlocked, sanitizePlan, signed, stormOn, today, workPower,
} from './rules';

export const SAVE_VERSION = 3;

export const TRANSITIONS: Record<Phase, Phase[]> = {
  briefing: ['plan'],
  plan: ['event', 'results'],
  event: ['plan', 'results'],
  results: ['radio', 'briefing', 'report'],
  radio: ['briefing', 'report'],
  report: [],
};
export function go(s: GameState, to: Phase): GameState {
  if (!TRANSITIONS[s.phase].includes(to)) throw new Error(`Bad transition ${s.phase} -> ${to}`);
  s.phase = to;
  return s;
}

function setSupply(s: GameState): void {
  const c = cfg(s), d = today(s);
  let v = c.CELLS_BY_WEATHER[d.weather];
  const notes = [t('sol.sky', { weather: d.weather, cells: v })];
  for (const p of s.problems) {
    const pd = c.PROBLEMS[p.type];
    if (pd.cellsLost) { v -= pd.cellsLost * p.severity; notes.push(t('sol.cellsLostNote', { problem: pd.name.toLowerCase(), severity: pd.cellsLost * p.severity })); }
  }
  if (s.panelBoost && s.sol <= s.panelBoost.until) { v += s.panelBoost.cells; notes.push(t('sol.polishedPanels', { cells: s.panelBoost.cells })); }
  if (s.battery > 0) { v += s.battery; notes.push(t('sol.battery', { battery: s.battery })); s.battery = 0; }
  s.supply = Math.max(0, v);
  s.supplyNotes = notes;
}

function deliverAnswer(s: GameState, id: RadioMessageId): string {
  const c = cfg(s);
  if (id === 'forecast') {
    for (let k = 1; k <= c.RADIO_FORECAST_SOLS; k++) know(s, s.sol + k);
    return t('sol.earthSentTheSpaceWeather');
  }
  if (id === 'fix') {
    const p = s.problems[0];
    if (!p) return t('sol.earthSaysYourCallCaptain');
    p.advice += 1;
    return t('sol.earthSentARepairTrick', { name: c.PROBLEMS[p.type].name });
  }
  if (id === 'doctors') {
    findCard(s, 'bones');
    const pat = s.crew.filter((p) => p.medbay > 0).sort((a, b) => b.medbay - a.medbay)[0];
    if (pat) {
      pat.medbay = Math.max(0, pat.medbay - 1);
      if (pat.medbay <= 0) { pat.cond = 'fine'; return t('sol.theDoctorsHelpedLeavesThe', { name: pat.name }); }
      return t('sol.theDoctorsHelpedHealsOne', { name: pat.name });
    }
    const ill = s.crew.find((p) => p.sick);
    if (ill) { ill.sickRest += 1; return t('sol.theDoctorsHelpedNeedsLess', { name: ill.name }); }
    return t('sol.earthSaysYourCallCaptain');
  }
  return t('sol.earthGotYourScienceReport');
}

function nextSol(s: GameState): GameState {
  const c = cfg(s), prev = s.sol >= 1 ? today(s) : null, last = s.log[s.log.length - 1];
  if (s.sol >= 1) go(s, 'briefing'); else s.phase = 'briefing';
  s.sol++;
  const day = today(s), M: Morning = { lines: [], notes: [], answers: [], unlocked: [], words: [], news: [] };
  if (s.sol === 1) {
    M.lines.push(t('sol.landingDoneTheStationIs'));
    if (s.siteId) {
      const site = siteDef(s.siteId);
      M.lines.push(t('sol.landedAt', { site: site.name, where: site.where }));
      findCard(s, site.card);
    }
    M.lines.push(t('sol.theShipHomeLandsOn', { missionSols: c.MISSION_SOLS }));
    if (s.tasks.length) M.lines.push(t('sol.missionControlSentTasks', { count: s.tasks.length }));
  } else {
    const steps = t('sol.ofSteps', { crop: fmt(s.crop), cropStepsToHarvest: c.CROP_STEPS_TO_HARVEST });
    M.lines.push(last && last.harvests ? t('sol.harvestCameInNewCrop', { steps }) : t('sol.greenhouseCropIsAt', { steps }));
    M.lines.push(s.problems.length ? t('sol.openTrouble', { names: s.problems.map((p) => c.PROBLEMS[p.type].name).join(', ') }) : t('sol.hullIsHoldingNothingIs'));
    const med = s.crew.filter((p) => p.medbay > 0);
    M.lines.push(med.length ? t('sol.inTheMedbay', { names: med.map((p) => p.name).join(', ') }) : t('sol.nobodyIsInTheMedbay'));
  }
  if (prev && prev.weather === 'dust' && day.weather !== 'dust') {
    if (!s.flags.panelsCovered) { addProblem(s, 'dusty_panels'); M.notes.push(t('sol.dustStormIsOverPanels')); }
    else M.notes.push(t('sol.dustStormIsOverThe'));
    s.flags.panelsCovered = false;
  }
  if (s.radio.queue.length) {
    if (isBlackout(s)) M.answers.push(t('sol.noWordFromEarthThe'));
    else if (radioBlocked(s)) M.answers.push(t('sol.noWordFromEarthThe2'));
    else { for (const m of s.radio.queue) M.answers.push(deliverAnswer(s, m.id)); s.radio.queue = []; }
  }
  for (let k = 1; k <= c.AUTO_FORECAST_SOLS; k++) know(s, s.sol + k);
  for (const { def, task } of updateTasks(s, false)) {
    M.news.push(task.status === 'done' ? t('sol.taskDoneNote', { task: taskText(def), reward: def.reward }) : t('sol.taskMissedNote', { task: taskText(def) }));
  }
  for (const k of SYSTEMS) if (c.SYSTEMS[k].unlockSol === s.sol && s.sol > 1) M.unlocked.push(c.SYSTEMS[k].name);
  if (s.sol === c.JOB_UNLOCK_SOL) M.unlocked.push(t('sol.crewJobs'));
  const word = (k: string) => { if (!s.seenWords.includes(k)) { s.seenWords.push(k); M.words.push(words[k]); } };
  if (s.sol === 1) { word('sol'); word('cell'); }
  if (s.sol === c.SYSTEMS.shield.unlockSol) word('msv');
  if (day.real.some((e) => e.type === 'FLR')) word('flare');
  if (day.storm) word('sep');
  if (isBlackout(s)) word('conj');
  setSupply(s);
  s.today = { revealed: false, choice: null, sickId: null, skipEvent: false, before: null };
  if (s.flags.prefill) {
    const pr = s.problems.find((p) => p.type === s.flags.prefill);
    if (pr) {
      const job = c.PROBLEMS[pr.type].where === 'outside' ? 'outside' : 'fix';
      const pool = s.crew.filter((p) => jobAllowed(s, p, job).ok && !p.sick && p.cond !== 'tired');
      const who = pool.find((p) => p.role === 'engineer') || pool[0];
      if (who) { s.plan.jobs[who.id] = job; M.notes.push(t('sol.isSetToFixThe', { name: who.name, problem: c.PROBLEMS[pr.type].name.toLowerCase() })); }
    }
    s.flags.prefill = null;
  }
  s.plan = sanitizePlan(s, s.plan);
  s.morning = M;
  return s;
}

export function createMission(name: string, mode: Mode, setup: Partial<{ siteId: string; twistId: string; taskIds: string[]; owned: string[] }> = {}): GameState {
  const m: Mode = MODES.includes(mode) ? mode : 'medium', seed = normSeed(name), sched = buildSchedule(seed);
  const pick = { ...missionSetup(seed), ...setup }, c = cfg({ mode: m, siteId: pick.siteId, twistId: pick.twistId });
  const air = clamp(c.AIR_START, 0, c.TANK_MAX), startDose = c.START_DOSE ?? 0;
  const s: GameState = {
    version: SAVE_VERSION, name: prettyName(name), seed, mode: m, siteId: pick.siteId, twistId: pick.twistId,
    tasks: pick.taskIds.map((id) => ({ id, status: 'open', sol: null })), periodId: sched.periodId, sol: 0, phase: 'briefing',
    air, food: clamp(c.FOOD_START, 0, c.TANK_MAX), crop: 0, samples: 0, labWork: 0, science: 0,
    crew: crewDefs.map((d): CrewMember => ({ id: d.id, name: d.name, role: d.role, cond: 'fine', sick: false, sickRest: 0, medbay: 0, medbaySols: 0, medbayCause: '', dose: startDose, stormExtra: 0, trips: 0, heavyStreak: 0, grounded: false })),
    problems: [], uid: 0, schedule: sched.days,
    supply: 0, supplyNotes: [], battery: 0, panelBoost: null,
    plan: { cells: { life: c.SYSTEMS.life.want, shield: 0, greenhouse: c.SYSTEMS.greenhouse.want, radio: 0, lab: 0 }, jobs: {} },
    today: { revealed: false, choice: null, sickId: null, skipEvent: false, before: null },
    radio: { queue: [], sent: 0 }, known: [], cards: { found: [], sent: [], owned: pick.owned ?? [] },
    morning: { lines: [], notes: [], answers: [], unlocked: [], words: [], news: [] }, lastResults: [], log: [], seenWords: [],
    flags: { panelsCovered: false, prefill: null },
    counters: { airZero: 0, foodZero: 0, harvests: 0, medbaySols: 0, samples: 0, airLow: air }, over: null,
  };
  for (const p of s.crew) s.plan.jobs[p.id] = 'rest';
  return nextSol(s);
}

export type MorningReport = Morning & { sol: number; weather: string; cells: number; cellNotes: string[]; storm: (Storm & { mult: number }) | null; real: RealEvent[]; blackout: boolean; forecast: Forecast[] };
export function getMorning(s: GameState): MorningReport {
  return { ...s.morning, sol: s.sol, weather: today(s).weather, cells: s.supply, cellNotes: s.supplyNotes, storm: stormOn(s), real: today(s).real, blackout: isBlackout(s), forecast: knownForecast(s) };
}

export function startPlanning(state: GameState): GameState {
  if (state.phase !== 'briefing') return state;
  return go(clone(state), 'plan');
}

export function applyPlan(state: GameState, plan: Plan): GameState {
  if (state.phase !== 'plan') return state;
  const s = clone(state);
  s.plan = sanitizePlan(s, plan);
  const ch = s.today.choice;
  if (ch) {
    const def = eventChoices(s).find((x) => x.id === ch.id);
    if (!def || !def.enabled) { s.today.choice = null; s.plan = sanitizePlan(s, s.plan); }
  }
  return s;
}

function revealEvent(s: GameState): void {
  if (s.today.revealed) return;
  s.today.revealed = true;
  const ev = currentEvent(s);
  if (!ev) return;
  if (ev.kind === 'trouble' && ev.problem) addProblem(s, ev.problem);
  if (ev.id === 'sick_crew') {
    const n = s.crew.length, start = today(s).sickIdx;
    for (let k = 0; k < n; k++) { const p = s.crew[(start + k) % n]; if (p.medbay <= 0 && !p.sick) { s.today.sickId = p.id; break; } }
    if (!s.today.sickId) s.today.skipEvent = true;
  }
  if (ev.id === 'clean_wind') s.problems = s.problems.filter((p) => p.type !== 'dusty_panels');
}

export function confirmPlan(state: GameState): GameState {
  if (state.phase !== 'plan') return state;
  const s = clone(state);
  revealEvent(s);
  if (currentEvent(s)) return go(s, 'event');
  return playSol(s).state;
}
export function backToPlan(state: GameState): GameState {
  if (state.phase !== 'event') return state;
  return go(clone(state), 'plan');
}
export function clearChoice(state: GameState): GameState {
  const s = clone(state);
  s.today.choice = null;
  s.plan = sanitizePlan(s, s.plan);
  return s;
}

export function resolveEvent(state: GameState, choiceId: string, crewIds: string[] = []): GameState {
  if (state.phase !== 'event') return state;
  const s = clone(state), def = eventChoices(s).find((x) => x.id === choiceId);
  if (!def || !def.enabled) return s;
  const crew: string[] = [];
  if (def.pick) {
    for (const id of crewIds) {
      const p = s.crew.find((x) => x.id === id);
      if (p && !crew.includes(id) && p.medbay <= 0 && !(def.pick.job === 'outside' && p.grounded) && crew.length < def.pick.max) crew.push(id);
    }
    if (crew.length < def.pick.min) return s;
  }
  s.today.choice = { id: choiceId, crew, job: def.pick ? def.pick.job : null, task: def.pick ? def.pick.task : null, label: def.label };
  s.plan = sanitizePlan(s, s.plan);
  return s;
}

export function playSol(state: GameState): { state: GameState; results: ResultLine[] } {
  if (state.phase !== 'plan' && state.phase !== 'event') return { state, results: [] };
  const s = clone(state), c = cfg(s), day = today(s), R: ResultLine[] = [];
  const say = (t: string, why = '') => { R.push({ t, why }); };
  revealEvent(s);
  const ev = currentEvent(s);
  if (ev && !s.today.choice) {
    const l = eventChoices(s).filter((x) => x.enabled && !x.pick), d = l[l.length - 1];
    s.today.choice = { id: d.id, crew: [], job: null, task: null, label: d.label };
  }
  const ch: ChosenChoice | null = ev ? s.today.choice : null;
  s.plan = sanitizePlan(s, s.plan);
  s.today.before = { air: s.air, food: s.food, crop: s.crop, science: s.science };
  const jobs = effectiveJobs(s), cells = effectiveCells(s), storm = stormOn(s);
  const rec: SolRecord = { sol: s.sol, supply: cellsAvailable(s), cells, jobs, air: [], harvests: 0, choice: ev && ch ? ev.id + ':' + ch.id : null };
  const names = (list: CrewMember[]) => list.map((p) => p.name).join(' and ');
  const withJob = (j: EffectiveJob) => s.crew.filter((p) => jobs[p.id] === j);
  const tank = (key: 'air' | 'food', label: string, d: number, why: string, causeKey?: string) => {
    if (!d) return;
    const b = s[key];
    s[key] = clamp(s[key] + d, 0, c.TANK_MAX);
    const real = s[key] - b;
    if (key === 'air') rec.air.push({ d: real, key: causeKey || why });
    if (real !== 0) say(t('sol.tankChange', { label, change: signed(real), note: (real !== d ? (d > 0 ? t('sol.tankFull') : t('sol.tankEmpty')) : '') }), why);
    else say(label + (d > 0 ? t('sol.tankIsFull') : t('sol.tankIsEmpty')), why);
  };
  const air = (d: number, why: string, key?: string) => tank('air', t('sol.airWater'), d, why, key);
  const food = (d: number, why: string) => tank('food', t('sol.food'), d, why);

  if (ev && ch && ev.id === 'sick_crew' && s.today.sickId) {
    const p = crewById(s, s.today.sickId);
    if (ch.id === 'medbay_now') { enterMedbay(s, p, c.ILLNESS_MEDBAY_STEPS, t('sol.feelingIll')); say(t('sol.wentToTheMedbay', { name: p.name }), t('sol.illYourChoice')); }
    else { p.sick = true; p.sickRest = 0; }
  }
  if (ev && ch && ev.id === 'power_fault') {
    if (ch.id === 'dark_greenhouse') say(t('sol.greenhouseDarkToday'), t('sol.blownFuseYourChoice'));
    else if (ch.id === 'dark_labradio') say(t('sol.labAndRadioDarkToday'), t('sol.blownFuseYourChoice'));
    else say(t('sol.fuseRewiredNothingWentDark'), t('sol.spentTheDayOnIt', { names: names(withJob('rewire')) }));
  }

  const repair = (where: string, workers: CrewMember[]): CrewMember[] => {
    const idle: CrewMember[] = [];
    workers.sort((a, b) => workPower(c, b, 'fix') - workPower(c, a, 'fix'));
    for (const p of workers) {
      let w = workPower(c, p, 'fix'), did = false;
      for (const pr of s.problems) {
        if (w <= 1e-9) break;
        if (pr.fixed || c.PROBLEMS[pr.type].where !== where) continue;
        const use = Math.min(w, problemNeed(c, pr) - pr.done);
        pr.done += use; w -= use; did = true;
        pr.by = pr.by || [];
        if (!pr.by.includes(p.name)) pr.by.push(p.name);
        if (pr.done >= problemNeed(c, pr) - 1e-9) pr.fixed = true;
      }
      if (!did) idle.push(p);
    }
    return idle;
  };
  const task = ch ? ch.task : null, picked = ch ? ch.crew : [];
  const special = (id: string) => picked.includes(id) && (task === 'chance' || task === 'cover' || task === 'polish');
  for (const p of repair('inside', withJob('fix'))) { say(t('sol.hadNothingToFix', { name: p.name }), t('sol.nothingIsBrokenInside')); jobs[p.id] = 'idle'; }
  for (const p of repair('outside', withJob('outside').filter((x) => !special(x.id)))) {
    const n = workPower(c, p, 'outside');
    s.samples = r3(s.samples + n);
    s.counters.samples = r3(s.counters.samples + n);
    say(t('sol.samples', { amount: signed(n) }), t('sol.wentOutside', { name: p.name }));
  }
  for (const pr of s.problems) {
    const pd = c.PROBLEMS[pr.type];
    if (pr.fixed) { say(t('sol.fixed', { name: pd.name }), t('sol.repairBy', { names: (pr.by || []).join(' and ') })); if (pd.airOnFix) air(pd.airOnFix, t('sol.worksAgain', { problem: pd.name.toLowerCase() }), 'fix'); }
    else if (pr.by && pr.by.length) say(t('sol.repairOf', { name: pd.name, done: fmt(pr.done), needed: fmt(problemNeed(c, pr)) }), t('sol.workedOnIt', { names: pr.by.join(' and ') }));
    delete pr.by;
  }
  s.problems = s.problems.filter((pr) => !pr.fixed);

  const lamp = s.problems.find((p) => p.type === 'lamp_fault');
  const lf = lamp ? (c.PROBLEMS.lamp_fault.growthFactor || [1])[lamp.severity - 1] : 1;
  let steps = 0;
  if (cells.greenhouse > 0) {
    const st = cells.greenhouse * c.STEPS_PER_GREENHOUSE_CELL * lf;
    steps += st;
    say(t('sol.crop', { steps: plural(st, 'step') }), plural(cells.greenhouse, t('sol.greenhouseCell')) + (lamp ? t('sol.lampsAreFaulty') : ''));
  } else say(t('sol.cropsWait'), t('sol.greenhouseDark'));
  for (const p of withJob('grow')) {
    if (cells.greenhouse > 0 || !c.GROW_NEEDS_LIGHT) { const st = workPower(c, p, 'grow'); steps += st; say(t('sol.crop', { steps: plural(st, 'step') }), t('sol.tendedThePlants', { name: p.name })); }
    else say(t('sol.couldNotGrow', { name: p.name }), t('sol.greenhouseDark'));
  }
  s.crop = r3(s.crop + steps);
  while (s.crop >= c.CROP_STEPS_TO_HARVEST - 1e-9) {
    s.crop = Math.max(0, r3(s.crop - c.CROP_STEPS_TO_HARVEST));
    rec.harvests++; s.counters.harvests++;
    food(c.HARVEST_FOOD, t('sol.harvestCropReachedSteps', { cropStepsToHarvest: c.CROP_STEPS_TO_HARVEST }));
  }

  const labPower = isUnlocked(s, 'lab') ? Math.min(1, cells.lab / c.SYSTEMS.lab.want) : 0;
  const labOn = labPower >= 1 - 1e-9;
  for (const p of withJob('lab')) {
    if (labPower <= 0) { say(t('sol.noLabWork', { name: p.name }), t('sol.labDark')); continue; }
    if (s.samples < 1) { say(t('sol.noLabWork', { name: p.name }), t('sol.noSamplesToStudy')); continue; }
    s.labWork = r3(s.labWork + workPower(c, p, 'lab') * labPower);
    let made = false;
    while (s.labWork >= c.LAB_WORK_PER_SAMPLE - 1e-9 && s.samples >= 1) {
      s.labWork = Math.max(0, r3(s.labWork - c.LAB_WORK_PER_SAMPLE));
      s.samples = r3(s.samples - 1);
      made = true;
      const lab = cards.filter((k) => k.kind === 'lab'), start = hashString(s.seed + ':lab') % lab.length;
      const order = [...lab.slice(start), ...lab.slice(0, start)], owned = s.cards.owned ?? [];
      const next = order.find((k) => !s.cards.found.includes(k.id) && !owned.includes(k.id)) ?? order.find((k) => !s.cards.found.includes(k.id));
      if (next) findCard(s, next.id, say, t('sol.studiedASample', { name: p.name }));
      else say(t('sol.sampleStudiedNothingNew'), t('sol.allLabCardsAreFound'));
    }
    if (!made) say(t('sol.sampleHalfStudied'), t('sol.workedInTheLab', { name: p.name }));
  }
  if (s.samples < 1) s.labWork = 0;

  if (ev && ch && ev.kind === 'chance' && ev.id !== 'clean_wind') {
    if (ch.id === 'outside') {
      const p = crewById(s, picked[0]);
      findCard(s, ev.card, say, t('sol.wentOutsideForIt', { name: p.name }));
      s.samples = r3(s.samples + c.CHANCE_SAMPLES);
      s.counters.samples = r3(s.counters.samples + c.CHANCE_SAMPLES);
      say(t('sol.samples2', { chanceSamples: signed(c.CHANCE_SAMPLES) }), t('sol.broughtOneBack', { name: p.name }));
    } else if (ch.id === 'scan') {
      if (labOn && withJob('scan').length) findCard(s, ev.card, say, t('sol.scannedItFromTheLab', { names: names(withJob('scan')) }));
      else say(t('sol.scanFailed'), t('sol.labDark'));
    } else say(t('sol.chanceGone'), t('sol.youLetItGo'));
  }
  if (ev && ch && ev.id === 'clean_wind') {
    if (ch.id === 'use_now') say(t('sol.cellsToday', { windBonusCells: c.WIND_BONUS_CELLS }), t('sol.windCleanedThePanels'));
    else if (ch.id === 'polish') {
      s.panelBoost = { cells: c.WIND_POLISH_CELLS, until: s.sol + c.WIND_POLISH_SOLS };
      say(t('sol.cellsForSols', { windPolishCells: c.WIND_POLISH_CELLS, windPolishSols: c.WIND_POLISH_SOLS }), t('sol.polishedThePanels', { name: crewById(s, picked[0]).name }));
    } else say(t('sol.chanceGone'), t('sol.youLetItGo'));
  }
  if (ev && ch && ev.id === 'dust_storm') {
    if (ch.id === 'cover') { s.flags.panelsCovered = true; say(t('sol.panelsTiltedAgainstTheDust'), t('sol.wentOutside', { name: crewById(s, picked[0]).name })); }
    else say(t('sol.panelsLeftInTheDust'), t('sol.youWaitedItOut'));
  }

  const carers = withJob('care'), careFor: Record<string, number> = {};
  if (carers.length) {
    const pts = carers.reduce((a, p) => a + workPower(c, p, 'care'), 0);
    const pat = s.crew.filter((p) => jobs[p.id] === 'medbay').sort((a, b) => b.medbay - a.medbay)[0] || s.crew.find((p) => p.sick && jobs[p.id] === 'rest');
    if (pat) careFor[pat.id] = pts; else say(t('sol.hadNobodyToCareFor', { carers: names(carers) }), t('sol.nobodyIsIll'));
  }

  const miss = c.SYSTEMS.life.want - cells.life;
  if (miss > 0) air(-miss * c.AIR_LOSS_PER_MISSING_CELL, t('sol.lifeSupportShort', { miss: plural(miss, 'cell') }), 'life');
  else if (miss < 0) air(-miss * c.AIR_GAIN_PER_EXTRA_CELL, t('sol.extraLifeSupportCell'), 'extra');
  for (const pr of s.problems) { const pd = c.PROBLEMS[pr.type]; if (pd.airLeak) air(-pd.airLeak * pr.severity, t('sol.leaks', { problem: pd.name.toLowerCase() }), pr.type); }
  food(-c.FOOD_EATEN_PER_SOL, t('sol.theCrewAte'));

  if (storm) say(t('sol.solarStormDoseXWithout', { mult: storm.mult }), cells.shield >= c.SYSTEMS.shield.want ? t('sol.shieldAtFullPowerMinimum') : t('sol.shieldHasOfCells', { shield: cells.shield, want: c.SYSTEMS.shield.want }));
  for (const p of s.crew) {
    const j = jobs[p.id], r = doseFor(c, storm, j, cells.shield), b0 = badgeOf(c, p.dose);
    p.dose = r3(p.dose + r.d);
    p.stormExtra = r3(p.stormExtra + r.extra);
    if (j === 'outside') p.trips++;
    const b1 = badgeOf(c, p.dose);
    if (b1 !== b0) {
      say(t('sol.sBadgeTurned', { name: p.name, b1 }), j === 'outside' ? t('sol.tripOutside') : r.extra > 0.01 ? t('sol.stormWithAWeakShield') : t('sol.doseAddsUpEverySol'));
      if (b1 === 'red' && c.RED_BADGE_GROUNDS) { p.grounded = true; say(t('sol.staysInsideFromNowOn', { name: p.name }), t('sol.redBadge')); }
    }
  }

  for (const p of s.crew) {
    const j = jobs[p.id];
    if (j === 'medbay') {
      p.medbaySols++; s.counters.medbaySols++;
      p.medbay = r3(p.medbay - c.MEDBAY_HEAL_PER_SOL - (careFor[p.id] || 0));
      if (p.medbay <= 1e-9) { p.medbay = 0; p.cond = 'fine'; p.sick = false; p.heavyStreak = 0; say(t('sol.leavesTheMedbay', { name: p.name }), careFor[p.id] ? t('sol.healedFasterWithCare') : 'healed'); }
      else say(t('sol.staysInTheMedbay', { name: p.name }), plural(Math.ceil(p.medbay), t('sol.moreSol')));
      continue;
    }
    if (p.sick) {
      if (j === 'rest') {
        p.sickRest = r3(p.sickRest + 1 + (careFor[p.id] || 0));
        p.heavyStreak = 0;
        if (p.sickRest >= c.SICK_REST_SOLS_TO_CURE - 1e-9) { p.sick = false; p.sickRest = 0; p.cond = 'fine'; say(t('sol.isWellAgain', { name: p.name }), careFor[p.id] ? t('sol.bedRestAndCare') : t('sol.bedRest')); }
        else say(t('rules.restsInTheBunk', { name: p.name }), t('sol.oneMoreRestSolNeeded'));
      } else { enterMedbay(s, p, c.SICK_WORK_MEDBAY_STEPS, t('sol.workingWhileIll')); say(t('sol.gotWorseMedbay', { name: p.name }), t('sol.workedWhileIll')); }
      continue;
    }
    if (c.HEAVY_JOBS.includes(j)) {
      if (p.cond === 'tired' && c.TIRED_HEAVY_WORK_INJURES) {
        enterMedbay(s, p, c.INJURY_MEDBAY_STEPS, j === 'outside' ? t('sol.aTripOutsideWhileTired') : t('sol.heavyWorkWhileTired'));
        say(t('sol.gotHurtMedbay', { name: p.name }), t('sol.heavyWorkWhileTired'));
      } else {
        p.heavyStreak++;
        if (p.heavyStreak >= c.HEAVY_SOLS_TO_TIRED && p.cond !== 'tired') { p.cond = 'tired'; say(t('sol.isTired', { name: p.name }), t('sol.heavySolsInARow', { heavySolsToTired: c.HEAVY_SOLS_TO_TIRED })); }
      }
    } else {
      p.heavyStreak = 0;
      if (j === 'rest' && p.cond === 'tired') { p.cond = 'fine'; say(t('sol.isRested', { name: p.name }), t('sol.tookARestSol')); }
    }
  }

  for (const pr of s.problems) {
    const pd = c.PROBLEMS[pr.type];
    pr.age++;
    if (pd.growEvery > 0 && pr.age % pd.growEvery === 0 && pr.severity < pd.maxSeverity) { pr.severity++; say(t('sol.grewWorse', { name: pd.name }), t('sol.leftOpenFor', { age: plural(pr.age, 'sol') })); }
  }
  if (ev && ch && ch.id === 'tomorrow' && ev.problem) s.flags.prefill = ev.problem;

  const next = dayAt(s, s.sol + 1);
  if (rec.harvests > 0) findCard(s, 'space_radishes', say, t('sol.firstHarvest'));
  if (day.storm && !(next && next.storm)) findCard(s, 'storm_survived', say, t('sol.theSolarStormPassed'));
  if (day.weather === 'dust' && !(next && next.weather === 'dust')) findCard(s, 'dust_survived', say, t('sol.theDustStormPassed'));
  if (isBlackout(s) && !isBlackout(s, s.sol + 1)) findCard(s, 'conjunction', say, t('sol.theRadioBlackoutEnded'));

  const unused = rec.supply - planTotal(s.plan);
  if (unused > 0) {
    if (c.BATTERY_CAPACITY > 0) {
      s.battery = Math.min(c.BATTERY_CAPACITY, unused);
      say(t('sol.savedInTheBattery', { battery: plural(s.battery, 'cell') }), t('sol.notSharedOut'));
      if (unused > s.battery) say(t('sol.lostAtSunset', { battery: plural(unused - s.battery, 'cell') }), t('sol.batteryIsFull'));
    } else say(t('sol.lostAtSunset2', { unused: plural(unused, 'cell') }), t('sol.notSharedOut'));
  }

  s.counters.airZero = s.air <= 0 ? s.counters.airZero + 1 : 0;
  s.counters.foodZero = s.food <= 0 ? s.counters.foodZero + 1 : 0;
  if (s.counters.airZero >= c.ZERO_SOLS_TO_LOSE) s.over = { won: false, why: 'air' };
  else if (s.counters.foodZero >= c.ZERO_SOLS_TO_LOSE) s.over = { won: false, why: 'food' };
  else if (s.counters.airZero || s.counters.foodZero) say(t('sol.warningATankIsEmpty'), t('sol.oneMoreEmptySolEnds'));

  s.counters.airLow = Math.min(s.counters.airLow, s.air);
  for (const { def, task } of updateTasks(s, true)) {
    if (task.status === 'done') say(t('sol.taskDone', { reward: def.reward }), taskText(def));
    else say(t('sol.taskMissed'), taskText(def));
  }

  s.log.push(rec);
  s.lastResults = R;
  go(s, 'results');
  return { state: s, results: R };
}

export function previewSol(state: GameState): GameState {
  const s = clone(state);
  if (!s.today.revealed) { const d = s.schedule[s.sol - 1]; d.kind = 'quiet'; d.eventId = null; }
  return playSol(s).state;
}

export function radioCanSend(s: GameState): boolean {
  const c = cfg(s), last = s.log[s.log.length - 1];
  return isUnlocked(s, 'radio') && !isBlackout(s) && !radioBlocked(s) && !!last && last.sol === s.sol && last.cells.radio >= c.SYSTEMS.radio.want;
}
export function radioOffReason(s: GameState): string {
  const c = cfg(s), last = s.log[s.log.length - 1];
  if (!isUnlocked(s, 'radio')) return t('sol.theRadioOpensOnSol', { unlocksol: c.SYSTEMS.radio.unlockSol });
  if (isBlackout(s)) return t('sol.radioBlackoutTheSunIs');
  if (radioBlocked(s)) return t('sol.noRadioTheAntennaIs');
  if (!last || last.cells.radio < c.SYSTEMS.radio.want) return t('sol.noMessageTonightTheRadio');
  return '';
}
export function messageOptions(s: GameState): MessageOption[] {
  const c = cfg(s), unsent = s.cards.found.filter((id) => !s.cards.sent.includes(id));
  const firstBonus = s.radio.sent === 0 && !s.cards.found.includes('first_call') ? c.SCIENCE_PER_CARD.milestone : 0;
  const pts = unsent.reduce((a, id) => a + c.SCIENCE_PER_CARD[cardDef(id).kind], 0) + firstBonus;
  const ill = s.crew.some((p) => p.medbay > 0 || p.sick);
  return [
    { id: 'forecast', label: t('sol.whatWillSpaceWeatherBe'), plus: t('sol.forecastForSolsAtBreakfast', { radioForecastSols: c.RADIO_FORECAST_SOLS }), minus: t('sol.usesTonightSMessage'), enabled: true, why: '' },
    { id: 'fix', label: t('sol.howCanWeFixIt'), plus: t('sol.theOpenRepairNeedsLess'), minus: t('sol.usesTonightSMessage'), enabled: s.problems.length > 0, why: t('sol.nothingIsBroken') },
    { id: 'doctors', label: t('sol.askTheDoctors'), plus: t('sol.aPatientHealsOneSol'), minus: t('sol.usesTonightSMessage'), enabled: ill, why: t('sol.nobodyIsIll2') },
    { id: 'science', label: t('sol.sendOurScienceReport'), plus: t('sol.sentScience', { card: plural(unsent.length + (firstBonus ? 1 : 0), 'card'), pts }), minus: t('sol.noQuestionTonightNoForecast'), enabled: unsent.length > 0, why: t('sol.noNewCardsToSend') },
  ];
}

function endOrNext(s: GameState): GameState {
  if (s.sol >= cfg(s).MISSION_SOLS) { s.over = { won: true, why: 'ship' }; return go(s, 'report'); }
  return nextSol(s);
}
export function proceed(state: GameState): GameState {
  if (state.phase !== 'results') return state;
  const s = clone(state);
  if (s.over) return go(s, 'report');
  if (radioCanSend(s)) return go(s, 'radio');
  return endOrNext(s);
}
export function sendMessage(state: GameState, messageId: RadioMessageId | null): GameState {
  if (state.phase !== 'radio') return state;
  const s = clone(state), c = cfg(s), opt = messageOptions(s).find((m) => m.id === messageId);
  if (messageId && opt && opt.enabled) {
    if (s.radio.sent === 0) findCard(s, 'first_call');
    s.radio.sent++;
    if (messageId === 'science') {
      for (const id of s.cards.found.filter((x) => !s.cards.sent.includes(x))) { s.cards.sent.push(id); s.science += c.SCIENCE_PER_CARD[cardDef(id).kind]; }
    }
    if (messageId === 'forecast') s.counters.forecasts = (s.counters.forecasts ?? 0) + 1;
    s.radio.queue.push({ id: messageId, sol: s.sol });
  }
  return endOrNext(s);
}
