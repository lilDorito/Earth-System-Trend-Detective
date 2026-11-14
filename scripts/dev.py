# API + web in one command; ports from API_PORT (5055, since 8000 is often blocked on Windows) and WEB_PORT

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "app" / "web"
API_PORT = os.environ.get("API_PORT", "5055")
WEB_PORT = os.environ.get("WEB_PORT", "5173")
IS_WIN = os.name == "nt"


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if IS_WIN:  # npm.cmd spawns node: kill the whole tree
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


def main() -> int:
    npm = shutil.which("npm")
    if not npm:
        print("npm not found: install Node.js 20+ first")
        return 1
    if not (WEB / "node_modules").exists():
        print("installing web dependencies (first run)...")
        if subprocess.run([npm, "install"], cwd=WEB).returncode != 0:
            return 1

    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.api.main:app", "--port", API_PORT, "--reload"], cwd=ROOT
    )
    web_env = {**os.environ, "VITE_API_TARGET": f"http://localhost:{API_PORT}"}
    web = subprocess.Popen([npm, "run", "dev", "--", "--port", WEB_PORT], cwd=WEB, env=web_env)

    print(f"\n  web: http://localhost:{WEB_PORT}   api docs: http://localhost:{API_PORT}/docs   (Ctrl+C to stop)\n")
    try:
        while api.poll() is None and web.poll() is None:
            time.sleep(0.5)
        print("a process exited, stopping the other one")
    except KeyboardInterrupt:
        pass
    finally:
        stop(api)
        stop(web)
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    sys.exit(main())
