import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync } from 'fs';

// ── Font registration (runs once at module load) ──────────────────────────────
// Bundle Roboto Latin via @fontsource/roboto so we're independent of whatever
// fonts the server has installed.
try {
  GlobalFonts.register(
    readFileSync(require.resolve('@fontsource/roboto/files/roboto-latin-400-normal.woff2')),
    'Roboto'
  );
  GlobalFonts.register(
    readFileSync(require.resolve('@fontsource/roboto/files/roboto-latin-700-normal.woff2')),
    'Roboto'
  );
} catch (e) {
  console.warn('[charts] Roboto font failed to load — text may render as boxes:', (e as Error).message);
}

// ── Layout ────────────────────────────────────────────────────────────────────
const CELL  = 28;
const GAP   = 4;
const STEP  = CELL + GAP;  // 32

const WEEKS = 8;
const DAYS  = 7;

const GRID_W = WEEKS * STEP;  // 256
const GRID_H = DAYS  * STEP;  // 224

const PAD       = 20;
const LABEL_W   = 44;   // left margin for day-name labels
const W         = PAD + LABEL_W + GRID_W + PAD;  // 340

const HEADER_H  = 36;   // global header row
const SEC_TITLE = 24;   // per-section title height
const WKLBL_H   = 18;   // week-date label row
const LEG_GAP   = 10;   // space between grid bottom and legend
const LEG_H     = CELL; // legend swatch height  (= 28)
const LEG_PAD   = 14;   // padding after legend to next section

const SECTION_H = SEC_TITLE + WKLBL_H + GRID_H + LEG_GAP + LEG_H + LEG_PAD;
//              = 24 + 18 + 224 + 10 + 28 + 14 = 318

const SEC_GAP = 22;     // gap between the two heatmap sections
const H = PAD + HEADER_H + SECTION_H + SEC_GAP + SECTION_H + PAD;
//      = 20 + 36 + 318 + 22 + 318 + 20 = 734

// ── Colour palettes ───────────────────────────────────────────────────────────
// Feeds: GitHub-green style (empty → dark green)
const FEED_PAL  = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
// Nappies: amber (empty → dark amber)
const NAPPY_PAL = ['#ebedf0', '#fde68a', '#fbbf24', '#d97706', '#92400e'];

const BG      = '#ffffff';
const TEXT_DK = '#24292e';
const TEXT_LT = '#8b949e';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOW_DAY   = [true, false, true, false, true, false, true];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a value to one of the 5 palette levels; always >= level 1 for non-zero. */
function colorLevel(val: number, max: number, palette: string[]): string {
  if (val === 0 || max === 0) return palette[0];
  const idx = Math.round((val / max) * (palette.length - 1));
  return palette[Math.max(1, Math.min(idx, palette.length - 1))];
}

/** Draw a filled rounded rectangle, optionally with a stroke outline. */
function roundRect(
  ctx: any,
  x: number, y: number, w: number, h: number, r: number,
  fill: string, stroke?: string
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h,     x, y + h - r,     r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y,         x + r, y,         r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = 2;
    ctx.stroke();
  }
}

