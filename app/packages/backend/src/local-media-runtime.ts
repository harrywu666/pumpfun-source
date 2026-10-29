import { LocalMediaStore } from "./local-media-store.js";
import type { LocalMediaOptions } from "./local-media-routes.js";

type TerminationSignal = "SIGINT" | "SIGTERM";

export type LocalMediaEnvironment = {
  [key: string]: string | undefined;
  LOCAL_MEDIA_DIRECTORY?: string;
  LOCAL_MEDIA_TOKEN?: string;
  HOST?: string;
};

function exitCode(signal: TerminationSignal) {
  return signal === "SIGINT" ? 130 : 143;
}

function waitForSignal(store: LocalMediaStore) {
  let received = false;
  const listeners = new Map<TerminationSignal, () => void>();
  const remove = () => {
    for (const [signal, listener] of listeners) process.off(signal, listener);
    listeners.clear();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    // A caller that already handles this signal owns its shutdown policy.
    if (process.listenerCount(signal) !== 0) continue;
    const listener = () => {
      if (received) return;
      received = true;
      remove();
      void store.close().then(
        () => process.exit(exitCode(signal)),
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `Local media cleanup after ${signal} failed: ${message}\n`,
          );
          process.exit(1);
        },
      );
    };
    listeners.set(signal, listener);
    process.once(signal, listener);
  }
  return remove;
}

/** Server bootstrap only. No defaults, token generation, provider or browser configuration. */
export async function startWithLocalMedia<T>(
  environment: LocalMediaEnvironment,
  start: (localMedia: LocalMediaOptions | undefined) => Promise<T>,
): Promise<T> {
  const directory = environment.LOCAL_MEDIA_DIRECTORY;
  const token = environment.LOCAL_MEDIA_TOKEN;
  if (directory === undefined && token === undefined) return start(undefined);

  // Fail before touching disk when configuration is incomplete or exposure is unsafe.
  if (!directory?.trim() || directory.includes("\0") || !token) {
    throw new Error(
      "Local media requires both LOCAL_MEDIA_DIRECTORY and LOCAL_MEDIA_TOKEN.",
    );
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    throw new Error(
      "LOCAL_MEDIA_TOKEN must be a separate 32–256 character local capability.",
    );
  }
  if (!["127.0.0.1", "::1"].includes(environment.HOST ?? "127.0.0.1")) {
    throw new Error("Local media requires HOST=127.0.0.1 or HOST=::1.");
  }

  // Only a successfully acquired store is ours to close. A competing owner is never touched.
  const store = await LocalMediaStore.open(directory);
  // server.ts installs its normal handlers only after this function returns. Cover that
  // startup window so termination cannot strand the exclusive media ownership file.
  const stopWaiting = waitForSignal(store);
  try {
    return await start({ store, token });
  } catch (startupError) {
    try {
      // close() is idempotent if the app's onClose hook already released it.
      await store.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [startupError, cleanupError],
        "Local media startup and cleanup both failed.",
      );
    }
    throw startupError;
  } finally {
    stopWaiting();
  }
}
