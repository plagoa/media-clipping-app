export function createMediaLookupQueue(limit = 4, fetchImpl = fetch) {
  let active = 0;
  const pending = [];

  function drain() {
    while (active < limit && pending.length) {
      const task = pending.shift();
      task.signal.removeEventListener("abort", task.cancelPending);
      if (task.signal.aborted) {
        task.reject(task.signal.reason);
        continue;
      }
      active++;
      const params = new URLSearchParams({
        source: task.source,
        url: task.url,
      });
      Promise.resolve()
        .then(() => {
          task.signal.throwIfAborted();
          return fetchImpl(`/api/media?${params}`, { signal: task.signal });
        })
        .then((response) => {
          if (!response.ok) throw new Error("Media lookup failed");
          return response.json();
        })
        .then(task.resolve, task.reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  }

  return function lookup(source, url, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const task = { source, url, signal, resolve, reject };
      task.cancelPending = () => {
        const index = pending.indexOf(task);
        if (index !== -1) pending.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", task.cancelPending, { once: true });
      pending.push(task);
      drain();
    });
  };
}

export const lookupMedia = createMediaLookupQueue();
