import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlayhead} from '../lib/playhead.ts';

test('a question immediately after a seek uses the requested position while the iframe catches up',()=>{
  assert.equal(resolvePlayhead(0,14346,6000,1000),14346);
  assert.equal(resolvePlayhead(14346.8,14346,6000,2000),14346);
});
test('a backward seek never uses the old later position',()=>{
  assert.equal(resolvePlayhead(14346,300,6000,1000),300);
  assert.equal(resolvePlayhead(301,300,6000,2000),301);
});
test('a failed seek returns to the actual position after the acknowledgement timeout',()=>{
  assert.equal(resolvePlayhead(0,14346,6000,6001),0);
  assert.equal(resolvePlayhead(NaN,0,0,1000),null);
});
