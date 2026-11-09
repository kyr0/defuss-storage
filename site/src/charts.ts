// Chart glue: loads ECharts (only the parts used) when a chart nears the
// viewport, mounts through the defuss-shadcn chart component (token theme,
// dark mode), and rebuilds the options on control and language changes.
// ECharts takes plain strings, so chart text drops the code marks of the
// messages; the notes under the charts keep them as <code>.
// VERIFIED: (site e2e) charts render from the reports, follow the controls and
// update in place on a language switch.
import data from 'virtual:site-data';
import type { Environment } from '../build/data.ts';
import {
  chunkLabel, explorerNote, explorerOption, metricValue, optionsOption, overloadOption, rowsFor, sizesOption,
  type Adapter, type Metric,
} from './chart-options.ts';
import { currentLocale, formatNumber, onLocaleChange } from './locale.ts';
import { message, type MessageKey } from './messages.ts';
import { plainText, renderText } from './inline-code.ts';

type Option = Record<string, unknown>;
interface ChartApi { mount(el: HTMLElement, option: Option): { setOption(option: Option, notMerge?: boolean): void }; color(el: Element, token: string): string }

let runtime: Promise<ChartApi> | undefined;
/** ECharts core with bar, line and custom series and the SVG renderer the component asks for. */
export function chartApi(): Promise<ChartApi> {
  return (runtime ??= (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers'),
    ]);
    core.use([charts.BarChart, charts.LineChart, charts.CustomChart, components.GridComponent, components.TooltipComponent,
      components.LegendComponent, components.AriaComponent, renderers.SVGRenderer]);
    (globalThis as unknown as { echarts: unknown }).echarts = core;
    return (globalThis as unknown as { df$: { shadcn: { chart: ChartApi } } }).df$.shadcn.chart;
  })());
}

/** A message as a plain string, for ECharts and accessible descriptions. */
export const text = (key: string, values?: Record<string, string | number>): string => plainText(marked(key, values));
/** A message with its code marks, for renderText. */
export const marked = (key: string, values?: Record<string, string | number>): string => message(currentLocale(), key as MessageKey, values);

/** Runs `render` once `element` comes within 400 px of the viewport, then on every language switch (`still` true). */
export function whenNear(element: Element, render: (still: boolean) => void | Promise<void>): void {
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    void render(false);
    onLocaleChange(() => void render(true));
  }, { rootMargin: '400px 0px' });
  observer.observe(element);
}

/**
 * The option with its accessible name. VERIFIED: (site e2e) the shadcn chart
 * theme turns ECharts' aria module on, which writes a series dump into
 * aria-label; giving it our own description keeps the short, translated label.
 */
export const described = (option: Option, label: string): Option => ({ ...option, aria: { enabled: true, label: { description: label } } });

/** The element's translated aria-label in the language shown (defuss-i18n keeps one attribute per language). */
export const labelOf = (element: Element): string =>
  element.getAttribute(`data-i18n-aria-label-${currentLocale()}`) ?? element.getAttribute('aria-label') ?? '';

type Mounted = { setOption(option: Option, notMerge?: boolean): void };
const live = new WeakMap<HTMLElement, Mounted>();

/**
 * Draws `option` on `element`: mounts the chart once, then updates it in place.
 * `still` skips the animation, for a language switch, which changes only text.
 * VERIFIED: (site probe) remounting on a switch replayed the overload chart's
 * intro animation for about 70 frames, the same chart drawn twice.
 */
export async function showChart(element: HTMLElement, option: Option, still = false): Promise<void> {
  const api = await chartApi();
  const current = live.get(element);
  if (current) current.setOption(still ? { ...option, animation: false } : option, true);
  else live.set(element, api.mount(element, option));
}

const pressed = (group: Element): string => group.querySelector<HTMLButtonElement>('.toggle[aria-pressed="true"]')?.value ?? '';

/** Calls `listener` after a toggle in `group` changes its pressed state (click or keyboard). */
function onToggle(group: Element, listener: () => void): void {
  new MutationObserver(listener).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
}

