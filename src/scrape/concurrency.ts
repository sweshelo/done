/** プロトタイプ (done/packages/scrape) から移植 */
export async function withConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  const executing = new Set<Promise<void>>();

  for (const [i, task] of tasks.entries()) {
    const p = task().then((r) => {
      results[i] = r;
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }

  await Promise.all(executing);
  return results;
}
