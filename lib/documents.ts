import { NextResponse } from 'next/server';
import { createClient } from './supabase/server';

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
export async function identity() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error && error.status !== 400 && error.status !== 401 && error.name !== 'AuthSessionMissingError') throw error;
  return { client, user: data.user };
}
export function titleFrom(value: unknown) {
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string') return null;
  return value.title.trim() || null;
}
