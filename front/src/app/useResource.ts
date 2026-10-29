import { useEffect, useState, type DependencyList } from 'react';

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    load(controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
    // Callers supply the request's primitive inputs; the function itself is intentionally not a dependency.
  }, [...dependencies, attempt]);
  return { data, error, loading, retry: () => setAttempt(n => n + 1) };
}
