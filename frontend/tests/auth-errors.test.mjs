import test from 'node:test';
import assert from 'node:assert/strict';
import {loginErrorMessage} from '../lib/auth-errors.ts';
test('invalid login credentials do not claim an email confirmation requirement',()=>{
  assert.equal(loginErrorMessage({code:'invalid_credentials'}),'Sign-in failed. Check your email address and password.');
});
test('confirmation guidance is shown only for the actual Supabase confirmation error',()=>{
  assert.match(loginErrorMessage({code:'email_not_confirmed'}),/email confirmation/);
  for(const code of ['request_timeout','over_request_rate_limit',undefined]){
    const text=loginErrorMessage({code});assert.doesNotMatch(text,/email confirmation/);assert.match(text,/temporarily unavailable/);
  }
});
