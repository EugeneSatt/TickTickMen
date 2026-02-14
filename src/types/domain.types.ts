export const REASON_CODES = [
  "NO_CLARITY",
  "BIG_TASK",
  "FEAR_CONSEQUENCES",
  "SLEEP",
  "FATIGUE",
  "SOCIAL_ANXIETY",
  "CONTEXT_SWITCH",
  "OVERLOAD",
  "OTHER",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type PlanSuggestionCategory = "GROWTH" | "MONEY" | "SYSTEM" | "LIFE";

export const moodToInt = (mood: "M2" | "M1" | "Z0" | "P1" | "P2"): number => {
  switch (mood) {
    case "M2":
      return -2;
    case "M1":
      return -1;
    case "Z0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    default:
      return 0;
  }
};
