import type { Visual } from "./companion.ts";

// Only bounded, structured text reaches React. Never evaluate model markup.
export function safeDiagram(value: Visual | unknown): Visual | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Visual;
  if (!["flowchart","tree","graph","concept_map","sequence","comparison"].includes(v.kind) ||
      typeof v.title !== "string" || !v.title.trim() || v.title.length > 160 ||
      !Array.isArray(v.nodes) || v.nodes.length < 2 || v.nodes.length > 12) return null;
  const ids = new Set<string>();
  const nodes = [];
  for (const [index, node] of v.nodes.entries()) {
    if (!node || typeof node !== "object") return null;
    const id = node.id || `n${index+1}`;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(id)) return null;
    for (const [text, max] of [[node.label,80],[node.detail,400],[node.quote,1600],[node.source_id,100]] as const)
      if (typeof text !== "string" || !text.trim() || text.length > max) return null;
    if (node.quote.trim().length < 8 || !/[\p{L}\p{N}]/u.test(node.quote)) return null;
    if (node.role && !["concept","decision","example","outcome"].includes(node.role)) return null;
    ids.add(id); nodes.push({...node,id});
  }
  if (v.summary !== undefined && (typeof v.summary !== "string" || v.summary.length > 800)) return null;
  if (v.edges !== undefined && (!Array.isArray(v.edges) || v.edges.length > 20)) return null;
  const pairs = new Set<string>();
  for (const edge of v.edges || []) {
    if (!edge || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target ||
        typeof edge.label !== "string" || edge.label.length > 64 || typeof edge.quote !== "string" ||
        edge.quote.trim().length < 8 || !/[\p{L}\p{N}]/u.test(edge.quote) || edge.quote.length > 1600 || typeof edge.source_id !== "string" || !edge.source_id) return null;
    const key = `${edge.source}:${edge.target}`;
    if (pairs.has(key)) return null;
    pairs.add(key);
  }
  if (["flowchart","tree","graph"].includes(v.kind)) {
    if (!v.summary?.trim() || !v.edges?.length) return null;
    const connected = new Set([nodes[0].id]);
    for (const _ of nodes) for (const edge of v.edges)
      if (connected.has(edge.source) || connected.has(edge.target)) {connected.add(edge.source); connected.add(edge.target);}
    if (connected.size !== nodes.length) return null;
    if (v.kind === "tree") {
      const parents = nodes.map(node => v.edges!.filter(edge => edge.target === node.id).length);
      if (v.edges.length !== nodes.length-1 || parents.filter(n => n===0).length !== 1 || parents.some(n => n>1)) return null;
    }
  }
  return {...v,nodes,edges:v.edges || []};
}

export function diagramLayout(visual: Visual) {
  const nodes = visual.nodes;
  const edges = visual.edges || [];
  const ranks = new Map<string,number>();
  const remaining = new Map(nodes.map(n => [n.id!, edges.filter(e => e.target === n.id).length]));
  const queue = nodes.filter(n => remaining.get(n.id!) === 0).map(n => n.id!);
  queue.forEach(id => ranks.set(id,0));
  for (let cursor=0; cursor<queue.length; cursor++) {
    const id = queue[cursor];
    for (const edge of edges.filter(e => e.source===id)) {
      ranks.set(edge.target, Math.max(ranks.get(edge.target)||0,(ranks.get(id)||0)+1));
      remaining.set(edge.target,remaining.get(edge.target)!-1);
      if (remaining.get(edge.target)===0) queue.push(edge.target);
    }
  }
  // Rank cycles by distance from their entry point; feedback arrows route back.
  const cyclic = queue.length !== nodes.length;
  if (cyclic) {
    ranks.clear();
    const walk = nodes.filter(n => !edges.some(e => e.target===n.id)).map(n=>n.id!);
    if (!walk.length) walk.push(nodes[0].id!);
    walk.forEach(id=>ranks.set(id,0));
    for (let cursor=0;cursor<walk.length;cursor++) {
      for (const edge of edges.filter(e=>e.source===walk[cursor])) if (!ranks.has(edge.target)) {
        ranks.set(edge.target,ranks.get(walk[cursor])!+1);walk.push(edge.target);
      }
    }
    nodes.forEach(n=>{if(!ranks.has(n.id!))ranks.set(n.id!,0);});
  }
  const groups = new Map<number,number[]>();
  nodes.forEach((node,index) => {
    const rank = !edges.length ? Math.floor(index/2) : ranks.get(node.id!)||0;
    const row = groups.get(rank)||[]; row.push(index); groups.set(rank,row);
  });
  const rows: number[][] = [];
  [...groups.entries()].sort(([a],[b])=>a-b).forEach(([,indices]) => {
    for (let i=0;i<indices.length;i+=3) rows.push(indices.slice(i,i+3));
  });
  const width = Math.max(420,Math.max(...rows.map(row=>row.length))*218+40);
  const positioned = nodes.map((node,index) => {
    const row = rows.findIndex(indices=>indices.includes(index));
    const column = rows[row].indexOf(index);
    return {...node,x:(width-rows[row].length*218)/2+column*218+9,y:28+row*182};
  });
  return {nodes:positioned,width,height:rows.length*182+18};
}
