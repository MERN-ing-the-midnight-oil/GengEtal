function normalizePrompt(prompt) {
  return String(prompt || '').trim().toLowerCase();
}

/**
 * Group jobs that share at least one prompt (case-insensitive).
 * Connected via shared prompts (union-find). Within and across groups,
 * order is newest-first by created_at.
 */
export function groupJobsBySharedPrompts(jobs) {
  if (!jobs?.length) return [];

  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const job of jobs) parent.set(job.id, job.id);

  const byPrompt = new Map();
  for (const job of jobs) {
    for (const prompt of [job.prompt_1, job.prompt_2]) {
      const key = normalizePrompt(prompt);
      if (!key) continue;
      if (!byPrompt.has(key)) byPrompt.set(key, []);
      byPrompt.get(key).push(job.id);
    }
  }

  for (const ids of byPrompt.values()) {
    for (let i = 1; i < ids.length; i += 1) {
      union(ids[0], ids[i]);
    }
  }

  const groups = new Map();
  for (const job of jobs) {
    const root = find(job.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(job);
  }

  const byNewest = (a, b) => (b.created_at || '').localeCompare(a.created_at || '');

  return [...groups.values()]
    .map((group) => [...group].sort(byNewest))
    .sort((a, b) => byNewest(a[0], b[0]));
}
