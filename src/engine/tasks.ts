import type { GameState, TaskDef, TaskState } from './types';
import { baseBalance, cfg, sites, taskDef, taskDefs, twists } from './content';
import { badgeOf } from './rules';
import { hashString, mulberry32 } from './rng';

export function missionSetup(seed: string): { siteId: string; twistId: string; taskIds: string[] } {
  const pick = <T>(tag: string, list: T[]) => list[Math.floor(mulberry32(hashString(seed + ':' + tag))() * list.length)];
  const rng = mulberry32(hashString(seed + ':tasks'));
  const pool = taskDefs.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const n = (baseBalance as unknown as { TASKS_PER_MISSION: number }).TASKS_PER_MISSION;
  return { siteId: pick('site', sites).id, twistId: pick('twist', twists).id, taskIds: pool.slice(0, n).map((d) => d.id) };
}

export function taskText(d: TaskDef): string {
  return d.text.replace('{need}', String(d.need)).replace('{by}', String(d.by));
}

const HOLD = new Set(['airAbove', 'noMedbay', 'greenBadges']);

function met(s: GameState, d: TaskDef): boolean {
  switch (d.check) {
    case 'harvest': return s.counters.harvests >= d.need;
    case 'samples': return s.counters.samples >= d.need;
    case 'cards': return s.cards.found.length >= d.need;
    case 'report': return s.cards.sent.length >= d.need;
    case 'forecast': return (s.counters.forecasts ?? 0) >= d.need;
    case 'airAbove': return s.counters.airLow >= d.need;
    case 'noMedbay': return s.counters.medbaySols === 0 && s.crew.every((p) => p.medbay <= 0);
    case 'greenBadges': return s.crew.every((p) => badgeOf(cfg(s), p.dose) === 'green');
  }
}

export function updateTasks(s: GameState, solDone: boolean): { def: TaskDef; task: TaskState }[] {
  const changed: { def: TaskDef; task: TaskState }[] = [];
  const lastPlayed = solDone ? s.sol : s.sol - 1;
  for (const task of s.tasks) {
    if (task.status !== 'open') continue;
    const d = taskDef(task.id), ok = met(s, d);
    if (HOLD.has(d.check)) {
      if (!ok) task.status = 'failed';
      else if (lastPlayed >= d.by) task.status = 'done';
    } else if (ok && lastPlayed <= d.by) task.status = 'done';
    else if (!ok && lastPlayed >= d.by && !solDone) task.status = 'failed';
    if (task.status !== 'open') {
      task.sol = s.sol;
      if (task.status === 'done') s.science += d.reward;
      changed.push({ def: d, task });
    }
  }
  return changed;
}
