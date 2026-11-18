"""Tiny helper: print the folder chosen in a native Windows folder dialog.

ComfyUI's embedded Python has no tkinter, so the media panel asks a system
Python that does.  The transient Tk root stays withdrawn; only the native
folder chooser is visible.  An empty stdout means the user cancelled.

The chooser is lifted to topmost/foreground once when it appears: the server
that launches this helper has no visible window of its own, so without this the
dialog opens behind the browser and looks like the click did nothing. It is
done only once (no continuous polling) so it never keeps stealing focus or
interfering with typing inside the dialog.
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

_raised = False
_max_wait_ticks = 50  # 100ms * 50 = 5s ceiling waiting for the dialog window


def _raise_once() -> None:
    """Lift the chooser to topmost/foreground exactly once, then stop.

    The native dialog window is only created after askdirectory() starts, so
    the first few ticks may find nothing — keep checking until it appears (or
    we hit the ceiling), then do the topmost/foreground lift once and never
    schedule another tick. Enumerating by PID (not a fixed class/title) copes
    with the modern IFileDialog recreating its window and with a class name
    other than the classic '#32770'.
    """
    global _raised
    if _raised:
        return
    pid = os.getpid()
    found = []

    def visit(hwnd, _lparam):
        wp = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wp))
        if wp.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(visit), 0)

    if not found:
        # Dialog not up yet; wait a little more (bounded), then give up.
        global _max_wait_ticks
        _max_wait_ticks -= 1
        if _max_wait_ticks > 0:
            root.after(100, _raise_once)
        return

    for hwnd in found:
        user32.ShowWindow(hwnd, _SW_RESTORE)
        user32.SetWindowPos(
            hwnd, _HWND_TOPMOST, 0, 0, 0, 0,
            _SWP_NOMOVE | _SWP_NOSIZE | _SWP_SHOWWINDOW,
        )
        user32.BringWindowToTop(hwnd)

    # A synthetic ALT satisfies Windows' foreground lock so a background
    # process can focus the dialog; done once, not on a timer.
    hwnd = user32.FindWindowW("#32770", TITLE) or found[0]
    if user32.GetForegroundWindow() != hwnd:
        user32.keybd_event(_VK_MENU, 0, 0, None)
        user32.keybd_event(_VK_MENU, 0, _KEYEVENTF_KEYUP, None)
        user32.SetForegroundWindow(hwnd)

    _raised = True


root.after(100, _raise_once)
try:
    folder = filedialog.askdirectory(
        title=TITLE,
        initialdir=initial or None,
        parent=root,
    )
finally:
    root.destroy()

if folder:
    print(folder)
