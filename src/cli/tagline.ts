const DEFAULT_TAGLINE = "Your AI legal assistant, ready to help.";

const HOLIDAY_TAGLINES = {
  newYear:
    "New Year's Day: New year, fresh cases—may your dockets be manageable and your filings on time.",
  lunarNewYear:
    "Lunar New Year: May your cases prosper, your clients be happy, and your billable hours flow smoothly.",
  christmas:
    "Christmas: Ho ho ho—your legal assistant is here to help wrap up those year-end matters.",
  eid: "Eid al-Fitr: Celebration mode: deadlines met, clients served, and peace of mind delivered.",
  diwali: "Diwali: Let the victories shine bright—today we illuminate the path to justice.",
  easter: "Easter: Found that missing document—consider it a small legal egg hunt victory.",
  hanukkah:
    "Hanukkah: Eight nights, eight wins—may your practice stay bright and your outcomes favorable.",
  halloween:
    "Halloween: Spooky season: beware missed deadlines, lost documents, and the ghost of billable hours past.",
  thanksgiving:
    "Thanksgiving: Grateful for organized files, happy clients, and an assistant that never forgets a deadline.",
  valentines:
    "Valentine's Day: Here to handle the paperwork so you can spend time with the people who matter.",
} as const;

const TAGLINES: string[] = [
  "Your legal research assistant—ready when you are.",
  "Intake, research, documents—handled with precision.",
  "I read case law so you can focus on strategy.",
  "From intake to invoice, I've got you covered.",
  "Your firm's AI paralegal, available 24/7.",
  "Making billable hours less about busywork.",
  "I'll find the precedent while you prepare the argument.",
  "Document review at the speed of thought.",
  "Client intake, simplified and streamlined.",
  "Because attorneys shouldn't spend hours on paperwork.",
  "Legal research, accelerated.",
  "Your matters, organized. Your deadlines, tracked.",
  "I remember every detail so you don't have to.",
  "Connecting your cases, calendars, and communications.",
  "AI that understands attorney-client privilege.",
  "From first contact to final resolution.",
  "Research assistant that never needs a coffee break.",
  "Drafting, reviewing, organizing—at your service.",
  "Less time filing, more time litigating.",
  "Your documents, searchable. Your knowledge, accessible.",
  "I'll handle the administrative, you handle the adversarial.",
  "Making legal practice more efficient, one task at a time.",
  "Conflict checks in seconds, not hours.",
  "Smart intake that captures what matters.",
  "Because every matter deserves proper attention.",
  "Your firm's institutional knowledge, instantly accessible.",
  "Research, summarized. Documents, organized. Deadlines, never missed.",
  "The assistant that scales with your practice.",
  "From solo practitioner to large firm, I adapt.",
  "Legal tech that actually saves time.",
  "I track deadlines like they're billable hours.",
  "Your case files, always at your fingertips.",
  "Making e-discovery less of a discovery.",
  "Client communications, professionally managed.",
  "The associate that never sleeps—and never bills overtime.",
  "Court dates, statutes of limitations, filing deadlines—all tracked.",
  "I draft memos while you take depositions.",
  "Legal research without the library card.",
  "Your brief is due tomorrow? Let's get to work.",
  HOLIDAY_TAGLINES.newYear,
  HOLIDAY_TAGLINES.lunarNewYear,
  HOLIDAY_TAGLINES.christmas,
  HOLIDAY_TAGLINES.eid,
  HOLIDAY_TAGLINES.diwali,
  HOLIDAY_TAGLINES.easter,
  HOLIDAY_TAGLINES.hanukkah,
  HOLIDAY_TAGLINES.halloween,
  HOLIDAY_TAGLINES.thanksgiving,
  HOLIDAY_TAGLINES.valentines,
];

type HolidayRule = (date: Date) => boolean;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

const onMonthDay =
  (month: number, day: number): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
  };

const onSpecificDates =
  (dates: Array<[number, number, number]>, durationDays = 1): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
      if (parts.year !== year) {
        return false;
      }
      const start = Date.UTC(year, month, day);
      const current = Date.UTC(parts.year, parts.month, parts.day);
      return current >= start && current < start + durationDays * DAY_MS;
    });
  };

const inYearWindow =
  (
    windows: Array<{
      year: number;
      month: number;
      day: number;
      duration: number;
    }>,
  ): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    const window = windows.find((entry) => entry.year === parts.year);
    if (!window) {
      return false;
    }
    const start = Date.UTC(window.year, window.month, window.day);
    const current = Date.UTC(parts.year, parts.month, parts.day);
    return current >= start && current < start + window.duration * DAY_MS;
  };

const isFourthThursdayOfNovember: HolidayRule = (date) => {
  const parts = utcParts(date);
  if (parts.month !== 10) {
    return false;
  } // November
  const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
  const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
  const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
  return parts.day === fourthThursday;
};

const HOLIDAY_RULES = new Map<string, HolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [
    HOLIDAY_TAGLINES.lunarNewYear,
    onSpecificDates(
      [
        [2025, 0, 29],
        [2026, 1, 17],
        [2027, 1, 6],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.eid,
    onSpecificDates(
      [
        [2025, 2, 30],
        [2025, 2, 31],
        [2026, 2, 20],
        [2027, 2, 10],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.diwali,
    onSpecificDates(
      [
        [2025, 9, 20],
        [2026, 10, 8],
        [2027, 9, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.easter,
    onSpecificDates(
      [
        [2025, 3, 20],
        [2026, 3, 5],
        [2027, 2, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.hanukkah,
    inYearWindow([
      { year: 2025, month: 11, day: 15, duration: 8 },
      { year: 2026, month: 11, day: 5, duration: 8 },
      { year: 2027, month: 11, day: 25, duration: 8 },
    ]),
  ],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);

function isTaglineActive(tagline: string, date: Date): boolean {
  const rule = HOLIDAY_RULES.get(tagline);
  if (!rule) {
    return true;
  }
  return rule(date);
}

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
}

export function activeTaglines(options: TaglineOptions = {}): string[] {
  if (TAGLINES.length === 0) {
    return [DEFAULT_TAGLINE];
  }
  const today = options.now ? options.now() : new Date();
  const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
  return filtered.length > 0 ? filtered : TAGLINES;
}

export function pickTagline(options: TaglineOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env?.OPENCLAW_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
      return pool[parsed % pool.length];
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

export { TAGLINES, HOLIDAY_RULES, DEFAULT_TAGLINE };