// ── Public types ──────────────────────────────────────────────────────────────
export interface DayStats {
  feedMl:     number;
  nappyCount: number;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns a PNG Buffer containing two GitHub-style heatmaps stacked vertically:
 *   top    = daily ml consumed  (white → blue)
 *   bottom = daily nappy changes (white → green)
 *
 * @param data          Map of YYYY-MM-DD → DayStats
 * @param babyName      Shown in the chart header
 * @param todayDateStr  Today as 'YYYY-MM-DD' in the local timezone
 * @param tz            IANA timezone for date labels
 */
export async function generateTrendsImage(
  data:          Map<string, DayStats>,
  babyName:      string,
  todayDateStr:  string,
  tz:            string
): Promise<Buffer> {
  // ── Date grid alignment ────────────────────────────────────────────────────
  const todayDate  = new Date(todayDateStr + 'T12:00:00Z');
  const todayDow   = (todayDate.getUTCDay() + 6) % 7;   // 0 = Mon … 6 = Sun
  const thisMonday = new Date(todayDate);
  thisMonday.setUTCDate(todayDate.getUTCDate() - todayDow);

  // col 0 = Monday of the oldest displayed week
  const gridStart = new Date(thisMonday);
  gridStart.setUTCDate(thisMonday.getUTCDate() - (WEEKS - 1) * 7);

  const cellDs = (col: number, row: number): string => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + col * 7 + row);
    return d.toISOString().slice(0, 10);
  };
  const cellDt = (col: number, row: number): Date => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + col * 7 + row);
    return d;
  };

  // ── Scale maxima ───────────────────────────────────────────────────────────
  let maxMl = 0, maxNappy = 0;
  for (const v of data.values()) {
    if (v.feedMl     > maxMl)    maxMl    = v.feedMl;
    if (v.nappyCount > maxNappy) maxNappy = v.nappyCount;
  }

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d') as any;

  // Background
  roundRect(ctx, 0, 0, W, H, 10, BG);

  const x0 = PAD + LABEL_W;  // left edge of grid column 0

  // Global header
  ctx.fillStyle = TEXT_DK;
  ctx.font      = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.fillText(`${babyName}’s activity — last ${WEEKS} weeks`, PAD, PAD + 22);

  // ── Per-section renderer ───────────────────────────────────────────────────
  function renderSection(
    sY:       number,
    title:    string,
    getValue: (s: DayStats) => number,
    maxVal:   number,
    palette:  string[],
    unit:     string   // 'ml' for feeds, '' for counts
  ) {
    const gridY = sY + SEC_TITLE + WKLBL_H;

    // Section title
    ctx.font      = 'bold 12px Roboto';
    ctx.fillStyle = TEXT_DK;
    ctx.textAlign = 'left';
    ctx.fillText(title, PAD, sY + 16);

    // Week-start date labels (every other column to avoid crowding)
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    for (let col = 0; col < WEEKS; col += 2) {
      const lbl = cellDt(col, 0).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', timeZone: tz,
      });
      ctx.textAlign = 'left';
      ctx.fillText(lbl, x0 + col * STEP, sY + SEC_TITLE + 12);
    }

    // Grid rows
    for (let row = 0; row < DAYS; row++) {
      // Day-name label on the left (Mon / Wed / Fri / Sun)
      if (SHOW_DAY[row]) {
        ctx.font      = '9px Roboto';
        ctx.fillStyle = TEXT_LT;
        ctx.textAlign = 'right';
        ctx.fillText(DAY_LABELS[row], x0 - 6, gridY + row * STEP + CELL - 7);
      }

      // Heatmap cells
      for (let col = 0; col < WEEKS; col++) {
        const ds = cellDs(col, row);
        if (ds > todayDateStr) continue;   // no future cells

        const v     = data.get(ds);
        const val   = v ? getValue(v) : 0;
        const fill  = colorLevel(val, maxVal, palette);
        const cx    = x0 + col * STEP;
        const cy    = gridY + row * STEP;
        const today = ds === todayDateStr ? TEXT_DK : undefined;
        roundRect(ctx, cx, cy, CELL, CELL, 4, fill, today);
      }
    }

    // Colour legend — swatches with scale values below each
    const legY = gridY + GRID_H + LEG_GAP;

    for (let i = 0; i < palette.length; i++) {
      const sx = x0 + i * (CELL + 3);
      roundRect(ctx, sx, legY, CELL, CELL, 3, palette[i]);

      // Value label centred below swatch
      const val = maxVal > 0 ? Math.round((i / (palette.length - 1)) * maxVal) : 0;
      const lbl = i === 0 ? '0' : `${val}${unit}`;
      ctx.font      = '8px Roboto';
      ctx.fillStyle = TEXT_LT;
      ctx.textAlign = 'center';
      ctx.fillText(lbl, sx + CELL / 2, legY + CELL + 10);
    }
  }

  const sec1Y = PAD + HEADER_H;
  const sec2Y = sec1Y + SECTION_H + SEC_GAP;

  renderSection(
    sec1Y,
    'Feeds  (ml / day)',
    v => v.feedMl, maxMl, FEED_PAL, 'ml'
  );
  renderSection(
    sec2Y,
    'Nappies  (changes / day)',
    v => v.nappyCount, maxNappy, NAPPY_PAL, ''
  );

  return canvas.toBuffer('image/png');
}

