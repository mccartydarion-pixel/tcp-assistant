import type { TuningProfile, TuningSession } from '../knowledge/types.js';
import { createInitialProfile, getTuningRecommendation } from './tuningRules.js';

export class TuningService {
  private readonly sessions = new Map<string, TuningSession>();
  private readonly ttlMs = 45 * 60 * 1000;

  getSession(userId: string): TuningSession | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;

    if (Date.now() - session.updatedAt > this.ttlMs) {
      this.sessions.delete(userId);
      return undefined;
    }

    return session;
  }

  upsertSession(userId: string, profile: Partial<TuningProfile> = {}): TuningSession {
    const existing = this.getSession(userId) ?? {
      userId,
      profile: createInitialProfile(),
      updatedAt: Date.now(),
    };

    const updated: TuningSession = {
      ...existing,
      profile: { ...existing.profile, ...profile },
      updatedAt: Date.now(),
    };

    this.sessions.set(userId, updated);
    return updated;
  }

  recommend(userId: string, observation: TuningSession['lastObservation'], profile?: TuningProfile): string {
    const session = this.getSession(userId) ?? this.upsertSession(userId, profile ?? createInitialProfile());
    const nextProfile = profile ?? session.profile;
    const recommendation = getTuningRecommendation(observation ?? 'STABLE', nextProfile);
    session.previousRecommendation = recommendation;
    session.updatedAt = Date.now();
    this.sessions.set(userId, session);
    return recommendation;
  }
}
