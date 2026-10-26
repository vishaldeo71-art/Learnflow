import test from 'node:test';
import assert from 'node:assert/strict';
import {progressTotals,speechText,voiceCommand} from '../lib/companion.ts';
test('companion commands require an exact command, not a keyword inside a doubt',()=>{
 assert.equal(voiceCommand('Show my progress!'),'progress');
 assert.equal(voiceCommand('start a quiz'),'quiz');
 assert.equal(voiceCommand('Why did I get this quiz question wrong?'),null);
 assert.equal(voiceCommand('stop speaking'),'stop');
});
test('progress is calculated from actual attempts, not made-up engagement points',()=>{
 const totals=progressTotals({notes:[{}],bookmarks:[],revision_queue:[{},{}],topics:[{title:'Weak',attempts:4,incorrect:2,correct_streak:0},{title:'Recovered',attempts:6,incorrect:1,correct_streak:3}]});
 assert.equal(totals.accuracy,70);assert.equal(totals.due,2);assert.equal(totals.notes,1);assert.equal(totals.weak.length,1);
 assert.equal(progressTotals({notes:[],bookmarks:[],revision_queue:[],topics:[]}).accuracy,null);
});
test('spoken answers omit source markers and URLs while retaining mathematical meaning',()=>{
 assert.equal(speechText('**Distance** = speed × time. [S1] https://example.com'),'Distance = speed × time.  ');
 assert.equal(speechText('a'.repeat(6000)).length,4000);
});
