import test from 'node:test';
import assert from 'node:assert/strict';
import {accountNotice, accountMode, loginNotice} from '../lib/auth-notices.ts';

test('redirect notices accept only known codes and never reflect arbitrary URL text', () => {
  for (const value of ['<script>alert(1)</script>', '__proto__', 'toString', ['confirmation'], undefined]) {
    assert.equal(accountNotice(value), '');
  }
  assert.match(accountNotice('confirmation'), /confirm your account/);
  assert.doesNotMatch(accountNotice(loginNotice('invalid_credentials')), /confirmation/);
  assert.match(accountNotice(loginNotice('email_not_confirmed')), /email confirmation/);
  assert.match(accountNotice(loginNotice('unexpected_provider_error')), /temporarily unavailable/);
});

test('redirect mode cannot enter password recovery without the recovery flow', () => {
  assert.equal(accountMode('signup'), 'signup');
  assert.equal(accountMode('reset'), 'reset');
  for (const value of ['password', 'logout', '//external.example', undefined]) {
    assert.equal(accountMode(value), 'login');
  }
});