// ── Feed vs Sleep correlation chart ──────────────────────────────────────────

export interface FeedSleepDay {
  feedCount:     number;
  avgSleepHours: number | null;
}

const FS_DAYS    = 14;
const FS_BAR_W   = 12;
const FS_CHART_H = 100;
const FS_TITLE_H = 20;
const FS_XLBL_H  = 22;
const FS_SEC_H   = FS_TITLE_H + FS_CHART_H + FS_XLBL_H;  // 142
const FS_SEC_GAP = 16;
const FS_H       = PAD + HEADER_H + FS_SEC_H + FS_SEC_GAP + FS_SEC_H + PAD;  // 376

const FS_LPAD    = 36;
const FS_X0      = PAD + FS_LPAD;                         // 56
const FS_CHART_W = W - PAD - FS_LPAD - PAD;               // 264
const FS_BSTEP   = Math.floor(FS_CHART_W / FS_DAYS);      // 18

const BAR_FEED   = '#5b8dee';
const BAR_SLEEP  = '#ff9a3c';
const BAR_EMPTY  = '#edebe6';
const GRID_LINE  = '#f0ede8';
const AXIS_LINE  = '#d0cdc8';

/**
 * Returns a PNG Buffer with two stacked bar charts for the last 14 days:
 *   top    = feeds per day  (blue bars)
 *   bottom = avg sleep between feeds in hours  (orange bars)
 */
