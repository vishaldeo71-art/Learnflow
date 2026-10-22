import test from 'node:test';
import assert from 'node:assert/strict';
import {watchedAdvance} from '../lib/watch-progress.ts';
test('checkpoints count advancing playback, never a seek or wall-clock delay',()=>{
 assert.equal(watchedAdvance({time:100,playing:true},{time:101,playing:true}),1);
 assert.equal(watchedAdvance({time:100,playing:true},{time:700,playing:true}),0);
 assert.equal(watchedAdvance({time:100,playing:false},{time:101,playing:false}),0);
 assert.equal(watchedAdvance({time:100,playing:true},{time:100,playing:true}),0);
 assert.equal(watchedAdvance({time:100,playing:true},{time:50,playing:true}),0);
 assert.equal(watchedAdvance(null,{time:500,playing:true}),0);
});
