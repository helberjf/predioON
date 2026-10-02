import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { sqlClient } from '@predioon/db';
import { closeAppDb } from '@predioon/db/runtime';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth/passwords.js';
import { startTestServer, call, type TestServer } from './helpers.js';

describe('web cookies against real session storage', () => {
  let server: TestServer;
  const id=`web-session-${randomUUID()}`,email=`${id}@example.invalid`,password='Web-fixture-password-123';
  const origin='http://localhost:5174',otherOrigin='http://localhost:5175',secureOrigin='https://sindico.example.test';
  const originalOrigins=[...config.corsOrigins];
  before(async()=>{
    config.corsOrigins.push(origin,otherOrigin,secureOrigin,'http://insecure.example.test');
    await sqlClient`insert into users(id,name,email,password_hash) values(${id},'Web fixture',${email},${await hashPassword(password)})`;
    server=await startTestServer();
  });
  after(async()=>{
    config.corsOrigins.splice(0,config.corsOrigins.length,...originalOrigins);
    await server?.close();
    await sqlClient`delete from users where id=${id}`;
    await closeAppDb();await sqlClient.end();
  });
  const headers=(extra:Record<string,string>={})=>({Origin:origin,'Content-Type':'application/json','X-Predioon-Web':'1',...extra});
  function request(path:string,body:unknown={},extra:Record<string,string>={}){
    return fetch(`${server.url}/auth/web/${path}`,{method:'POST',headers:headers(extra),body:JSON.stringify(body)});
  }
  function cookie(response:Response){
    const values=response.headers.getSetCookie();assert.equal(values.length,1);
    return values[0]!.split(';')[0]!;
  }
  async function signedIn(extra:Record<string,string>={}){
    const response=await request('login',{email,password},extra);assert.equal(response.status,200);
    const body=await response.json() as {accessToken:string;user:{id:string};refreshToken?:string};
    assert.deepEqual(Object.keys(body).sort(),['accessToken','user']);
    return {response,body,cookie:cookie(response)};
  }
  async function sessionCount(){return Number((await sqlClient`select count(*) n from sessions where user_id=${id}`)[0]!.n);}

  it('issues only an HttpOnly cookie and an in-memory access response',async()=>{
    const session=await signedIn();
    const setCookie=session.response.headers.get('set-cookie')!;
    assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    assert.match(setCookie,/Path=\//);assert.doesNotMatch(setCookie,/Domain=/i);
    assert.equal(session.response.headers.get('cache-control'),'no-store');
    assert.equal(session.body.user.id,id);
    assert.equal((await call(server.url,'/auth/me',{token:session.body.accessToken})).status,200);
    const raw=session.cookie.slice(session.cookie.indexOf('=')+1);
    assert.match(raw,/^[A-Za-z0-9_-]{64}$/);
    assert.ok(!JSON.stringify(session.body).includes(raw));
    const [stored]=await sqlClient`select token_hash from refresh_tokens where user_id=${id} order by created_at desc limit 1`;
    assert.notEqual(stored!.token_hash,raw);
    assert.equal((await fetch(`${server.url}/auth/me`,{headers:{Cookie:session.cookie}})).status,401,'domain authentication never accepts the refresh cookie');
  });

  it('rejects cross-origin, absent-origin and simple-request CSRF before session creation',async()=>{
    const before=await sessionCount();
    const invalid=[
      {Origin:''},{Origin:'null'},{Origin:'https://untrusted.example.test'},
      {Origin:`${origin}/path`},{Origin:`${origin}.evil.test`},
      {Origin:'http://insecure.example.test'},{'X-Predioon-Web':''},{'X-Predioon-Web':'0'},
      {'Sec-Fetch-Site':'cross-site'},
    ];
    for(const extra of invalid){
      const response=await request('login',{email,password},extra);
      assert.equal(response.status,403,JSON.stringify(extra));assert.equal(response.headers.get('set-cookie'),null);
    }
    const form=await fetch(`${server.url}/auth/web/login`,{method:'POST',headers:headers({'Content-Type':'text/plain'}),body:JSON.stringify({email,password})});
    assert.equal(form.status,415);assert.equal(form.headers.get('set-cookie'),null);
    assert.equal(await sessionCount(),before);
  });

  it('requires CSRF protection for refresh and logout without consuming or clearing a valid cookie',async()=>{
    const session=await signedIn();
    for(const path of ['refresh','logout']){
      for(const extra of [{Origin:'https://untrusted.example.test'},{Origin:''},{'X-Predioon-Web':''}]){
        const response=await request(path,{}, {Cookie:session.cookie,...extra});
        assert.equal(response.status,403);assert.equal(response.headers.get('set-cookie'),null);
      }
    }
    assert.equal((await request('refresh',{}, {Cookie:session.cookie})).status,200);
  });

  it('keeps independent cookies and families for separate allowed portals',async()=>{
    const first=await signedIn(),second=await signedIn({Origin:otherOrigin});
    assert.notEqual(first.cookie.split('=')[0],second.cookie.split('=')[0]);
    const jar=`${first.cookie}; ${second.cookie}`;
    const rotated=await request('refresh',{}, {Cookie:jar});assert.equal(rotated.status,200);
    const firstNew=cookie(rotated);
    assert.equal(firstNew.split('=')[0],first.cookie.split('=')[0]);
    const other=await request('refresh',{}, {Origin:otherOrigin,Cookie:jar});assert.equal(other.status,200);
    const otherBody=await other.json() as {accessToken:string};
    const result=await request('logout',{}, {Cookie:`${firstNew}; ${cookie(other)}`});assert.equal(result.status,204);
    assert.equal((await call(server.url,'/auth/me',{token:first.body.accessToken})).status,401);
    assert.equal((await call(server.url,'/auth/me',{token:otherBody.accessToken})).status,200);
    assert.equal((await request('refresh',{}, {Cookie:second.cookie})).status,401,'another portal cookie cannot be selected by the current portal');
  });

  it('rotates once, preserves absolute expiry and revokes a replayed family',async()=>{
    const first=await signedIn();const sid=decodeJwt(first.body.accessToken).sid as string;
    await sqlClient`update sessions set expires_at=now()+interval '90 seconds' where id=${sid}`;
    const response=await request('refresh',{}, {Cookie:first.cookie});assert.equal(response.status,200);
    const maxAge=Number(/Max-Age=(\d+)/.exec(response.headers.get('set-cookie')!)?.[1]);
    assert.ok(maxAge>0&&maxAge<=90,`absolute cookie lifetime: ${maxAge}`);
    assert.notEqual(cookie(response),first.cookie);
    const rotated=await response.json() as {accessToken:string};
    assert.equal('refreshToken' in rotated,false);
    const replay=await request('refresh',{}, {Cookie:first.cookie});assert.equal(replay.status,401);
    assert.match(replay.headers.get('set-cookie')!,/Expires=Thu, 01 Jan 1970/);
    assert.equal((await call(server.url,'/auth/me',{token:rotated.accessToken})).status,401);
  });

  it('rejects malformed or duplicate cookies and JSON refresh tokens without mutating the family',async()=>{
    const session=await signedIn();
    const name=session.cookie.split('=')[0]!;
    const raw=session.cookie.slice(name.length+1);
    const duplicate=await request('refresh',{}, {Cookie:`${session.cookie}; ${session.cookie}`});assert.equal(duplicate.status,400);
    assert.equal(duplicate.headers.get('set-cookie'),null);
    assert.equal((await request('refresh',{refreshToken:raw})).status,400);
    assert.equal((await request('logout',{refreshToken:raw},{Cookie:session.cookie})).status,400);
    for(const malformed of ['',`${name}=%GG`,`${name}=short`])assert.equal((await request('refresh',{}, {Cookie:malformed})).status,401);
    assert.equal((await call(server.url,'/auth/me',{token:session.body.accessToken})).status,200);
    assert.equal((await request('refresh',{}, {Cookie:session.cookie})).status,200);
  });

  it('rejects bad credentials without issuing a cookie and logs out idempotently',async()=>{
    const before=await sessionCount();
    const invalid=await request('login',{email,password:'incorrect'});assert.equal(invalid.status,401);
    assert.equal(invalid.headers.get('set-cookie'),null);assert.equal(await sessionCount(),before);
    const first=await signedIn();
    const logout=await request('logout',{}, {Cookie:first.cookie});assert.equal(logout.status,204);
    assert.match(logout.headers.get('set-cookie')!,/HttpOnly/);
    assert.equal((await call(server.url,'/auth/me',{token:first.body.accessToken})).status,401);
    assert.equal((await request('logout',{}, {Cookie:first.cookie})).status,204);
    assert.equal((await request('logout')).status,204);
  });

  it('expires cookies for inactive accounts or expired sessions',async()=>{
    const first=await signedIn();const sid=decodeJwt(first.body.accessToken).sid as string;
    await sqlClient`update sessions set expires_at=now()-interval '1 second' where id=${sid}`;
    const expired=await request('refresh',{}, {Cookie:first.cookie});assert.equal(expired.status,401);
    assert.match(expired.headers.get('set-cookie')!,/Expires=Thu, 01 Jan 1970/);
    const second=await signedIn();
    try{
      await sqlClient`update users set active=false where id=${id}`;
      const inactive=await request('refresh',{}, {Cookie:second.cookie});assert.equal(inactive.status,401);
      assert.match(inactive.headers.get('set-cookie')!,/Expires=Thu, 01 Jan 1970/);
    }finally{await sqlClient`update users set active=true where id=${id}`;}
  });

  it('uses Secure host cookies for HTTPS and rejects cleartext origins in production',async()=>{
    const session=await signedIn({Origin:secureOrigin});
    assert.match(session.response.headers.get('set-cookie')!,/^__Host-/);
    assert.match(session.response.headers.get('set-cookie')!,/; Secure;/);
    const previous=config.NODE_ENV;
    try{
      config.NODE_ENV='production';
      assert.equal((await request('login',{email,password})).status,403);
      const secured=await signedIn({Origin:secureOrigin});
      assert.match(secured.response.headers.get('set-cookie')!,/^__Host-/);
      assert.match(secured.response.headers.get('set-cookie')!,/; Secure;/);
    }finally{config.NODE_ENV=previous;}
  });

  it('rolls back a failed rotation without deleting the recoverable cookie',async(t)=>{
    const session=await signedIn();
    const suffix=randomUUID().replaceAll('-','');
    const fn=`test_web_refresh_failure_${suffix}`,trigger=`test_web_refresh_trigger_${suffix}`;
    await sqlClient.unsafe(`create function public.${fn}() returns trigger language plpgsql as $$ begin raise exception 'Isolated rotation failure'; end $$`);
    let installed=false;
    const silence=t.mock.method(console,'error',()=>{});
    try{
      // This database/test file is isolated. The trigger fails exactly the next
      // insertion attempt; the original refresh row must roll back with it.
      await sqlClient.unsafe(`create trigger ${trigger} before insert on refresh_tokens for each row execute function public.${fn}()`);
      installed=true;
      const failed=await request('refresh',{}, {Cookie:session.cookie});assert.equal(failed.status,500);
      assert.equal(failed.headers.get('set-cookie'),null);
      await sqlClient.unsafe(`drop trigger ${trigger} on refresh_tokens`);installed=false;
      const recovered=await request('refresh',{}, {Cookie:session.cookie});assert.equal(recovered.status,200);
    }finally{
      silence.mock.restore();
      if(installed)await sqlClient.unsafe(`drop trigger ${trigger} on refresh_tokens`);
      await sqlClient.unsafe(`drop function public.${fn}()`);
    }
  });
});
