// [Chart] visualization — the one self-contained viz domain (SVG geometry),
// carved out of viz.tsx. `[Chart -> Sales] Month / Total` with an indented
// `[Kind] bar|line|pie|donut` aggregates the value by label and draws inline SVG.
import React from 'react'
import { useSource, useRules } from '../../data'
import { formatValue, fieldType } from '../../fmd/format'
import { Empty } from './shared'
import { filterRows, useFields, resolveField } from './vizShared'
import type { VizNode, KindNode } from '../../fmd/types'

// An aggregated (label, value) point feeding a chart.
type ChartPoint = { label: string; value: number }

// A palette of accent-derived hues for pie/donut slices and the legend. Hue
// sweeps from the teal accent toward warm tones so slices stay on-theme.
const chartColor = (i: number, n: number): string =>
  `hsl(${Math.round(162 - (i / Math.max(1, n)) * 210)}, 62%, 56%)`

// A pie/donut slice path. `inner > 0` cuts a ring (donut); inner === 0 is a full
// wedge (pie). Angles are radians, clockwise from the given start.
function slicePath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const pt = (a: number, rad: number): [number, number] => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [ox0, oy0] = pt(a0, r), [ox1, oy1] = pt(a1, r)
  if (inner <= 0) return `M ${cx} ${cy} L ${ox0} ${oy0} A ${r} ${r} 0 ${large} 1 ${ox1} ${oy1} Z`
  const [ix1, iy1] = pt(a1, inner), [ix0, iy0] = pt(a0, inner)
  return `M ${ox0} ${oy0} A ${r} ${r} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
}

// A declarative chart bound to a source: `[Chart -> Sales] Month / Total` with an
// indented `[Kind] bar|line|pie|donut` (bar is the default). Reads the bound
// rows, aggregates the numeric value by the label field (summing duplicate
// labels), honors an indented `[Sort]`, and renders dependency-free inline SVG.
export function VizChart({ node }: { node: VizNode }): React.ReactNode {
  const rows = filterRows(useSource(node.source), node.filter, useRules())
  const fields = useFields(node.source)
  if (!rows) return <Empty source={node.source} />
  const [labelRef, valueRef] = (node.spec || '').split('/').map((s) => s.trim())
  const label = resolveField(fields, rows, labelRef)
  const value = resolveField(fields, rows, valueRef)

  // Aggregate the numeric value by label, summing duplicate labels.
  const order: string[] = []
  const sums = new Map<string, number>()
  rows.forEach((r) => {
    const l = label.key ? String(formatValue(r[label.key], fieldType(fields, label.key))) : ''
    const v = value.key ? Number(r[value.key]) : NaN
    if (!sums.has(l)) { sums.set(l, 0); order.push(l) }
    sums.set(l, sums.get(l) + (Number.isFinite(v) ? v : 0))
  })
  let points: ChartPoint[] = order.map((l) => ({ label: l || '—', value: sums.get(l) }))

  // An indented [Sort] orders the points — by value when it names the value
  // field, otherwise alphabetically by label.
  const sort = node.children.find((c) => c.type === 'Sort')
  if (sort && sort.type === 'Sort') {
    const dir = sort.dir === 'desc' ? -1 : 1
    const byValue = !!sort.field && resolveField(fields, rows, sort.field).key === value.key
    points = [...points].sort((a, b) =>
      byValue ? (a.value - b.value) * dir : a.label.localeCompare(b.label) * dir)
  }

  if (!points.length) return <Empty source={node.source} />

  // The chart kind from an indented [Kind]; default bar.
  const kindNode = node.children.find((c): c is KindNode => c.type === 'Kind')
  const kind = kindNode?.kind || 'bar'
  const fmt = (v: number): string => String(formatValue(v, fieldType(fields, value.key)))

  if (kind === 'pie' || kind === 'donut') {
    const total = points.reduce((a, p) => a + p.value, 0)
    const R = 92, CX = 100, CY = 100, INNER = kind === 'donut' ? 52 : 0
    let a = -Math.PI / 2
    const slices = points.map((p, i) => {
      const frac = total > 0 ? p.value / total : 0
      const a0 = a, a1 = a + frac * Math.PI * 2
      a = a1
      return { p, i, color: chartColor(i, points.length), d: slicePath(CX, CY, R, INNER, a0, a1) }
    })
    return (
      <div className="viz-chart chart-pie">
        <svg viewBox="0 0 200 200" className="chart-svg" preserveAspectRatio="xMidYMid meet" role="img">
          {total > 0
            ? slices.map((s) => <path key={s.i} d={s.d} fill={s.color} stroke="var(--panel-2)" strokeWidth={1} />)
            : <circle cx={CX} cy={CY} r={R} fill="var(--line)" />}
        </svg>
        <ul className="chart-legend">
          {points.map((p, i) => (
            <li key={i}>
              <span className="chart-swatch" style={{ background: chartColor(i, points.length) }} />
              <span className="chart-legend-label">{p.label}</span>
              <span className="chart-legend-val">{fmt(p.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ---- cartesian charts (bar, line): shared geometry ----
  const W = 360, H = 200, padX = 12, padT = 20, padB = 34
  const innerH = H - padT - padB
  const n = points.length
  const slot = (W - padX * 2) / n
  const max = Math.max(0, ...points.map((p) => p.value))
  const yOf = (v: number): number => padT + innerH - (max > 0 ? (v / max) * innerH : 0)
  const baseY = padT + innerH

  if (kind === 'line') {
    const coords = points.map((p, i) => ({ x: padX + slot * i + slot / 2, y: yOf(p.value), p }))
    const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    return (
      <div className="viz-chart chart-line">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet" role="img">
          <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} className="chart-axis" />
          <polyline points={poly} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {coords.map((c, i) => (
            <g key={i}>
              <circle cx={c.x} cy={c.y} r={3.5} fill="var(--accent-2)" />
              <text x={c.x} y={c.y - 7} className="chart-value" textAnchor="middle">{fmt(c.p.value)}</text>
              <text x={c.x} y={H - 12} className="chart-label" textAnchor="middle">{c.p.label}</text>
            </g>
          ))}
        </svg>
      </div>
    )
  }

  // bar (default): vertical bars scaled to the max value.
  const bw = Math.min(56, slot * 0.68)
  return (
    <div className="viz-chart chart-bar">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet" role="img">
        <defs>
          <linearGradient id="chart-bar-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} className="chart-axis" />
        {points.map((p, i) => {
          const x = padX + slot * i + (slot - bw) / 2
          const y = yOf(p.value)
          const h = Math.max(0, baseY - y)
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={3} fill="url(#chart-bar-grad)" />
              <text x={x + bw / 2} y={y - 5} className="chart-value" textAnchor="middle">{fmt(p.value)}</text>
              <text x={x + bw / 2} y={H - 12} className="chart-label" textAnchor="middle">{p.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
