import { useEffect, useState } from "react";
import "./App.css";
import { type AppInfo, getAppInfo } from "./ipc";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppInfo()
      .then((next) => {
        if (!cancelled) {
          setInfo(next);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1>Player</h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>{info ? `${info.name} ${info.version}` : "Loading…"}</p>
      )}
    </main>
  );
}

export default App;
