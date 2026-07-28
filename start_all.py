"""Start the current Flask retrieval service and open its development dashboard."""

import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser


ROOT = os.path.dirname(os.path.abspath(__file__))
ML_SERVICE_DIR = os.path.join(ROOT, "ml-service")
PYTHON = r"D:\py313\python.exe"
HEALTH_URL = "http://127.0.0.1:5000/health"

sys.path.insert(0, ML_SERVICE_DIR)
from startup_health import is_current_retrieval_health


def fetch_health():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=3) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def listeners_on_port(port: int) -> set[int]:
    result = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        capture_output=True,
        text=True,
        check=False,
    )
    marker = f":{port}"
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) >= 5 and columns[3] == "LISTENING" and marker in columns[1]:
            try:
                pids.add(int(columns[-1]))
            except ValueError:
                continue
    return pids


def stop_stale_flask_listeners() -> None:
    for pid in listeners_on_port(5000):
        print(f"Stopping stale Flask listener (PID {pid})...")
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=False)
    deadline = time.time() + 8
    while listeners_on_port(5000) and time.time() < deadline:
        time.sleep(0.25)
    if listeners_on_port(5000):
        raise RuntimeError("Port 5000 is still occupied after stale Flask cleanup")


def wait_for_current_health(timeout_seconds: int = 45) -> dict | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        health = fetch_health()
        if is_current_retrieval_health(health):
            return health
        time.sleep(0.5)
    return None


def main() -> None:
    print("Geo-Knowledge startup")
    health = fetch_health()
    process = None
    if is_current_retrieval_health(health):
        print("Current Flask retrieval service is already running.")
    else:
        if health is not None:
            print("Legacy Flask health response detected; restarting port 5000.")
        stop_stale_flask_listeners()
        print("Starting current Flask retrieval service...", end=" ", flush=True)
        process = subprocess.Popen(
            [PYTHON, "server.py"],
            cwd=ML_SERVICE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        health = wait_for_current_health()
        if health is None:
            raise RuntimeError("Flask did not expose the current retrieval health contract within 45 seconds")
        print("OK")

    retrieval = health["retrieval"]
    print(f"BGE: {'available' if retrieval['bge']['available'] else retrieval['bge']['reason']}")
    print(f"TF-IDF: {'available' if retrieval['tfidf']['available'] else retrieval['tfidf']['reason']}")
    webbrowser.open("http://127.0.0.1:5000/dashboard")
    print("Dashboard: http://127.0.0.1:5000/dashboard")
    print("Press Ctrl+C to stop the Flask process started by this launcher.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        if process is not None:
            process.terminate()


if __name__ == "__main__":
    main()
