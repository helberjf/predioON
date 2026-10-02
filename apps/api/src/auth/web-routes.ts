import { createHash } from 'node:crypto';
import { Router, type CookieOptions, type Request } from 'express';
import { z } from 'zod';
import type { WebSession } from '@predioon/contracts/auth';
import { config } from '../config.js';
import { HttpError, badRequest, forbidden, unauthorized } from '../http/errors.js';
import { validateBody } from '../http/validate.js';
import { login, refreshSession, revokeSession, type SessionTokens } from './service.js';

export const webAuthRouter=Router();

/** Exact Origin plus a non-simple header and JSON require an allowed preflight.
 * Cookies are never accepted by bearer-authenticated domain routes. */
function cookiePolicy(req:Request): {name:string;options:CookieOptions} {
  const origin=req.header('origin');
  if(!origin||!config.corsOrigins.includes(origin)||req.header('x-predioon-web')!=='1'
    ||req.header('sec-fetch-site')==='cross-site')throw forbidden('Origem web não autorizada');
  let parsed:URL;
  try{parsed=new URL(origin);}catch{throw forbidden('Origem web não autorizada');}
  if(parsed.origin!==origin)throw forbidden('Origem web não autorizada');
  const secure=parsed.protocol==='https:';
  const localHttp=parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  if(!secure&&(config.NODE_ENV==='production'||!localHttp))throw forbidden('A sessão web exige HTTPS');
  // Host-prefix cookies must use Path=/ and omit Domain. The origin suffix
  // separates portals on the same API host without exposing the refresh token.
  const suffix=createHash('sha256').update(origin).digest('hex').slice(0,24);
  return {name:`${secure?'__Host-':''}predioon_web_${suffix}`,
    options:{httpOnly:true,secure,sameSite:'strict',path:'/'}};
}

function refreshCookie(req:Request,name:string): string|null {
  const matching=(req.header('cookie')??'').split(';').map(value=>value.trim())
    .filter(value=>value.slice(0,value.indexOf('='))===name);
  if(matching.length>1)throw badRequest('Cookie de sessão ambíguo');
  const value=matching[0]?.slice(name.length+1);
  return value&&/^[A-Za-z0-9_-]{64}$/.test(value)?value:null;
}

function publicSession(session:SessionTokens): WebSession {
  const {identity}=session;
  return {accessToken:session.accessToken,user:{id:identity.userId,name:identity.name,email:identity.email,
    role:identity.role,memberships:identity.memberships}};
}

webAuthRouter.use((req,_res,next)=>{
  cookiePolicy(req);
  if(!req.is('application/json'))throw new HttpError(415,'Use JSON para a sessão web');
  next();
});

webAuthRouter.post('/login',validateBody(z.object({email:z.string().email(),password:z.string().min(1)}).strict()),async(req,res)=>{
  const policy=cookiePolicy(req);
  const session=await login(req.body.email,req.body.password,{userAgent:req.header('user-agent'),ipAddress:req.ip});
  res.cookie(policy.name,session.refreshToken,{...policy.options,expires:session.expiresAt,
    maxAge:Math.max(0,session.expiresAt.getTime()-Date.now())});
  res.json(publicSession(session));
});

webAuthRouter.post('/refresh',validateBody(z.object({}).strict()),async(req,res)=>{
  const policy=cookiePolicy(req);
  const token=refreshCookie(req,policy.name);
  try{
    if(!token)throw unauthorized('Sua sessão expirou. Entre novamente.');
    const session=await refreshSession(token,{userAgent:req.header('user-agent'),ipAddress:req.ip});
    res.cookie(policy.name,session.refreshToken,{...policy.options,expires:session.expiresAt,
      maxAge:Math.max(0,session.expiresAt.getTime()-Date.now())});
    res.json(publicSession(session));
  }catch(error){
    // Keep the cookie on transient database/service errors, so a failed request
    // does not silently erase a recoverable family.
    if(error instanceof HttpError&&error.status===401)res.clearCookie(policy.name,policy.options);
    throw error;
  }
});

webAuthRouter.post('/logout',validateBody(z.object({}).strict()),async(req,res)=>{
  const policy=cookiePolicy(req);
  const token=refreshCookie(req,policy.name);
  if(token)await revokeSession(token);
  res.clearCookie(policy.name,policy.options);
  res.status(204).end();
});
