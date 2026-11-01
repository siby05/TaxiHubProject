const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { auth, roleMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

function response() {
  return { code: 200, body: null, headers: {},
    status(n) { this.code = n; return this; },
    json(x) { this.body = x; return this; },
    setHeader(k,v) { this.headers[k] = v; }
  };
}
test('anonymous payment requests cannot pass authentication', async () => {
  const res = response(); let allowed = false;
  await auth({headers:{}},res,()=>{allowed=true;});
  assert.equal(res.code,401); assert.equal(allowed,false);
});
test('forged JWT cannot pass authentication', async () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length';
  try {
    const forged = jwt.sign({id:'507f1f77bcf86cd799439011',role:'admin'},'attacker-secret');
    const res=response(); let allowed=false;
    await auth({headers:{authorization:'Bearer '+forged}},res,()=>{allowed=true;});
    assert.equal(res.code,401); assert.equal(allowed,false);
  } finally {
    if(original===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=original;
  }
});
test('passenger cannot access driver/admin role endpoints', () => {
  const res=response(); let allowed=false;
  roleMiddleware(['admin','driver'])({user:{role:'passenger'}},res,()=>{allowed=true;});
  assert.equal(res.code,403); assert.equal(allowed,false);
});
test('public rate limiter returns 429 after budget is exhausted', () => {
  const limit=rateLimit({windowMs:60000,max:2});
  const req={ip:'192.0.2.100',method:'POST',originalUrl:'/api/booking/guest'};
  for(let i=0;i<2;i++){let ok=false;limit(req,response(),()=>{ok=true;});assert.equal(ok,true);}
  const res=response();let ok=false;limit(req,res,()=>{ok=true;});
  assert.equal(res.code,429);assert.equal(ok,false);
});
