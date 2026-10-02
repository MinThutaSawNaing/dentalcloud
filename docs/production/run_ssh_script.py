"""Send a UTF-8 script to the authorized host without PowerShell quote changes.

Usage: python run_ssh_script.py < local_script.sh
Only SSH key authentication and previously trusted host keys are permitted.
No passwords are accepted. Review scripts before using this administrative tool.
"""
import subprocess
import sys


def main() -> int:
    script = sys.stdin.buffer.read().replace(b"\r\n", b"\n")
    if not script.strip():
        raise SystemExit("No script supplied")
    result = subprocess.run(
        ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
         "-o", "ConnectTimeout=10", "root@13.140.149.162", "bash", "-s"],
        input=script + b"\n",
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())