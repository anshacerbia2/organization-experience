import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

// The two cookies this BFF sets. Both are __Host- prefixed, so a browser accepts them only when
// Secure, with Path=/ and no Domain: a neighbouring subdomain can neither set nor overwrite them
// (TDD-identity-experience-001 §Session Cookie).
export const sessionCookie = '__Host-ident_session';
export const loginCookie = '__Host-ident_login';

// The session cookie has no Max-Age: it ends with the browser, and the server-side expiries bound
// it whatever the browser does.
const sessionOptions: CookieSerializeOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

// The login cookie lives as long as a sign-in may take. Lax, because the callback is a top-level
// navigation back from the identity kernel's origin.
export const loginLifetimeSeconds = 600;
const loginOptions: CookieSerializeOptions = { ...sessionOptions, maxAge: loginLifetimeSeconds };

export const readCookie = (request: FastifyRequest, name: string): string | undefined =>
  request.cookies[name];

export const setSessionCookie = (reply: FastifyReply, value: string): FastifyReply =>
  reply.setCookie(sessionCookie, value, sessionOptions);

export const clearSessionCookie = (reply: FastifyReply): FastifyReply =>
  reply.clearCookie(sessionCookie, sessionOptions);

export const setLoginCookie = (reply: FastifyReply, value: string): FastifyReply =>
  reply.setCookie(loginCookie, value, loginOptions);

export const clearLoginCookie = (reply: FastifyReply): FastifyReply =>
  reply.clearCookie(loginCookie, sessionOptions);
