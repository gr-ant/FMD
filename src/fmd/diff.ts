// A minimal line-level diff (LCS) for previewing what an edit changed — used by
// the "review AI changes" modal. Documents are small, so O(n*m) is fine.

export interface DiffLine { type: 'add' | 'del' | 'same'; text: string }
export type DiffRow = DiffLine | { type: 'gap'; count: number }

export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n'), B = b.split('\n')
  const n = A.length, m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++ }
    else { out.push({ type: 'add', text: B[j] }); j++ }
  }
  while (i < n) out.push({ type: 'del', text: A[i++] })
  while (j < m) out.push({ type: 'add', text: B[j++] })
  return out
}

// Collapse long runs of unchanged lines to a few context lines + a gap marker,
// so the preview focuses on the changes.
export function collapseDiff(lines: DiffLine[], context = 3): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'same') { rows.push(lines[i]); i++; continue }
    let j = i
    while (j < lines.length && lines[j].type === 'same') j++
    const run = j - i
    if (run > context * 2) {
      for (let k = i; k < i + context; k++) rows.push(lines[k])
      rows.push({ type: 'gap', count: run - context * 2 })
      for (let k = j - context; k < j; k++) rows.push(lines[k])
    } else {
      for (let k = i; k < j; k++) rows.push(lines[k])
    }
    i = j
  }
  return rows
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length,
  }
}
