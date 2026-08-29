export interface ObservationMember {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly addedByGithubUserId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ObservationStatus {
  readonly initialized: boolean;
  readonly setupTokenConfigured: boolean;
  readonly githubOAuthEnabled: boolean;
  readonly authenticated: boolean;
  readonly member?: ObservationMember;
}

export interface ActivityTotals {
  readonly changesetCount: number;
  readonly mutationCount: number;
  readonly mutationSize: number;
}

export interface ChangesetActivity {
  readonly bucketMs: number;
  readonly buckets: readonly ({ readonly start: number } & ActivityTotals)[];
  readonly totals: ActivityTotals;
  readonly users: readonly ({ readonly id: string; readonly username: string | null; readonly displayName: string | null; readonly avatarUrl: string | null } & ActivityTotals)[];
  readonly units: readonly ({ readonly id: string; readonly name: string | null; readonly spaceName: string | null; readonly unitType: string | null } & ActivityTotals)[];
  readonly mutationSizePresentCount: number;
  readonly mutationSizeMissingCount: number;
  readonly missingCreateTimeCount: number;
  readonly meta: {
    readonly collaborationQueryMs: number;
    readonly productEnrichmentMs: number;
    readonly totalServerMs: number;
    readonly generatedAt: string;
    readonly latestChangesetTime: string | null;
  };
}

export async function observationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { readonly error?: { readonly message?: string } } | null;
    throw new Error(body?.error?.message ?? `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const observationStatusQuery = {
  queryKey: ["observation", "status"] as const,
  queryFn: () => observationRequest<ObservationStatus>("/api/status"),
  staleTime: 10_000,
};
