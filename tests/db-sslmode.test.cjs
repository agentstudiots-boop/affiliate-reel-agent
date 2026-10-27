// The pool and the operator scripts state sslmode=verify-full explicitly: same strict behaviour as before, no pg warning,
// the secret itself is unchanged.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('pg-connection-string');
const {strictSslConnectionString}=require('../.test-build/lib/memory/db');
const script=require('../scripts/connection-string.cjs');

const neon='postgresql://user:p%40ss-W0rd@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

test('require/prefer/verify-ca become verify-full; everything else is kept',()=>{
  for(const fn of [strictSslConnectionString,script.strictSslConnectionString]){
    const out=fn(neon);
    const parsed=new URL(out);
    assert.equal(parsed.searchParams.get('sslmode'),'verify-full');
    assert.equal(parsed.searchParams.get('channel_binding'),'require');
    assert.equal(parsed.username,'user');assert.equal(parsed.password,'p%40ss-W0rd');
    assert.equal(parsed.hostname,'ep-cool-name-123456.eu-central-1.aws.neon.tech');assert.equal(parsed.pathname,'/neondb');
    for(const mode of ['prefer','verify-ca'])assert.match(fn(neon.replace('require&','${mode}&'.replace('${mode}',mode))),/sslmode=verify-full/);
    for(const mode of ['disable','verify-full'])assert.match(fn(neon.replace('sslmode=require',`sslmode=${mode}`)),new RegExp(`sslmode=${mode}`));
    assert.equal(fn('postgresql://localhost/db'),'postgresql://localhost/db');
    assert.equal(fn('not a url'),'not a url');
  }
});

test('pg parses the normalised string without the SSL-mode warning and with the same credentials',()=>{
  const warnings=[];const original=process.emitWarning;
  process.emitWarning=(warning)=>{warnings.push(String(warning));};
  try{
    const parsed=parse(strictSslConnectionString(neon));
    assert.equal(parsed.user,'user');assert.equal(parsed.password,'p@ss-W0rd');assert.equal(parsed.database,'neondb');
    assert.ok(parsed.ssl);
  }finally{process.emitWarning=original;}
  assert.deepEqual(warnings.filter(w=>/SSL modes/.test(w)),[]);
});
