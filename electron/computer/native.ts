export const native_source = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static partial class VantheaXComputer
{
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)] struct Payload { [FieldOffset(0)] public Mouse Mouse; [FieldOffset(0)] public Keyboard Keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public Payload Payload; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint map);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder text, int length, out int needed);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    static uint owner;

    static void Desktop()
    {
        var desktop = OpenInputDesktop(0, false, 1);
        if (desktop == IntPtr.Zero) throw new InvalidOperationException("The input desktop is unavailable or protected");
        try
        {
            int needed;
            var name = new StringBuilder(256);
            if (!GetUserObjectInformation(desktop, 2, name, 512, out needed) || name.ToString() != "Default")
                throw new InvalidOperationException("Computer use cannot control the secure desktop");
        }
        finally { CloseDesktop(desktop); }
    }

    static bool Protected(IntPtr window)
    {
        if (window == IntPtr.Zero) return false;
        var root = GetAncestor(window, 2);
        uint pid;
        GetWindowThreadProcessId(root == IntPtr.Zero ? window : root, out pid);
        if (pid == owner) return true;
        try { return Process.GetProcessById((int)pid).ProcessName.Equals("VantheaX", StringComparison.OrdinalIgnoreCase); }
        catch (ArgumentException) { return true; }
        catch (System.ComponentModel.Win32Exception) { return true; }
    }

    static void Target(int x, int y)
    {
        Desktop();
        if (Protected(WindowFromPoint(new Point { X = x, Y = y })))
            throw new InvalidOperationException("Input into VantheaX or its computer-use indicator is blocked");
    }

    static void Focus()
    {
        Desktop();
        if (Protected(GetForegroundWindow())) throw new InvalidOperationException("Keyboard input is blocked while VantheaX is in the foreground");
    }

    static object Displays()
    {
        Desktop();
        var displays = new List<object>();
        var index = 0;
        foreach (var screen in Screen.AllScreens)
        {
            var box = screen.Bounds;
            displays.Add(new { id = (++index).ToString(), x = box.X, y = box.Y, width = box.Width, height = box.Height, primary = screen.Primary });
        }
        return new { displays = displays };
    }

    static Rectangle Display(string id)
    {
        if (id == "all") return new Rectangle(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        int index;
        var screens = Screen.AllScreens;
        if (!int.TryParse(id, out index) || index < 1 || index > screens.Length) throw new ArgumentException("Display is unavailable");
        return screens[index - 1].Bounds;
    }

    static object Capture(string id, CancellationToken token)
    {
        Desktop();
        token.ThrowIfCancellationRequested();
        var box = Display(id);
        using (var bitmap = new Bitmap(box.Width, box.Height, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var stream = new MemoryStream())
        {
            graphics.CopyFromScreen(box.Location, System.Drawing.Point.Empty, box.Size, CopyPixelOperation.SourceCopy);
            token.ThrowIfCancellationRequested();
            bitmap.Save(stream, ImageFormat.Png);
            return new { x = box.X, y = box.Y, width = box.Width, height = box.Height, png_base64 = Convert.ToBase64String(stream.ToArray()) };
        }
    }

    static void Send(params Input[] input)
    {
        if (SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(Input))) != input.Length)
            throw new InvalidOperationException("SendInput failed with error " + Marshal.GetLastWin32Error() + "; elevated or protected windows may reject input");
    }

    static Input MouseInput(int x, int y, uint flags, uint data)
    {
        return new Input { Type = 0, Payload = new Payload { Mouse = new Mouse { X = x, Y = y, Flags = flags, Data = data } } };
    }

    static void Move(int x, int y)
    {
        Target(x, y);
        var nx = (int)Math.Round((x - GetSystemMetrics(76)) * 65535.0 / Math.Max(1, GetSystemMetrics(78) - 1));
        var ny = (int)Math.Round((y - GetSystemMetrics(77)) * 65535.0 / Math.Max(1, GetSystemMetrics(79) - 1));
        Send(MouseInput(nx, ny, 0xC001, 0));
    }

    static Input KeyInput(int key, bool up)
    {
        var scan = MapVirtualKey((uint)key, 0);
        var extended = (key >= 33 && key <= 46) || key == 91 || key == 92;
        return new Input { Type = 1, Payload = new Payload { Keyboard = new Keyboard { Scan = (ushort)scan, Flags = 8u | (up ? 2u : 0u) | (extended ? 1u : 0u) } } };
    }
}
`;
