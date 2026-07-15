function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

type CachedValue<T> = {
  value: T;
};

type InFlightRequest<T> = {
  controller: AbortController;
  promise: Promise<T>;
  requestId: number;
  subscriberCount: number;
};

function waitForSharedRequest<T>(
  promise: Promise<T>,
  releaseSubscriber: () => void,
  signal?: AbortSignal,
): Promise<T> {
  let hasReleasedSubscriber = false;

  const finalizeSubscription = () => {
    if (hasReleasedSubscriber) {
      return;
    }

    hasReleasedSubscriber = true;
    releaseSubscriber();
  };

  if (!signal) {
    return promise.finally(finalizeSubscription);
  }

  if (signal.aborted) {
    finalizeSubscription();
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort);
      finalizeSubscription();
      reject(createAbortError());
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        finalizeSubscription();
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort);
        finalizeSubscription();
        reject(error);
      },
    );
  });
}

export function createSessionRequestCache<T>() {
  const cachedValues = new Map<string, CachedValue<T>>();
  const inFlightValues = new Map<string, InFlightRequest<T>>();
  let nextRequestId = 0;

  const releaseSubscriber = (key: string, requestId: number) => {
    const currentRequest = inFlightValues.get(key);

    if (!currentRequest || currentRequest.requestId !== requestId) {
      return;
    }

    currentRequest.subscriberCount -= 1;

    if (currentRequest.subscriberCount > 0) {
      return;
    }

    inFlightValues.delete(key);
    currentRequest.controller.abort();
  };

  return {
    read(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
      const cachedValue = cachedValues.get(key);

      if (cachedValue !== undefined) {
        return Promise.resolve(cachedValue.value);
      }

      if (signal?.aborted) {
        return Promise.reject(createAbortError());
      }

      let inFlightRequest = inFlightValues.get(key);

      if (!inFlightRequest) {
        const controller = new AbortController();
        const requestId = nextRequestId;

        nextRequestId += 1;

        const promise = load(controller.signal)
          .then((value) => {
            if (inFlightValues.get(key)?.requestId === requestId) {
              cachedValues.set(key, { value });
            }

            return value;
          })
          .finally(() => {
            if (inFlightValues.get(key)?.requestId === requestId) {
              inFlightValues.delete(key);
            }
          });

        inFlightRequest = {
          controller,
          promise,
          requestId,
          subscriberCount: 0,
        };

        inFlightValues.set(key, inFlightRequest);
      }

      inFlightRequest.subscriberCount += 1;

      return waitForSharedRequest(
        inFlightRequest.promise,
        () => releaseSubscriber(key, inFlightRequest.requestId),
        signal,
      );
    },
    reset() {
      cachedValues.clear();

      for (const [key, inFlightRequest] of inFlightValues) {
        inFlightValues.delete(key);
        inFlightRequest.controller.abort();
      }
    },
  };
}