/** The full explorer's table: every figure of the chosen runtime and adapter, as text for screen readers and copying. */
function explorerTable(table: HTMLTableElement, environment: Environment, adapter: Adapter): void {
  const body = table.tBodies[0]!;
  const cell = (value: string, header = false) => {
    const element = document.createElement(header ? 'th' : 'td');
    element.className = header ? 'table-head' : 'table-cell';
    if (header) element.setAttribute('scope', 'row');
    element.textContent = value;
    return element;
  };
  // The median, then the run-to-run range in a smaller, muted span.
  const figure = (row: Parameters<typeof metricValue>[0], metric: Metric) => {
    const value = metricValue(row, metric);
    if (metric === 'readInto') return cell(formatNumber(value.median, 2));
    const element = cell(formatNumber(value.median));
    const spread = document.createElement('span');
    spread.className = 'st-range';
    spread.textContent = ` (${formatNumber(value.min)}-${formatNumber(value.max)})`;
    element.append(spread);
    return element;
  };
  // Only the current release, as in the chart notes; the chart keeps 0.1.0 for its comparison.
  body.replaceChildren(...rowsFor(environment, adapter, '0.2.0').map(row => {
    const tr = document.createElement('tr');
    tr.className = 'table-row';
    tr.append(cell(chunkLabel(row.chunk), true), ...(['append', 'pipelined', 'stream', 'streamChecksum', 'readInto'] as const).map(metric => figure(row, metric)));
    return tr;
  }));
}

/** One explorer: runtime, operation and adapter toggles over the recorded reports. */
function initExplorer(root: HTMLElement): void {
  const chartElement = root.querySelector<HTMLElement>('[data-chart-id="explorer"]')!;
  const note = root.querySelector<HTMLElement>('[data-chart-note]')!;
  const table = root.querySelector<HTMLTableElement>('[data-explorer-table]');
  const group = (name: string) => root.querySelector<HTMLElement>(`[data-control="${name}"]`)!;
  const adapterControl = root.querySelector<HTMLElement>('[data-adapter-control]')!;

  const state = () => {
    const environment = data.environments.find(entry => entry.id === pressed(group('env'))) ?? data.environments[2]!;
    const browser = !['node', 'bun'].includes(environment.id);
    adapterControl.hidden = browser;
    const adapter = (browser ? 'opfs' : pressed(group('adapter')) || 'file') as Adapter;
    return { environment, adapter, metric: (pressed(group('metric')) || 'append') as Metric };
  };
  const render = async (still = false) => {
    const { environment, adapter, metric } = state();
    const api = await chartApi();
    const ink = api.color(chartElement, '--foreground');
    const metricName = text({ append: 'metricAppend', pipelined: 'metricPipelined', stream: 'metricStream', streamChecksum: 'metricChecksum', readInto: 'metricReads' }[metric]);
    const label = text('chartExplorer', { metric: metricName, runtime: environment.runtime, adapter: text({ file: 'adapterFile', memory: 'adapterMemory', opfs: 'adapterOpfs' }[adapter]) });
    const option = described(explorerOption(environment, adapter, metric, text, ink), label);
    await showChart(chartElement, option, still);
    renderText(note, explorerNote(environment, adapter, metric, marked, formatNumber));
    if (table) explorerTable(table, environment, adapter);
  };
  for (const name of ['env', 'metric', 'adapter']) onToggle(group(name), () => void render());
  whenNear(root, render);
}

export function initCharts(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-explorer]')) initExplorer(root);
  const simple: [string, () => Option][] = [
    ['sizes', () => sizesOption(data, text)],
    ['options', () => optionsOption(data, text)],
    ['overload', () => overloadOption(data, text)],
  ];
  for (const [id, build] of simple)
    for (const element of document.querySelectorAll<HTMLElement>(`[data-chart-id="${id}"]`)) whenNear(element, still => showChart(element, described(build(), labelOf(element)), still));
}
