// Helpers for recipe-wise trend analysis.
//
// The multi-parameter API returns one row per timestamp:
//   { dateAndTime: "YYYY-MM-DD HH:mm:ss", "<paramId>": "<value>", ... }
// with one key per selected parameter. Numeric parameters hold values like
// "7.29"; the recipe parameter holds alphanumeric codes like "CP500".

export type RecipeSegment = {
  recipe: string;
  from: number; // epoch ms of the first row in this run
  to: number;   // epoch ms of the first row of the next run (or last row)
};

export type TrendPoint = { x: number; y: number };

export const ALL_RECIPES = "ALL";

export const toEpochMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value.replace(" ", "T")).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const isBlank = (value: any) =>
  value === null || value === undefined || String(value).trim() === "";

// A recipe value is alphanumeric: it contains at least one letter.
export const isRecipeValue = (value: any) =>
  !isBlank(value) && /[A-Za-z]/.test(String(value));

// Returns the selected parameter IDs whose values are recipe codes.
export const detectRecipeParamIds = (
  apiData: any[],
  parameterIds: number[]
): number[] =>
  parameterIds.filter(paramId =>
    apiData.some(row => isRecipeValue(row[paramId]))
  );

// Sorts rows by time and keeps the last row for any repeated timestamp.
export const normaliseRows = (apiData: any[]) => {
  const byTime = new Map<number, any>();
  apiData.forEach(row => {
    const x = toEpochMs(row.dateAndTime);
    if (x !== null) byTime.set(x, row);
  });
  return Array.from(byTime.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([x, row]) => ({ x, row }));
};

// Splits the timeline into consecutive runs of the same recipe.
export const buildRecipeSegments = (
  rows: { x: number; row: any }[],
  recipeParamId: number
): RecipeSegment[] => {
  const segments: RecipeSegment[] = [];
  rows.forEach(({ x, row }) => {
    const value = row[recipeParamId];
    if (isBlank(value)) return;
    const recipe = String(value).trim();
    const last = segments[segments.length - 1];
    if (last && last.recipe === recipe) {
      last.to = x;
    } else {
      if (last) last.to = x;
      segments.push({ recipe, from: x, to: x });
    }
  });
  return segments;
};

// Recipe running at time x (binary search over the segments).
export const recipeAt = (segments: RecipeSegment[], x: number): string | null => {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (x < s.from) hi = mid - 1;
    else if (x >= s.to && mid < segments.length - 1) lo = mid + 1;
    else return s.recipe;
  }
  return null;
};

// Unique recipe codes in the order they first appear.
export const uniqueRecipes = (segments: RecipeSegment[]) =>
  Array.from(new Set(segments.map(s => s.recipe)));

// Points of one numeric parameter inside one recipe run.
export const pointsInSegment = (
  points: TrendPoint[],
  segment: RecipeSegment,
  isLastSegment: boolean
) =>
  points.filter(p =>
    p.x >= segment.from && (isLastSegment ? p.x <= segment.to : p.x < segment.to)
  );
