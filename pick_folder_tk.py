"""Tiny helper: print the folder chosen in a native Windows folder dialog.

ComfyUI's embedded Python has no tkinter, so the media panel asks a system
Python that does.  The transient Tk root stays withdrawn; only the native
folder chooser is visible.  An empty stdout means the user cancelled.

The chooser is forced topmost/foreground for as long as it is open: the server
that launches this helper has no visible window of its own, so without this the
dialog opens behind the browser and looks like the click did nothing.
"""
from __future__ import annotations

import ctypes
import os
import sys
import tkinter as tk
from ctypes import wintypes
from tkinter import filedialog

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TITLE = "选择媒体存放文件夹"
initial = sys.argv[1] if len(sys.argv) > 1 else ""

root = tk.Tk()
root.withdraw()
root.update()

user32 = ctypes.windll.user32

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
user32.FindWindowW.restype = ctypes.c_void_p
user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
user32.SetWindowPos.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint,
]
user32.BringWindowToTop.argtypes = [ctypes.c_void_p]
user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
user32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_uint, ctypes.c_void_p]
user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = ctypes.c_void_p
user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]

_HWND_TOPMOST = ctypes.c_void_p(-1)
_SW_RESTORE = 9
_SWP_NOSIZE = 0x0001
_SWP_NOMOVE = 0x0002
_SWP_SHOWWINDOW = 0x0040
_VK_MENU = 0x12  # ALT - a keystroke releases Windows' foreground lock
_KEYEVENTF_KEYUP = 0x0002

_running = True
_ticks = 0


def _raise_all() -> None:
    """Keep every visible top-level window of this process topmost.

    Enumerating by PID (instead of matching one fixed class/title) survives the
    modern IFileDialog recreating its window, and covers the case where the
    chooser's class name is not the classic '#32770'.
    """
    global _ticks
    if not _running:
        return
    _ticks += 1
    pid = os.getpid()
    found = []

    def visit(hwnd, _lparam):
        wp = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wp))
        if wp.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(visit), 0)

    for hwnd in found:
        user32.ShowWindow(hwnd, _SW_RESTORE)
        user32.SetWindowPos(
            hwnd, _HWND_TOPMOST, 0, 0, 0, 0,
            _SWP_NOMOVE | _SWP_NOSIZE | _SWP_SHOWWINDOW,
        )
        user32.BringWindowToTop(hwnd)

    # topmost alone can still look "behind" the browser: the dialog keeps no
    # focus, so clicking around leaves the browser painted over it. Steal the
    # foreground whenever the chooser is not it. SetForegroundWindow from a
    # background process is normally refused -- a synthetic ALT keypress
    # satisfies Windows' foreground-lock requirement. Throttle the keystroke
    # to once every ~1s so it never interferes with typing in the dialog.
    if found:
        hwnd = user32.FindWindowW("#32770", TITLE) or found[0]
        if user32.GetForegroundWindow() != hwnd:
            if _ticks % 10 == 1:
                user32.keybd_event(_VK_MENU, 0, 0, None)
                user32.keybd_event(_VK_MENU, 0, _KEYEVENTF_KEYUP, None)
            user32.SetForegroundWindow(hwnd)

    root.after(100, _raise_all)


root.after(100, _raise_all)
try:
    folder = filedialog.askdirectory(
        title=TITLE,
        initialdir=initial or None,
        parent=root,
    )
finally:
    _running = False
    root.destroy()

if folder:
    print(folder)
