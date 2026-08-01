' Launched by the ZinoltProdServer scheduled task. Runs the .bat with
' SW_HIDE (window mode 0) so the server has NO visible window — closing
' a stray terminal can no longer kill it.
' To stop the server: open Task Manager, find node.exe, End Task.
Set sh = CreateObject("Wscript.Shell")
sh.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\start-zinolt.bat""", 0, False
