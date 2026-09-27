"""Bounded transcription jobs. Subprocess isolation also cancels model loading/inference."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading

from render_process import check_cancel


def run_transcription(source, work_dir, model, language, cancel, report):
    result_path = Path(work_dir) / "transcription.json"
    command = [sys.executable, "-u", str(Path(__file__).with_name("transcription_worker.py")),
               "--source", str(source), "--output", str(result_path), "--model", model, "--language", language]
    reference = Path(work_dir) / "reference.json"
    if reference.is_file():
        command += ["--reference", str(reference)]
    check_cancel(cancel)
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        env={**os.environ, "HF_HUB_DISABLE_TELEMETRY":"1", "HF_HUB_DISABLE_SYMLINKS_WARNING":"1"})
    messages, errors = queue.Queue(), []
    def output_reader():
        for line in process.stdout:
            try:
                messages.put(json.loads(line))
            except ValueError:
                pass
    def error_reader():
        for line in process.stderr:
            errors.append(line.strip())
            if len(errors) > 12:
                errors.pop(0)
    readers = [threading.Thread(target=output_reader, daemon=True), threading.Thread(target=error_reader, daemon=True)]
    for reader in readers:
        reader.start()
    error = ""
    try:
        while process.poll() is None or not messages.empty():
            check_cancel(cancel)
            try:
                item = messages.get(timeout=.1)
            except queue.Empty:
                continue
            if item.get("error"):
                error = item["error"]
            else:
                report(item.get("progress", 0), item.get("message", "Çözümleniyor"))
        for reader in readers:
            reader.join(timeout=3)
        check_cancel(cancel)
        if process.returncode or not result_path.is_file():
            raise ValueError(error or "Yerel çözümleme başlatılamadı: " + " ".join(errors)[-700:])
        return json.loads(result_path.read_text(encoding="utf-8"))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for reader in readers:
            reader.join(timeout=3)
        process.stdout.close()
        process.stderr.close()