export async function generateFeedSleepChart(
  data:         Map<string, FeedSleepDay>,
  babyName:     string,
  fromDateStr:  string,
  todayDateStr: string,
): Promise<Buffer> {
  const canvas = createCanvas(W, FS_H);
  const ctx    = canvas.getContext('2d') as any;

  roundRect(ctx, 0, 0, W, FS_H, 10, BG);

  ctx.fillStyle = TEXT_DK;
  ctx.font      = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.fillText(`${babyName}'s feed & sleep — last ${FS_DAYS} days`, PAD, PAD + 22);

  // Build ordered date list for the window
  const dates: string[] = [];
  {
    let d = new Date(fromDateStr + 'T12:00:00Z');
    const end = new Date(todayDateStr + 'T12:00:00Z');
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86_400_000);
    }
  }

  let maxFeeds = 1, maxSleep = 0.1;
  for (const v of data.values()) {
    if (v.feedCount > maxFeeds) maxFeeds = v.feedCount;
    if (v.avgSleepHours !== null && v.avgSleepHours > maxSleep) maxSleep = v.avgSleepHours;
  }

  function renderSection(
    sY:       number,
    title:    string,
    barColor: string,
    getValue: (d: FeedSleepDay) => number | null,
    maxVal:   number,
    yTopLbl:  string,
  ) {
    const chartTop = sY + FS_TITLE_H;
    const chartBot = chartTop + FS_CHART_H;

    ctx.font      = 'bold 12px Roboto';
    ctx.fillStyle = TEXT_DK;
    ctx.textAlign = 'left';
    ctx.fillText(title, PAD, sY + 14);

    // Horizontal gridlines at 50% and 100%
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth   = 1;
    for (const frac of [0.5, 1.0]) {
      const gy = chartBot - Math.round(frac * FS_CHART_H);
      ctx.beginPath();
      ctx.moveTo(FS_X0, gy);
      ctx.lineTo(FS_X0 + FS_CHART_W, gy);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'right';
    ctx.fillText('0',     FS_X0 - 4, chartBot + 3);
    ctx.fillText(yTopLbl, FS_X0 - 4, chartTop  + 5);

    // Bars + x-axis labels
    for (let i = 0; i < dates.length; i++) {
      const day   = dates[i];
      const stats = data.get(day);
      const val   = stats ? getValue(stats) : null;
      const bx    = FS_X0 + i * FS_BSTEP + Math.floor((FS_BSTEP - FS_BAR_W) / 2);

      if (val === null || val === 0) {
        roundRect(ctx, bx, chartBot - 4, FS_BAR_W, 4, 1, BAR_EMPTY);
      } else {
        const barH = Math.max(4, Math.round((val / maxVal) * FS_CHART_H));
        roundRect(ctx, bx, chartBot - barH, FS_BAR_W, barH, 2, barColor);
      }

      // Date label every 2 bars
      if (i % 2 === 0) {
        const dt  = new Date(day + 'T12:00:00Z');
        const lbl = `${dt.getUTCDate()} ${dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
        ctx.font      = '8px Roboto';
        ctx.fillStyle = TEXT_LT;
        ctx.textAlign = 'center';
        ctx.fillText(lbl, bx + FS_BAR_W / 2, chartBot + 14);
      }
    }

    // Bottom axis line
    ctx.strokeStyle = AXIS_LINE;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(FS_X0, chartBot);
    ctx.lineTo(FS_X0 + FS_CHART_W, chartBot);
    ctx.stroke();
  }

  const sec1Y = PAD + HEADER_H;
  const sec2Y = sec1Y + FS_SEC_H + FS_SEC_GAP;

  renderSection(sec1Y, 'Feeds per day',                    BAR_FEED,
    v => v.feedCount,     maxFeeds, String(maxFeeds));
  renderSection(sec2Y, 'Avg sleep between feeds (hours)',  BAR_SLEEP,
    v => v.avgSleepHours, maxSleep, maxSleep.toFixed(1) + 'h');

  return canvas.toBuffer('image/png');
}

// ── ml vs Sleep scatter + trend line ─────────────────────────────────────────

export interface MlSleepPoint {
  ml:     number;
  sleepH: number;
}

const SC_LPAD    = 40;                        // wider left margin for "Xh" labels
const SC_X0      = PAD + SC_LPAD;             // 60
const SC_CHART_W = W - PAD - SC_LPAD - PAD;  // 260
const SC_CHART_H = 180;
const SC_SUB_H   = 16;   // subtitle line height
const SC_XAXIS_H = 28;   // x-axis label area
const SC_NOTE_H  = 18;   // footnote
const SC_H       = PAD + HEADER_H + SC_SUB_H + SC_CHART_H + SC_XAXIS_H + SC_NOTE_H + PAD;
//                = 20 + 36 + 16 + 180 + 28 + 18 + 20 = 318

const DOT_R       = 4;
const DOT_COLOR   = 'rgba(156, 106, 222, 0.65)';
const TREND_COLOR = '#e05252';

/**
 * Returns a PNG Buffer: scatter plot of feed ml vs hours slept after,
 * with a linear regression trend line overlaid.
 */
export async function generateMlSleepChart(
  points:   MlSleepPoint[],
  babyName: string,
  days:     number,
): Promise<Buffer> {
  const canvas = createCanvas(W, SC_H);
  const ctx    = canvas.getContext('2d') as any;

  roundRect(ctx, 0, 0, W, SC_H, 10, BG);

  // Header
  ctx.fillStyle = TEXT_DK;
  ctx.font      = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.fillText(`${babyName}'s milk vs sleep`, PAD, PAD + 22);

  // Subtitle
  ctx.font      = '9px Roboto';
  ctx.fillStyle = TEXT_LT;
  ctx.fillText('Each dot = one feed · red line = trend', PAD, PAD + HEADER_H + 11);

  const chartY0  = PAD + HEADER_H + SC_SUB_H;
  const chartBot = chartY0 + SC_CHART_H;

  if (points.length < 2) {
    ctx.font      = '11px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data yet — log more feeds', SC_X0 + SC_CHART_W / 2, chartY0 + SC_CHART_H / 2);
    return canvas.toBuffer('image/png');
  }

  // Axis ranges
  const mlValues = points.map(p => p.ml);
  const minMl    = Math.min(...mlValues);
  const maxMl    = Math.max(...mlValues);
  const mlPad    = Math.max(8, (maxMl - minMl) * 0.12) || 10;
  const xMin     = minMl - mlPad;
  const xMax     = maxMl + mlPad;

  const maxSleep = Math.max(...points.map(p => p.sleepH));
  const yMax     = Math.max(maxSleep * 1.15, 1);

  const toCanvasX = (ml: number)     => SC_X0 + (ml - xMin) / (xMax - xMin) * SC_CHART_W;
  const toCanvasY = (sleepH: number) => chartBot - Math.min(sleepH, yMax) / yMax * SC_CHART_H;

  // Horizontal gridlines at each whole hour
  const yTickMax = Math.ceil(yMax);
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth   = 1;
  for (let h = 0; h <= yTickMax; h++) {
    if (h > yMax) break;
    const gy = toCanvasY(h);
    ctx.beginPath();
    ctx.moveTo(SC_X0, gy);
    ctx.lineTo(SC_X0 + SC_CHART_W, gy);
    ctx.stroke();
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'right';
    ctx.fillText(`${h}h`, SC_X0 - 4, gy + 4);
  }

  // X-axis ticks at evenly-spaced round intervals (not every distinct value)
  const dataRange    = maxMl - minMl;
  const tickInterval = dataRange <= 30 ? 10 : dataRange <= 80 ? 20 : dataRange <= 150 ? 25 : 50;
  const firstTick    = Math.ceil(minMl / tickInterval) * tickInterval;
  const xTicks: number[] = [];
  for (let t = firstTick; t <= maxMl; t += tickInterval) xTicks.push(t);

  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth   = 1;
  for (const ml of xTicks) {
    const cx = toCanvasX(ml);
    ctx.beginPath();
    ctx.moveTo(cx, chartBot);
    ctx.lineTo(cx, chartBot + 4);
    ctx.stroke();
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'center';
    ctx.fillText(`${ml}ml`, cx, chartBot + 16);
  }

  // Axes
  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(SC_X0, chartBot);
  ctx.lineTo(SC_X0 + SC_CHART_W, chartBot);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(SC_X0, chartY0);
  ctx.lineTo(SC_X0, chartBot);
  ctx.stroke();

  // Linear regression
  const n     = points.length;
  const sumX  = points.reduce((s, p) => s + p.ml, 0);
  const sumY  = points.reduce((s, p) => s + p.sleepH, 0);
  const sumXY = points.reduce((s, p) => s + p.ml * p.sleepH, 0);
  const sumXX = points.reduce((s, p) => s + p.ml * p.ml, 0);
  const denom = n * sumXX - sumX * sumX;

  if (denom !== 0) {
    const slope     = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const clamp     = (v: number) => Math.max(0, Math.min(yMax, v));
    ctx.strokeStyle = TREND_COLOR;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(xMin), toCanvasY(clamp(slope * xMin + intercept)));
    ctx.lineTo(toCanvasX(xMax), toCanvasY(clamp(slope * xMax + intercept)));
    ctx.stroke();
  }

  // Scatter dots (on top of trend line)
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(toCanvasX(p.ml), toCanvasY(p.sleepH), DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = DOT_COLOR;
    ctx.fill();
  }

  // Footnote
  ctx.font      = '8px Roboto';
  ctx.fillStyle = TEXT_LT;
  ctx.textAlign = 'left';
  ctx.fillText(`${n} feed→sleep pairs · last ${days} days`, PAD, chartBot + SC_XAXIS_H + SC_NOTE_H - 2);

  return canvas.toBuffer('image/png');
}

// ── Feed timing dot plot ───────────────────────────────────────────────────────

const TM_ROWS    = 14;
const TM_ROW_H   = 20;
const TM_DOT_R   = 4;
const TM_LLABEL  = 46;                              // left label width
const TM_X0      = PAD + TM_LLABEL;                 // 66
const TM_CHART_W = W - PAD - TM_LLABEL - PAD;       // 254
const TM_CHART_H = TM_ROWS * TM_ROW_H;              // 280
const TM_XAXIS_H = 22;
const TM_H       = PAD + HEADER_H + TM_CHART_H + TM_XAXIS_H + PAD;  // 378

const TM_DOT  = 'rgba(34, 197, 158, 0.75)';
const TM_GRID = '#ede9e4';

/**
 * Returns a PNG Buffer: dot plot showing feed times across the last 14 days.
 * Each row = one day (newest at top). Each dot = one feed at its local time.
 */
export async function generateFeedTimingChart(
  data:         Map<string, number[]>,   // YYYY-MM-DD → [hours since midnight]
  babyName:     string,
  fromDateStr:  string,
  todayDateStr: string,
): Promise<Buffer> {
  const canvas = createCanvas(W, TM_H);
  const ctx    = canvas.getContext('2d') as any;

  roundRect(ctx, 0, 0, W, TM_H, 10, BG);

  ctx.fillStyle = TEXT_DK;
  ctx.font      = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.fillText(`${babyName}'s feed timing — last ${TM_ROWS} days`, PAD, PAD + 22);

  // Build date list newest-first
  const dates: string[] = [];
  {
    let d = new Date(todayDateStr + 'T12:00:00Z');
    const start = new Date(fromDateStr + 'T12:00:00Z');
    while (d >= start) {
      dates.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() - 86_400_000);
    }
  }

  const chartY0 = PAD + HEADER_H;
  const toX = (h: number) => TM_X0 + (h / 24) * TM_CHART_W;

  // Vertical time guides at 6h, 12h, 18h
  for (const h of [6, 12, 18]) {
    const gx = toX(h);
    ctx.strokeStyle = h === 12 ? '#d8d4cf' : TM_GRID;
    ctx.lineWidth   = 1;
    ctx.setLineDash(h === 12 ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx, chartY0);
    ctx.lineTo(gx, chartY0 + TM_CHART_H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Rows
  for (let i = 0; i < dates.length; i++) {
    const day  = dates[i];
    const rowY = chartY0 + i * TM_ROW_H;
    const midY = rowY + TM_ROW_H / 2;

    // Subtle alternating band
    if (i % 2 === 0) {
      ctx.fillStyle = '#fafaf8';
      ctx.fillRect(TM_X0, rowY, TM_CHART_W, TM_ROW_H);
    }

    // Day label: "Mon 4" style
    const dt  = new Date(day + 'T12:00:00Z');
    const lbl = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'right';
    ctx.fillText(lbl, TM_X0 - 5, midY + 4);

    // Feed dots
    for (const t of (data.get(day) ?? [])) {
      ctx.beginPath();
      ctx.arc(toX(t), midY, TM_DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = TM_DOT;
      ctx.fill();
    }
  }

  // Bottom axis line
  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(TM_X0, chartY0 + TM_CHART_H);
  ctx.lineTo(TM_X0 + TM_CHART_W, chartY0 + TM_CHART_H);
  ctx.stroke();

  // X-axis time labels
  const xlabels = [
    { h: 0,  lbl: '12am', align: 'left'   },
    { h: 6,  lbl: '6am',  align: 'center' },
    { h: 12, lbl: '12pm', align: 'center' },
    { h: 18, lbl: '6pm',  align: 'center' },
    { h: 24, lbl: '12am', align: 'right'  },
  ] as const;
  ctx.font      = '9px Roboto';
  ctx.fillStyle = TEXT_LT;
  for (const { h, lbl, align } of xlabels) {
    ctx.textAlign = align;
    ctx.fillText(lbl, toX(h), chartY0 + TM_CHART_H + 15);
  }

  return canvas.toBuffer('image/png');
}

// ── Wake window scatter plot ──────────────────────────────────────────────────

export interface WakeWindowPoint {
  day:       string;  // YYYY-MM-DD in local tz of the wake event
  durationH: number;  // hours awake (wake → sleep)
}

const WW_ROWS    = 14;
const WW_LPAD    = 36;
const WW_X0      = PAD + WW_LPAD;
const WW_CHART_W = W - PAD - WW_LPAD - PAD;
const WW_CHART_H = 160;
const WW_XAXIS_H = 22;
const WW_NOTE_H  = 18;
const WW_H       = PAD + HEADER_H + WW_CHART_H + WW_XAXIS_H + WW_NOTE_H + PAD;

const WW_DOT_R = 4;
const WW_DOT   = 'rgba(251, 113, 133, 0.75)';

/**
 * Returns a PNG Buffer: scatter plot of wake window durations over the last 14 days.
 * Each dot = one wake→sleep period; x = date, y = hours awake.
 */
export async function generateWakeWindowChart(
  points:       WakeWindowPoint[],
  babyName:     string,
  fromDateStr:  string,
  todayDateStr: string,
): Promise<Buffer> {
  const canvas = createCanvas(W, WW_H);
  const ctx    = canvas.getContext('2d') as any;

  roundRect(ctx, 0, 0, W, WW_H, 10, BG);

  ctx.fillStyle = TEXT_DK;
  ctx.font      = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.fillText(`${babyName}'s wake windows — last ${WW_ROWS} days`, PAD, PAD + 22);

  const dates: string[] = [];
  {
    let d = new Date(fromDateStr + 'T12:00:00Z');
    const end = new Date(todayDateStr + 'T12:00:00Z');
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86_400_000);
    }
  }

  const chartY0  = PAD + HEADER_H;
  const chartBot = chartY0 + WW_CHART_H;

  if (points.length < 2) {
    ctx.font      = '11px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'center';
    ctx.fillText('Log \u{1F634} Asleep and \u{1F476} Awake to see wake windows here', WW_X0 + WW_CHART_W / 2, chartY0 + WW_CHART_H / 2);
    return canvas.toBuffer('image/png');
  }

  const maxH  = Math.max(...points.map(p => p.durationH), 1);
  const yMax  = Math.max(maxH * 1.15, 1);
  const bstep = Math.floor(WW_CHART_W / dates.length);
  const toX   = (i: number) => WW_X0 + i * bstep + bstep / 2;
  const toY   = (h: number) => chartBot - Math.min(h, yMax) / yMax * WW_CHART_H;

  // Y gridlines at whole hours
  const yTickMax = Math.ceil(yMax);
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth   = 1;
  for (let h = 0; h <= yTickMax; h++) {
    if (h > yMax) break;
    const gy = toY(h);
    ctx.beginPath();
    ctx.moveTo(WW_X0, gy);
    ctx.lineTo(WW_X0 + WW_CHART_W, gy);
    ctx.stroke();
    ctx.font      = '9px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'right';
    ctx.fillText(`${h}h`, WW_X0 - 4, gy + 4);
  }

  // Dots
  for (const pt of points) {
    const i = dates.indexOf(pt.day);
    if (i < 0) continue;
    ctx.beginPath();
    ctx.arc(toX(i), toY(pt.durationH), WW_DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = WW_DOT;
    ctx.fill();
  }

  // Bottom axis
  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(WW_X0, chartBot);
  ctx.lineTo(WW_X0 + WW_CHART_W, chartBot);
  ctx.stroke();

  // X-axis labels every 2 columns
  for (let i = 0; i < dates.length; i++) {
    if (i % 2 !== 0) continue;
    const dt  = new Date(dates[i] + 'T12:00:00Z');
    const lbl = `${dt.getUTCDate()} ${dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
    ctx.font      = '8px Roboto';
    ctx.fillStyle = TEXT_LT;
    ctx.textAlign = 'center';
    ctx.fillText(lbl, toX(i), chartBot + 14);
  }

  // Footnote
  ctx.font      = '8px Roboto';
  ctx.fillStyle = TEXT_LT;
  ctx.textAlign = 'left';
  ctx.fillText(`${points.length} wake window${points.length !== 1 ? 's' : ''} · last ${WW_ROWS} days`, PAD, chartBot + WW_XAXIS_H + WW_NOTE_H - 2);

  return canvas.toBuffer('image/png');
}
