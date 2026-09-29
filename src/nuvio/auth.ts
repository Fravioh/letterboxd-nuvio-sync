import { z } from 'zod';
import { BridgeError } from '../errors';
import { requestJson } from '../sync/retry';

export const NUVIO_URL = 'https://api.nuvio.tv';
// Public client key explicitly published by Nuvio. Never a service-role key.
export const NUVIO_PUBLIC_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
const sessionSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  user: z.object({ id: z.string().min(1) }),
});
export interface Session {
  accessToken: string;
  expiresAt: number;
  userId: string;
}
export const profileSchema = z.object({
  profile_index: z.number().int().min(1).max(6),
  name: z.string().min(1).max(200),
  pin_enabled: z.boolean().optional().default(false),
});
export type Profile = z.infer<typeof profileSchema>;
export function authHeaders(session?: Session): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: NUVIO_PUBLIC_KEY,
    ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}
export async function signIn(email: string, password: string): Promise<Session> {
  try {
    const raw = await requestJson(
      `${NUVIO_URL}/auth/v1/token?grant_type=password`,
      { method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password }) },
      'nuvio',
    );
    const result = sessionSchema.safeParse(raw);
    if (!result.success) throw new BridgeError('INVALID_RESPONSE');
    // Deliberately discard refresh_token and the rest of the auth response.
    return {
      accessToken: result.data.access_token,
      expiresAt: Date.now() + result.data.expires_in * 1000,
      userId: result.data.user.id,
    };
  } catch (error) {
    if (
      error instanceof BridgeError &&
      ['AUTH_EXPIRED', 'NUVIO_API'].includes(error.code) &&
      !error.retryable
    )
      throw new BridgeError('AUTH_FAILED');
    throw error;
  }
}
export async function getProfiles(session: Session): Promise<Profile[]> {
  const raw = await requestJson(
    `${NUVIO_URL}/rest/v1/rpc/sync_pull_profiles`,
    { method: 'POST', headers: authHeaders(session), body: '{}' },
    'nuvio',
  );
  const parsed = z.array(profileSchema).min(1).max(6).safeParse(raw);
  if (
    !parsed.success ||
    new Set(parsed.data.map((p) => p.profile_index)).size !== parsed.data.length
  )
    throw new BridgeError('INVALID_RESPONSE');
  return parsed.data;
}
export async function signOut(session: Session): Promise<void> {
  await requestJson(
    `${NUVIO_URL}/auth/v1/logout?scope=local`,
    { method: 'POST', headers: authHeaders(session) },
    'nuvio',
  );
}
