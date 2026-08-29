# -*- coding: utf-8 -*-
"""Windows sensor readers: CPU, physical memory, disk, and GPU via ctypes / nvidia-smi.

Zero third-party dependencies. All Windows calls go through ctypes and run only
on Windows; on other platforms the read functions return None so callers can
gracefully fall back.
"""

import ctypes
import os
import subprocess

_kernel32 = ctypes.windll.kernel32


class _FILETIME(ctypes.Structure):
    _fields_ = [("lo", ctypes.c_uint32), ("hi", ctypes.c_uint32)]


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_uint32),
        ("load", ctypes.c_uint32),
        ("total_phys", ctypes.c_uint64),
        ("avail_phys", ctypes.c_uint64),
        ("total_page", ctypes.c_uint64),
        ("avail_page", ctypes.c_uint64),
        ("total_virtual", ctypes.c_uint64),
        ("avail_virtual", ctypes.c_uint64),
        ("avail_ext", ctypes.c_uint64),
    ]


def _read_cpu_times():
    """Return (idle, kernel, user) 64-bit tick counters, or None on failure."""
    idle, kern, user = _FILETIME(), _FILETIME(), _FILETIME()
    if not _kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user)):
        return None
    return (
        (idle.hi << 32) | idle.lo,
        (kern.hi << 32) | kern.lo,
        (user.hi << 32) | user.lo,
    )


def _read_physical_memory():
    """Snapshot of physical RAM as {used_gb, total_gb, percent}, or None."""
    s = _MEMORYSTATUSEX()
    s.length = ctypes.sizeof(_MEMORYSTATUSEX)
    if not _kernel32.GlobalMemoryStatusEx(ctypes.byref(s)):
        return None
    total = s.total_phys / (1024 ** 3)
    used = (s.total_phys - s.avail_phys) / (1024 ** 3)
    return {"used_gb": round(used, 1), "total_gb": round(total, 1), "percent": s.load}


def _read_disk_space():
    """Free space on the system drive as {name, free_gb, total_gb}, or None."""
    drive = os.path.splitdrive(os.path.abspath(__file__))[0] + "\\"
    total = ctypes.c_ulonglong()
    free = ctypes.c_ulonglong()
    if not _kernel32.GetDiskFreeSpaceExW(ctypes.c_wchar_p(drive), None, ctypes.byref(total), ctypes.byref(free)):
        return None
    return {
        "name": drive,
        "free_gb": round(free.value / (1024 ** 3), 1),
        "total_gb": round(total.value / (1024 ** 3), 1),
    }


def _to_float(text):
    """Parse a float, returning 0.0 for None / non-numeric nvidia-smi cells."""
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def _read_gpu():
    """Per-GPU utilization / VRAM / temperature from nvidia-smi, or None.

    Launches nvidia-smi in a hidden window with a 3s timeout; returns a list of
    dicts (one per GPU) or None when no NVIDIA GPU is present or the call fails.
    """
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None
    gpus = []
    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        gpus.append({
            "name": parts[0],
            "usage": _to_float(parts[1]),
            "vram_used_gb": round(_to_float(parts[2]) / 1024.0, 1),
            "vram_total_gb": round(_to_float(parts[3]) / 1024.0, 1),
            "temp": _to_float(parts[4]),
        })
    return gpus or None
