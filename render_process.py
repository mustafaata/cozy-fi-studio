"""Cancellable FFmpeg execution; progress comes from encoded timestamps."""
import queue
import subprocess
import threading


class RenderCancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise RenderCancelled("İptal edildi")


def run_ffmpeg(args, cancel=None, progress=None, duration=1, stderr_line=None):
    check_cancel(cancel)
    command = [args[0], "-nostdin", "-hide_banner", "-loglevel", "error",
               "-progress", "pipe:1", "-nostats", *args[1:]]
    lines = queue.Queue()
    errors = []
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding="utf-8", errors="replace",
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def drain(stream, output):
        for line in stream:
            output(line.strip())

    def error_line(line):
        if stderr_line:
            stderr_line(line)
        errors.append(line)
        if len(errors) > 30:
            errors.pop(0)

    readers = [threading.Thread(target=drain, args=(process.stdout, lines.put), daemon=True),
               threading.Thread(target=drain, args=(process.stderr, error_line), daemon=True)]
    for reader in readers:
        reader.start()
    try:
        while process.poll() is None or not lines.empty():
            check_cancel(cancel)
            try:
                line = lines.get(timeout=0.1)
            except queue.Empty:
                continue
            if progress and line.startswith("out_time_us="):
                try:
                    progress(max(0, min(1, int(line.split("=", 1)[1]) / 1e6 / duration)))
                except ValueError:
                    pass
        check_cancel(cancel)
        for reader in readers:
            reader.join(timeout=3)
        if process.returncode:
            raise RuntimeError("FFmpeg: " + "\n".join(errors)[-1500:])
        if progress:
            progress(1)
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
