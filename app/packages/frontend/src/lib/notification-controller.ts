import {
  NOTIFICATION_TOPICS,
  mergePreferencePatch,
  readPreferenceSnapshot,
  readTopicSnapshot,
  preferenceValue,
  topicValue,
  type KnownBoolean,
  type PreferenceGroup,
  type NotificationTopic,
  type PreferencePatch,
  type PreferenceSnapshot,
  type TopicAction,
  type TopicSnapshot,
} from "./notification-state";

/** No HTTP implementation. A local adapter must be supplied deliberately. */
export interface NotificationAdapter {
  readonly kind: "unavailable" | "synthetic-test";
  readSettings(): Promise<unknown>;
  writeSettings(submitted: PreferenceSnapshot): Promise<unknown>;
  readTopics(): Promise<unknown>;
  mutateTopic(
    action: TopicAction,
    body: Readonly<{ topic: NotificationTopic }>,
  ): Promise<unknown>;
}
const unavailable = async (): Promise<never> => {
  throw new Error("Notification adapter unavailable");
};
export const unavailableNotificationAdapter: NotificationAdapter =
  Object.freeze({
    kind: "unavailable",
    readSettings: unavailable,
    writeSettings: unavailable,
    readTopics: unavailable,
    mutateTopic: unavailable,
  });

export type LocalFailure = Readonly<{
  kind: "adapter-failure" | "invalid-data" | "invalid-input";
}>;
export type QueryState<T> = Readonly<{
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  stale: boolean;
  error: LocalFailure | null;
}>;
export type MutationState = Readonly<{
  status: "idle" | "pending" | "error";
  error: LocalFailure | null;
}>;
export type NotificationState = Readonly<{
  adapterKind: NotificationAdapter["kind"];
  settings: QueryState<PreferenceSnapshot>;
  settingsMutation: MutationState;
  topics: QueryState<TopicSnapshot>;
  topicMutation: MutationState;
}>;
export type ActionResult =
  | Readonly<{ status: "completed"; refreshed?: boolean }>
  | Readonly<{ status: "failed"; error: LocalFailure }>
  | Readonly<{
      status: "ignored";
      reason: "unavailable" | "busy" | "no-data" | "superseded" | "disposed";
    }>;

const idleQuery = <T>(): QueryState<T> =>
  Object.freeze({ status: "idle", data: null, stale: false, error: null });
const idleMutation = (): MutationState =>
  Object.freeze({ status: "idle", error: null });
const failed = (kind: LocalFailure["kind"]): LocalFailure =>
  Object.freeze({ kind });
const ignored = (
  reason: Extract<ActionResult, { status: "ignored" }>["reason"],
): ActionResult => ({ status: "ignored", reason });

/**
 * Framework-independent external store for useSyncExternalStore or local tests.
 * No optimistic success: only a resolved adapter write commits its submitted data.
 * Reset/dispose invalidate pending completions, e.g. when an owning view changes.
 */
