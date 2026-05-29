using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;

static string? FindScript(string startDirectory)
{
    var current = new DirectoryInfo(startDirectory);
    while (current != null)
    {
        var candidate = Path.Combine(current.FullName, "tools", "windows-launcher", "start-mission-control.ps1");
        if (File.Exists(candidate))
        {
            return candidate;
        }

        candidate = Path.Combine(current.FullName, "start-mission-control.ps1");
        if (File.Exists(candidate))
        {
            return candidate;
        }

        current = current.Parent;
    }

    return null;
}

var executableDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? Environment.CurrentDirectory;
var scriptPath = FindScript(executableDirectory) ?? FindScript(Environment.CurrentDirectory);

if (scriptPath == null)
{
    MessageBox.Show(
        "Mission Control could not find start-mission-control.ps1. Keep the launcher inside the repo or next to the PowerShell script.",
        "Mission Control Launcher",
        MessageBoxButtons.OK,
        MessageBoxIcon.Error
    );
    return 1;
}

var arguments = string.Join(" ", args.Select(arg => "\"" + arg.Replace("\"", "\\\"") + "\""));
var startInfo = new ProcessStartInfo
{
    FileName = "powershell.exe",
    Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{scriptPath}\" {arguments}",
    UseShellExecute = true,
    WorkingDirectory = Path.GetDirectoryName(scriptPath) ?? executableDirectory
};

Process.Start(startInfo);
return 0;
