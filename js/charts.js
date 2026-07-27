/**
 * Grafy (Chart.js, vendorovaný v vendor/chart.umd.min.js).
 *
 * Držená pravidla:
 *  - jedna osa Y na graf (nikdy dvě různá měřítka)
 *  - tenké značky, vlasové solidní gridlines, vzdušné odsazení
 *  - legenda vždy u ≥ 2 řad, přímé popisky jen výběrově (koncový bod u ≤ 4 řad)
 *  - 2px mezera v barvě plochy mezi segmenty stacked barů
 *  - tooltip hodnotu nikdy negatuje – všechno je i v tabulce pod grafem
 */

import { DASH_PATTERNS, ordinalSteps, playerColor, playerLineStyle } from './palette.js';
import { num, signed, percent, tournament, tournamentLong } from './format.js';

const { Chart } = window;

/** Popisek poslední hodnoty přímo v grafu – jen když je řad málo. */
const endpointLabels = {
  id: 'endpointLabels',
  defaults: { enabled: false },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled) return; // zapíná se jen u spojnicového grafu
    const visible = chart.data.datasets.filter((_, i) => chart.isDatasetVisible(i));
    if (!visible.length || visible.length > 4) return;

    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 12px ${opts.font}`;
    ctx.textBaseline = 'middle';

    const placed = [];
    chart.data.datasets.forEach((dataset, i) => {
      if (!chart.isDatasetVisible(i)) return;
      const meta = chart.getDatasetMeta(i);
      const lastIndex = [...dataset.data].reduce((acc, v, idx) => (v === null ? acc : idx), -1);
      if (lastIndex < 0 || !meta.data[lastIndex]) return;

      const point = meta.data[lastIndex];
      let y = point.y;
      // hrubé odstrčení, ať se popisky nepřekrývají
      while (placed.some((p) => Math.abs(p - y) < 14)) y -= 14;
      placed.push(y);

      const label = dataset.label;
      // popisek se vejde do pravého paddingu vedle plochy grafu
      const x = Math.min(point.x + 8, chart.width - ctx.measureText(label).width - 4);
      ctx.fillStyle = opts.textColor;
      ctx.fillText(label, x, y);
    });
    ctx.restore();
  },
};

Chart.register(endpointLabels);

function baseOptions(palette) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // bez animace: u stovek bodů nic nepřináší a graf je hned čitelný
    animation: false,
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: palette.textSecondary,
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: 'rectRounded',
          padding: 14,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: palette.surface,
        borderColor: palette.axis,
        borderWidth: 1,
        titleColor: palette.textPrimary,
        bodyColor: palette.textSecondary,
        padding: 10,
        boxWidth: 8,
        boxHeight: 8,
        usePointStyle: true,
        cornerRadius: 8,
        displayColors: true,
      },
    },
  };
}

function axisStyle(palette, { grid = true } = {}) {
  return {
    grid: {
      display: grid,
      color: palette.grid,
      drawTicks: false,
      // vlasová plná linka, nikdy čárkovaná
      lineWidth: 1,
    },
    border: { color: palette.axis, width: 1 },
    ticks: { color: palette.textMuted, font: { size: 11 }, padding: 8 },
  };
}

/* ── kumulativní vývoj ────────────────────────────────────────────────── */

export function trendChart(canvas, { labels, series, metric, styles, palette }) {
  const options = baseOptions(palette);
  const isProfit = metric === 'profit';

  return new Chart(canvas, {
    type: 'line',
    data: {
      // na osu jen datum – číslo turnaje v rámci dne by tu při stovkách bodů
      // jen šumělo, v tooltipu je k dispozici celé
      labels: labels.map((label) => tournament(label, { short: true, withSeq: false })),
      datasets: series.map((s) => {
        const color = playerColor(styles, s.name, palette);
        return {
          label: s.name,
          data: s.data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          borderDash: DASH_PATTERNS[playerLineStyle(styles, s.name)],
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: palette.surface,
          tension: 0.15,
          spanGaps: true,
        };
      }),
    },
    options: {
      ...options,
      layout: { padding: { right: 64, top: 4 } },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      scales: {
        x: {
          ...axisStyle(palette, { grid: false }),
          ticks: {
            ...axisStyle(palette).ticks,
            maxRotation: 0,
            autoSkipPadding: 24,
          },
        },
        y: {
          ...axisStyle(palette),
          title: {
            display: true,
            text: isProfit ? 'Kumulativní profit' : 'Kumulativní body',
            color: palette.textMuted,
            font: { size: 11 },
          },
          ticks: { ...axisStyle(palette).ticks, callback: (v) => num(v) },
        },
      },
      plugins: {
        ...options.plugins,
        legend: {
          ...options.plugins.legend,
          labels: {
            ...options.plugins.legend.labels,
            // hráči nad 8. slot mají stejný odstín + jiný vzor čáry; v legendě
            // to odlišíme obrysovým (nevyplněným) čtverečkem, ať identita
            // nestojí jen na barvě
            generateLabels: (chart) =>
              chart.data.datasets.map((dataset, index) => {
                const patterned = (dataset.borderDash ?? []).length > 0;
                return {
                  text: dataset.label,
                  fillStyle: patterned ? 'transparent' : dataset.borderColor,
                  strokeStyle: dataset.borderColor,
                  lineWidth: patterned ? 2 : 0,
                  lineDash: dataset.borderDash ?? [],
                  pointStyle: 'rectRounded',
                  hidden: !chart.isDatasetVisible(index),
                  datasetIndex: index,
                  fontColor: palette.textSecondary,
                };
              }),
          },
        },
        endpointLabels: { enabled: true, textColor: palette.textSecondary, font: options.font.family },
        tooltip: {
          ...options.plugins.tooltip,
          itemSort: (a, b) => (b.raw ?? -Infinity) - (a.raw ?? -Infinity),
          callbacks: {
            title: (items) => tournamentLong(labels[items[0].dataIndex]),
            label: (item) =>
              `${item.dataset.label}: ${isProfit ? signed(item.raw) : num(item.raw)}`,
          },
        },
      },
    },
  });
}

/* ── distribuce umístění ──────────────────────────────────────────────── */

/**
 * Umístění je ordinální kategorie → jednohuová modrá řada.
 * Nad 7 tříd se ocas slučuje do „7.+“ (v tabulce zůstává plný rozpad).
 */
export function finishBuckets(maxFinish) {
  const MAX_CLASSES = 7;
  if (maxFinish <= MAX_CLASSES) {
    return Array.from({ length: maxFinish }, (_, i) => ({
      label: `${i + 1}.`,
      positions: [i + 1],
    }));
  }
  const buckets = Array.from({ length: MAX_CLASSES - 1 }, (_, i) => ({
    label: `${i + 1}.`,
    positions: [i + 1],
  }));
  const tail = [];
  for (let p = MAX_CLASSES; p <= maxFinish; p += 1) tail.push(p);
  buckets.push({ label: `${MAX_CLASSES}.+`, positions: tail });
  return buckets;
}

export function finishChart(canvas, { rows, maxFinish, mode, palette }) {
  const buckets = finishBuckets(maxFinish);
  const colors = ordinalSteps(buckets.length, palette);
  const relative = mode === 'relative';
  const options = baseOptions(palette);

  const datasets = buckets.map((bucket, bucketIndex) => ({
    label: bucket.label,
    data: rows.map((row) => {
      const count = bucket.positions.reduce((sum, pos) => sum + (row.counts[pos - 1] ?? 0), 0);
      return relative ? (row.games ? (count / row.games) * 100 : 0) : count;
    }),
    // absolutní počty držíme pro tooltip i v relativním režimu
    rawCounts: rows.map((row) =>
      bucket.positions.reduce((sum, pos) => sum + (row.counts[pos - 1] ?? 0), 0)
    ),
    backgroundColor: colors[bucketIndex],
    borderColor: palette.surface,
    borderWidth: { top: 0, bottom: 0, left: 0, right: 2 },
    borderSkipped: false,
    borderRadius: bucketIndex === buckets.length - 1 ? 4 : 0,
    maxBarThickness: 26,
  }));

  return new Chart(canvas, {
    type: 'bar',
    data: { labels: rows.map((r) => r.name), datasets },
    options: {
      ...options,
      indexAxis: 'y',
      layout: { padding: { right: 12 } },
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: {
          ...axisStyle(palette),
          stacked: true,
          beginAtZero: true,
          max: relative ? 100 : undefined,
          title: {
            display: true,
            text: relative ? '% z odehraných turnajů hráče' : 'počet turnajů',
            color: palette.textMuted,
            font: { size: 11 },
          },
          ticks: {
            ...axisStyle(palette).ticks,
            callback: (v) => (relative ? `${v} %` : num(v)),
          },
        },
        y: {
          ...axisStyle(palette, { grid: false }),
          stacked: true,
        },
      },
      plugins: {
        ...options.plugins,
        tooltip: {
          ...options.plugins.tooltip,
          callbacks: {
            title: (items) => `${items[0].label} · ${rows[items[0].dataIndex].games} turnajů`,
            label: (item) => {
              const count = item.dataset.rawCounts[item.dataIndex];
              const games = rows[item.dataIndex].games;
              const share = games ? (count / games) * 100 : 0;
              return `${item.dataset.label} místo: ${num(count)}× (${percent(share, 1)})`;
            },
          },
          filter: (item) => (item.dataset.rawCounts[item.dataIndex] ?? 0) > 0,
        },
      },
    },
  });
}

/* ── kredit ───────────────────────────────────────────────────────────── */

export function kreditChart(canvas, { players, palette }) {
  const options = baseOptions(palette);

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: players.map((p) => p.name),
      datasets: [
        {
          label: 'Zůstatek',
          data: players.map((p) => p.balance),
          // polarita kolem nuly: modrá = plus, červená = minus
          backgroundColor: players.map((p) => (p.balance < 0 ? palette.negative : palette.positive)),
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      ...options,
      indexAxis: 'y',
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: {
          ...axisStyle(palette),
          title: {
            display: true,
            text: 'zůstatek kreditu',
            color: palette.textMuted,
            font: { size: 11 },
          },
          ticks: { ...axisStyle(palette).ticks, callback: (v) => signed(v) },
        },
        y: axisStyle(palette, { grid: false }),
      },
      plugins: {
        ...options.plugins,
        // jedna řada → legenda by jen šuměla, název nese titulek karty
        legend: { display: false },
        tooltip: {
          ...options.plugins.tooltip,
          callbacks: {
            label: (item) => `Zůstatek: ${signed(item.raw)}`,
          },
        },
      },
    },
  });
}