export function createNotificationController(
  adapter: NotificationAdapter = unavailableNotificationAdapter,
) {
  // Capture activation once: unexpected JS callers cannot activate an adapter.
  const adapterKind =
    adapter.kind === "synthetic-test" ? "synthetic-test" : "unavailable";
  const initial = (): NotificationState =>
    Object.freeze({
      adapterKind,
      settings: idleQuery<PreferenceSnapshot>(),
      settingsMutation: idleMutation(),
      topics: idleQuery<TopicSnapshot>(),
      topicMutation: idleMutation(),
    });
  let state = initial();
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<NotificationState>) => {
    state = Object.freeze({ ...state, ...changes });
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  };
  const guard = (): ActionResult | null =>
    disposed
      ? ignored("disposed")
      : adapterKind !== "synthetic-test"
        ? ignored("unavailable")
        : null;
  const current = (started: number) => !disposed && generation === started;
  const completion = (started: number): ActionResult =>
    current(started) ? { status: "completed" } : ignored("superseded");

  async function loadSettings(): Promise<ActionResult> {
    const blocked = guard();
    if (blocked) return blocked;
    if (
      state.settings.status === "loading" ||
      state.settingsMutation.status === "pending"
    )
      return ignored("busy");
    const started = generation;
    publish({
      settings: Object.freeze({
        ...state.settings,
        status: "loading",
        error: null,
      }),
    });
    if (!current(started)) return ignored("superseded");
    let result: unknown;
    try {
      result = await adapter.readSettings();
    } catch {
      return settingsReadFailure(started, failed("adapter-failure"));
    }
    if (!current(started)) return ignored("superseded");
    let data: PreferenceSnapshot;
    try {
      data = readPreferenceSnapshot(result);
    } catch {
      return settingsReadFailure(started, failed("invalid-data"));
    }
    publish({
      settings: Object.freeze({
        status: "ready",
        data,
        stale: false,
        error: null,
      }),
    });
    return completion(started);
  }
  function settingsReadFailure(
    started: number,
    error: LocalFailure,
  ): ActionResult {
    if (!current(started)) return ignored("superseded");
    publish({
      settings: Object.freeze({
        ...state.settings,
        status: "error",
        stale: state.settings.data !== null,
        error,
      }),
    });
    return { status: "failed", error };
  }

  async function updateSettings(patch: PreferencePatch): Promise<ActionResult> {
    const blocked = guard();
    if (blocked) return blocked;
    if (
      state.settingsMutation.status === "pending" ||
      state.settings.status === "loading"
    )
      return ignored("busy");
    if (state.settings.data === null || state.settings.stale)
      return ignored("no-data");
    let submitted: PreferenceSnapshot | null;
    try {
      submitted = mergePreferencePatch(state.settings.data, patch);
    } catch {
      const error = failed("invalid-input");
      publish({ settingsMutation: Object.freeze({ status: "error", error }) });
      return { status: "failed", error };
    }
    if (submitted === null) return ignored("no-data");
    const started = generation;
    publish({
      settingsMutation: Object.freeze({ status: "pending", error: null }),
    });
    if (!current(started)) return ignored("superseded");
    try {
      await adapter.writeSettings(submitted);
    } catch {
      if (!current(started)) return ignored("superseded");
      const error = failed("adapter-failure");
      publish({ settingsMutation: Object.freeze({ status: "error", error }) });
      return { status: "failed", error };
    }
    if (!current(started)) return ignored("superseded");
    publish({
      settings: Object.freeze({
        status: "ready",
        data: submitted,
        stale: false,
        error: null,
      }),
      settingsMutation: idleMutation(),
    });
    return completion(started);
  }

  async function loadTopics(): Promise<ActionResult> {
    const blocked = guard();
    if (blocked) return blocked;
    if (
      state.topics.status === "loading" ||
      state.topicMutation.status === "pending"
    )
      return ignored("busy");
    const started = generation;
    publish({
      topics: Object.freeze({
        ...state.topics,
        status: "loading",
        error: null,
      }),
    });
    return performTopicsRead(started);
  }
  async function performTopicsRead(started: number): Promise<ActionResult> {
    if (!current(started)) return ignored("superseded");
    let result: unknown;
    try {
      result = await adapter.readTopics();
    } catch {
      return topicsReadFailure(started, failed("adapter-failure"));
    }
    if (!current(started)) return ignored("superseded");
    let data: TopicSnapshot;
    try {
      data = readTopicSnapshot(result);
    } catch {
      return topicsReadFailure(started, failed("invalid-data"));
    }
    publish({
      topics: Object.freeze({
        status: "ready",
        data,
        stale: false,
        error: null,
      }),
    });
    return completion(started);
  }
  function topicsReadFailure(
    started: number,
    error: LocalFailure,
  ): ActionResult {
    if (!current(started)) return ignored("superseded");
    publish({
      topics: Object.freeze({
        ...state.topics,
        status: "error",
        stale: state.topics.data !== null,
        error,
      }),
    });
    return { status: "failed", error };
  }

  async function setTopic(
    topic: NotificationTopic,
    action: TopicAction,
  ): Promise<ActionResult> {
    const blocked = guard();
    if (blocked) return blocked;
    if (
      state.topicMutation.status === "pending" ||
      state.topics.status === "loading"
    )
      return ignored("busy");
    if (state.topics.data === null || state.topics.stale)
      return ignored("no-data");
    if (
      !(NOTIFICATION_TOPICS as readonly string[]).includes(topic) ||
      !["subscribe", "unsubscribe"].includes(action)
    ) {
      const error = failed("invalid-input");
      publish({ topicMutation: Object.freeze({ status: "error", error }) });
      return { status: "failed", error };
    }
    const started = generation;
    publish({
      topicMutation: Object.freeze({ status: "pending", error: null }),
    });
    if (!current(started)) return ignored("superseded");
    try {
      await adapter.mutateTopic(action, Object.freeze({ topic }));
    } catch {
      if (!current(started)) return ignored("superseded");
      const error = failed("adapter-failure");
      publish({ topicMutation: Object.freeze({ status: "error", error }) });
      return { status: "failed", error };
    }
    if (!current(started)) return ignored("superseded");
    // A successful POST invalidates; its response is not replacement topic data.
    publish({
      topicMutation: idleMutation(),
      topics: Object.freeze({
        ...state.topics,
        status: "loading",
        stale: true,
        error: null,
      }),
    });
    const refresh = await performTopicsRead(started);
    if (!current(started)) return ignored("superseded");
    return { status: "completed", refreshed: refresh.status === "completed" };
  }

  return Object.freeze({
    getSnapshot: (): NotificationState => state,
    subscribe(listener: () => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loadSettings,
    updateSettings,
    loadTopics,
    setTopic,
    reset(): void {
      if (disposed) return;
      generation++;
      publish(initial());
    },
    dispose(): void {
      if (disposed) return;
      generation++;
      disposed = true;
      state = initial();
      listeners.clear();
    },
  });
}
export type NotificationController = ReturnType<
  typeof createNotificationController
>;

/** Controlled UI values: stale/missing data never becomes an unchecked switch. */
export type NotificationControlState = KnownBoolean &
  Readonly<{ disabled: boolean }>;
export function preferenceControl(
  state: NotificationState,
  group: PreferenceGroup,
  field: string,
): NotificationControlState {
  const value = preferenceValue(
    state.settings.stale ? null : state.settings.data,
    group,
    field,
  );
  return {
    ...value,
    disabled:
      !value.available ||
      state.adapterKind !== "synthetic-test" ||
      state.settings.status === "loading" ||
      state.settingsMutation.status === "pending",
  };
}
export function topicControl(
  state: NotificationState,
  topic: NotificationTopic,
): NotificationControlState {
  const value = topicValue(
    state.topics.stale ? null : state.topics.data,
    topic,
  );
  return {
    ...value,
    disabled:
      !value.available ||
      state.adapterKind !== "synthetic-test" ||
      state.topics.status === "loading" ||
      state.topicMutation.status === "pending",
  };
}
