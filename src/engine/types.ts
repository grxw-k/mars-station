export type Mode = 'easy' | 'medium' | 'hard';
export const MODES: Mode[] = ['easy', 'medium', 'hard'];
export type SystemId = 'life' | 'shield' | 'greenhouse' | 'radio' | 'lab';
export const SYSTEMS: SystemId[] = ['life', 'shield', 'greenhouse', 'radio', 'lab'];
export type Job = 'grow' | 'fix' | 'outside' | 'lab' | 'care' | 'rest';
export const JOBS: Job[] = ['grow', 'fix', 'outside', 'lab', 'care', 'rest'];
export type EffectiveJob = Job | 'medbay' | 'shelter' | 'scan' | 'rewire' | 'idle';
export type Role = 'engineer' | 'medic' | 'botanist' | 'scientist' | 'pilot';
export type Phase = 'briefing' | 'plan' | 'event' | 'results' | 'radio' | 'report';
export type Weather = 'clear' | 'hazy' | 'dust';
export type DayKind = 'intro' | 'quiet' | 'trouble' | 'chance' | 'ship';
export type CardKind = 'chance' | 'lab' | 'milestone';
export type Badge = 'green' | 'amber' | 'red';
export type BotStyle = 'careful' | 'sloppy' | 'lazy';

export type DonkiEventType = 'SEP' | 'FLR' | 'CME';

export type DonkiEvent = {
  id: string;
  type: DonkiEventType;
  date: string;
  time?: string;
  classType?: string;
  speed?: number;
  marsImpact?: boolean;
  link: string;
};

export type DonkiPeriod = {
  id: string;
  start: string;
  days: number;
  kind: 'calm' | 'stormy';
  events: DonkiEvent[];
};

export type DonkiFile = {
  stub: boolean;
  generatedAt: string;
  source: string;
  periods: DonkiPeriod[];
};

export type SystemDef = { name: string; want: number; max: number; unlockSol: number };
export type ProblemDef = {
  name: string; where: 'inside' | 'outside'; work: number; airLeak: number; growEvery: number; maxSeverity: number; airOnFix: number;
  growthFactor?: number[]; blocksRadio?: boolean; cellsLost?: number;
};
export type TroubleDef = { title: string; line: string; problem?: string };
export type ChanceDef = { title: string; line: string; card: string | null };
export type CardPhoto = { nasaId: string; alt: string; credit: string };
export type CardDef = { id: string; title: string; kind: CardKind; hint: string; fact: string; source: string; link: string; photo: CardPhoto };
export type DoseComparison = {
  stub: boolean;
  iss: { sixMonthsSolarMaxMSv: number; sixMonthsSolarMinMSv: number; perDayMSv: { min: number; max: number }; source: string; link: string };
  mars: { perDayMSv: number; period: string; source: string; link: string };
};
export type Fact = { id: string; osd: string; study: string; text: string; link: string };
export type CrewDef = { id: string; name: string; role: Role };

export type BalancePatch = { add?: Record<string, number>; set?: Record<string, number | boolean> };
export type SiteDef = { id: string; name: string; where: string; plus: string; minus: string; card: string; patch: BalancePatch };
export type TwistDef = { id: string; name: string; plus: string; minus: string; patch: BalancePatch };
export type TaskCheck = 'harvest' | 'samples' | 'cards' | 'report' | 'forecast' | 'airAbove' | 'noMedbay' | 'greenBadges';
export type TaskDef = { id: string; check: TaskCheck; need: number; by: number; reward: number; text: string };
export type TaskState = { id: string; status: 'open' | 'done' | 'failed'; sol: number | null };

export type RealEvent = { id: string; type: DonkiEventType; date: string; label: string; note: string; link: string };
export type Storm = { day: number; date: string; link: string };

export type Day = {
  sol: number;
  kind: DayKind;
  eventId: string | null;
  weather: Weather;
  storm: Storm | null;
  real: RealEvent[];
  sickIdx: number;
};

export type CrewMember = {
  id: string;
  name: string;
  role: Role;
  cond: 'fine' | 'tired';
  sick: boolean;
  sickRest: number;
  medbay: number;
  medbaySols: number;
  medbayCause: string;
  dose: number;
  stormExtra: number;
  trips: number;
  heavyStreak: number;
  grounded: boolean;
};

export type Problem = { uid: number; type: string; severity: number; done: number; age: number; advice: number; fixed?: boolean; by?: string[] };
export type Plan = { cells: Record<SystemId, number>; jobs: Record<string, Job> };
export type PickSpec = { job: EffectiveJob; task: string; min: number; max: number };
export type Choice = { id: string; label: string; plus: string; minus: string; pick: PickSpec | null; enabled: boolean; why: string; dose: number | null };
export type ChosenChoice = { id: string; crew: string[]; job: EffectiveJob | null; task: string | null; label: string };
export type ResultLine = { t: string; why: string };
export type SolRecord = {
  sol: number; supply: number; cells: Record<SystemId, number>; jobs: Record<string, EffectiveJob>;
  air: { d: number; key: string }[]; harvests: number; choice: string | null;
};
export type Morning = { lines: string[]; notes: string[]; answers: string[]; unlocked: string[]; words: string[]; news: string[] };
export type RadioMessageId = 'forecast' | 'fix' | 'doctors' | 'science';
export type MessageOption = { id: RadioMessageId; label: string; plus: string; minus: string; enabled: boolean; why: string };
export type Forecast = { sol: number; weather: Weather; cells: number; storm: number | null };
export type GameEvent = { kind: 'trouble' | 'chance'; id: string; title: string; line: string; problem?: string; card?: string | null };

export type GameState = {
  version: number;
  name: string;
  seed: string;
  mode: Mode;
  siteId: string;
  twistId: string;
  tasks: TaskState[];
  periodId: string;
  sol: number;
  phase: Phase;
  air: number;
  food: number;
  crop: number;
  samples: number;
  labWork: number;
  science: number;
  crew: CrewMember[];
  problems: Problem[];
  uid: number;
  schedule: Day[];
  supply: number;
  supplyNotes: string[];
  battery: number;
  panelBoost: { cells: number; until: number } | null;
  plan: Plan;
  today: { revealed: boolean; choice: ChosenChoice | null; sickId: string | null; skipEvent: boolean; before: { air: number; food: number; crop: number; science: number } | null };
  radio: { queue: { id: RadioMessageId; sol: number }[]; sent: number };
  known: number[];
  cards: { found: string[]; sent: string[]; owned?: string[] };
  morning: Morning;
  lastResults: ResultLine[];
  log: SolRecord[];
  seenWords: string[];
  flags: { panelsCovered: boolean; prefill: string | null };
  counters: { airZero: number; foodZero: number; harvests: number; medbaySols: number; samples: number; airLow: number; forecasts?: number };
  over: { won: boolean; why: 'ship' | 'air' | 'food' } | null;
};

export type MissionReport = {
  won: boolean; why: string; sol: number; stars: [boolean, boolean, boolean]; starCount: number; hints: [string, string, string]; mattered: string;
  doses: { name: string; role: Role; dose: number; badge: Badge; trips: number; medbaySols: number }[];
  science: number; target: number; found: string[]; sent: string[]; real: (RealEvent & { sol: number })[];
};
