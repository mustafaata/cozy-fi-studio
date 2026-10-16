"""Bound CPU/native/network work by an absolute deadline and explicit cancellation."""
import multiprocessing
import os
from pathlib import Path
import signal
import subprocess
import time
import logging
from security import public_error


def _execute(sender,target,args):
    if os.name!='nt':os.setsid()
    try:sender.send((True,target(*args)))
    except Exception as error:sender.send((False,public_error(error)))
    finally:sender.close()


def _stop(process):
    if not process.is_alive():return
    if os.name=='nt':
        # The owned Process handle prevents PID reuse until close(). Kill FFmpeg
        # descendants too; terminating Python alone would leave them running.
        command=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/taskkill.exe'
        try:
            subprocess.run([str(command),'/PID',str(process.pid),'/T','/F'],capture_output=True,
                           creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=10)
        except (subprocess.SubprocessError,OSError) as error:
            logging.getLogger(__name__).error('Worker tree termination failed (%s)',type(error).__name__)
    else:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass  # The worker already exited.
    if process.is_alive():process.kill()
    process.join(timeout=10)


def run_isolated(target,args=(),cancel=None,timeout=180):
    deadline=time.monotonic()+timeout
    context=multiprocessing.get_context('spawn')
    receiver,sender=context.Pipe(duplex=False)
    process=context.Process(target=_execute,args=(sender,target,args),daemon=True)
    try:
        if cancel is not None and cancel.is_set():raise ValueError('İşlem iptal edildi.')
        process.start();sender.close()
        while True:
            if cancel is not None and cancel.is_set():raise ValueError('İşlem iptal edildi.')
            if time.monotonic()>=deadline:raise ValueError('İşlem süre sınırı aşıldı.')
            if receiver.poll(.1):
                try:ok,result=receiver.recv()
                except EOFError:raise ValueError('İşlem beklenmedik biçimde durdu.') from None
                if not ok:raise ValueError(result)
                return result
            if not process.is_alive():raise ValueError('İşlem beklenmedik biçimde durdu.')
    finally:
        if process.pid is not None:
            process.join(timeout=.2)
            if process.is_alive():_stop(process)
            process.close()
        receiver.close();sender.close()
