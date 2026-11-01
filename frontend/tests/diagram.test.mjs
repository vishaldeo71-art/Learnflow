import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDiagram,diagramLayout} from '../lib/diagram.ts';
import {diagramSamples} from '../lib/diagram-samples.ts';

test('flowchart, tree, and graph samples have bounded nonoverlapping layouts and real connections',()=>{
 for(const sample of diagramSamples(x=>x)) {
  const safe=safeDiagram(sample);assert.ok(safe);
  assert.ok(safe.nodes.length>=6);assert.ok(safe.nodes.length<=12);
  const layout=diagramLayout(safe);
  for(const [index,node] of layout.nodes.entries()) {
   assert.ok(node.x>=0 && node.x+200<=layout.width);
   assert.ok(node.y>=0 && node.y+114<=layout.height);
   for(const other of layout.nodes.slice(index+1))assert.ok(Math.abs(node.x-other.x)>=200 || Math.abs(node.y-other.y)>=114);
  }
 }
});
test('malformed or disconnected diagram data falls back without reaching the renderer',()=>{
 const v=diagramSamples(x=>x)[1];
 for(const value of [null,{}, {...v,kind:'<script>'},{...v,nodes:[]},{...v,nodes:[...v.nodes,v.nodes[0]]},{...v,edges:[{...v.edges[0],target:'missing'}]},{...v,edges:[]},{...v,summary:''}])assert.equal(safeDiagram(value),null);
});
test('cycle graphs terminate and source text remains plain data',()=>{
 const v=diagramSamples(x=>x)[0];
 assert.ok(safeDiagram(v));assert.ok(diagramLayout(safeDiagram(v)).height<2000);
 v.nodes[0].label='<img src=x onerror=alert(1)>';
 assert.equal(safeDiagram(v).nodes[0].label,v.nodes[0].label);
});
test('legacy cards have stable IDs without inventing relationship arrows',()=>{
 const v={kind:'concept_map',title:'Old board',nodes:diagramSamples(x=>x)[2].nodes.slice(0,3).map(({id,...n})=>n)};
 const result=safeDiagram(v);assert.deepEqual(result.nodes.map(n=>n.id),['n1','n2','n3']);assert.deepEqual(result.edges,[]);
});
