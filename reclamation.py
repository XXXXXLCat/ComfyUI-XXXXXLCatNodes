# -*- coding: utf-8 -*-
"""Resource reclamation engine: VRAM sweep and physical-RAM trimming.

Both operations are declarative step lists so that a failure in one stage is
logged and skipped instead of aborting the whole cleanup. RAM trimming relies
on Windows ctypes APIs and is a no-op on other platforms.
"""

import ctypes
import gc
import platform
import time

import torch
import comfy.model_management

from . import sensors


def _on_windows():
    """True when running on Windows (the only platform with the ctypes trim APIs)."""
    return platform.system() == "Windows"


def _vram_allocated():
    """Currently allocated VRAM in bytes, or None when CUDA is unavailable."""
    try:
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated()
    except Exception:
        pass
    return None


def _squeeze_cuda():
    """Release every CUDA cache layer ComfyUI exposes."""
    torch.cuda.synchronize()
    torch.cuda.empty_cache()
    torch.cuda.ipc_collect()


def _release_vram(*, unload_models, sweep_cache):
    """Free GPU VRAM via a staged plan; one failed stage never stops the rest.

    Returns (before, after) byte counts. Stages are unload-all-models and, when
    cache sweeping is enabled, gc + soft cache purge + CUDA squeeze + wrapper
    drop.
    """
    before = _vram_allocated()
    plan = []
    if unload_models:
        plan.append(("unload models", comfy.model_management.unload_all_models))
    if sweep_cache:
        plan += [
            ("gc", gc.collect),
            ("soft cache", lambda: comfy.model_management.soft_empty_cache(True)),
            ("cuda squeeze", _squeeze_cuda),
            ("drop wrappers", comfy.model_management.cleanup_models),
        ]
    for label, step in plan:
        try:
            step()
        except Exception as exc:
            print(f"[XXXXXLCat] VRAM step '{label}' skipped: {exc}")
    after = _vram_allocated()
    return before, after


def _trim_system_file_cache():
    """Ask Windows to reset the system file cache to its working-set minimum."""
    try:
        sensors._kernel32.SetSystemFileCacheSize(-1, -1, 0)
    except Exception:
        pass


def _trim_working_sets():
    """Trim the working set of every running process (Windows, Toolhelp32, zero deps)."""
    psapi = ctypes.windll.psapi

    class _PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", ctypes.c_uint32),
            ("cntUsage", ctypes.c_uint32),
            ("th32ProcessID", ctypes.c_uint32),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_uint32)),
            ("th32ModuleID", ctypes.c_uint32),
            ("cntThreads", ctypes.c_uint32),
            ("th32ParentProcessID", ctypes.c_uint32),
            ("pcPriClassBase", ctypes.c_int32),
            ("dwFlags", ctypes.c_uint32),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    TH32CS_SNAPPROCESS = 0x2
    PROCESS_ALL_ACCESS = 0x001F0FFF
    snap = sensors._kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == -1:
        return
    try:
        entry = _PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
        if not sensors._kernel32.Process32FirstW(snap, ctypes.byref(entry)):
            return
        while True:
            try:
                handle = sensors._kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, entry.th32ProcessID)
                if handle:
                    psapi.EmptyWorkingSet(handle)
                    sensors._kernel32.CloseHandle(handle)
            except Exception:
                pass
            if not sensors._kernel32.Process32NextW(snap, ctypes.byref(entry)):
                break
    finally:
        sensors._kernel32.CloseHandle(snap)


def _trim_own_working_set():
    """Trim this process's own working set and DLLs (Windows only)."""
    try:
        sensors._kernel32.SetProcessWorkingSetSize(-1, -1, -1)
    except Exception:
        pass


def _reclaim_ram(*, trim_cache, trim_processes, trim_dlls, passes):
    """Reclaim physical RAM by repeating the selected trim passes.

    Returns (before, after) snapshots. Each selected pass is Windows-only and is
    skipped on other platforms; the repeat count comes from retry_times.
    """
    before = sensors._read_physical_memory()
    for _ in range(max(1, int(passes))):
        if trim_cache and _on_windows():
            _trim_system_file_cache()
        if trim_processes and _on_windows():
            _trim_working_sets()
        if trim_dlls and _on_windows():
            _trim_own_working_set()
        time.sleep(1)
    after = sensors._read_physical_memory()
    return before, after
