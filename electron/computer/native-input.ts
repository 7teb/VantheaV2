export const input_source = String.raw`
public static partial class VantheaXComputer
{
    static int Number(Dictionary<string, object> args, string name) { return Convert.ToInt32(args[name]); }
    static string Text(Dictionary<string, object> args, string name) { return Convert.ToString(args[name]); }
    static int[] Keys(Dictionary<string, object> args, string name)
    {
        var items = (System.Collections.IList)args[name];
        var keys = new int[items.Count];
        for (var index = 0; index < keys.Length; index++) keys[index] = Convert.ToInt32(items[index]);
        return keys;
    }

    static void CheckKeys()
    {
        foreach (var key in new[] { 16, 17, 18, 91, 92 })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new InvalidOperationException("Release held modifier keys before computer input");
    }

    static void Release(List<int> keys)
    {
        for (var index = keys.Count - 1; index >= 0; index--) Send(KeyInput(keys[index], true));
    }

    static void Press(int[] keys, CancellationToken token)
    {
        CheckKeys();
        var pressed = new List<int>();
        try
        {
            foreach (var key in keys)
            {
                token.ThrowIfCancellationRequested();
                Focus();
                pressed.Add(key);
                Send(KeyInput(key, false));
            }
        }
        finally { Release(pressed); }
    }

    static void TypeText(string text, CancellationToken token)
    {
        CheckKeys();
        foreach (var unit in text)
        {
            token.ThrowIfCancellationRequested();
            Focus();
            var down = new Input { Type = 1, Payload = new Payload { Keyboard = new Keyboard { Scan = unit, Flags = 4 } } };
            var up = down;
            up.Payload.Keyboard.Flags |= 2;
            Send(down, up);
        }
    }

    static uint Down(string button) { return button == "right" ? 8u : button == "middle" ? 32u : 2u; }

    static void Click(Dictionary<string, object> args, CancellationToken token)
    {
        var x = Number(args, "x");
        var y = Number(args, "y");
        var keys = Keys(args, "modifiers");
        var pressed = new List<int>();
        CheckKeys();
        Move(x, y);
        var down = Down(Text(args, "button"));
        try
        {
            foreach (var key in keys)
            {
                token.ThrowIfCancellationRequested();
                Focus();
                pressed.Add(key);
                Send(KeyInput(key, false));
            }
            for (var index = 0; index < Number(args, "count"); index++)
            {
                token.ThrowIfCancellationRequested();
                Target(x, y);
                Send(MouseInput(0, 0, down, 0), MouseInput(0, 0, down * 2, 0));
                Thread.Sleep(40);
            }
        }
        finally { Release(pressed); }
    }

    static void Drag(Dictionary<string, object> args, CancellationToken token)
    {
        CheckKeys();
        var x = Number(args, "x");
        var y = Number(args, "y");
        var target_x = Number(args, "to_x");
        var target_y = Number(args, "to_y");
        var down = Down(Text(args, "button"));
        Target(target_x, target_y);
        Move(x, y);
        try
        {
            token.ThrowIfCancellationRequested();
            Send(MouseInput(0, 0, down, 0));
            for (var index = 1; index <= 20; index++)
            {
                token.ThrowIfCancellationRequested();
                Move(x + (target_x - x) * index / 20, y + (target_y - y) * index / 20);
                Thread.Sleep(12);
            }
        }
        finally { Send(MouseInput(0, 0, down * 2, 0)); }
    }

    static object Perform(Dictionary<string, object> args, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        switch (Text(args, "op"))
        {
            case "displays": return Displays();
            case "screenshot": return Capture(Text(args, "display"), token);
            case "move": Move(Number(args, "x"), Number(args, "y")); break;
            case "click": Click(args, token); break;
            case "drag": Drag(args, token); break;
            case "type": TypeText(Text(args, "text"), token); break;
            case "key": Press(Keys(args, "keys"), token); break;
            case "scroll":
                CheckKeys();
                Focus();
                Move(Number(args, "x"), Number(args, "y"));
                if (Number(args, "dy") != 0) Send(MouseInput(0, 0, 0x0800, unchecked((uint)Number(args, "dy"))));
                if (Number(args, "dx") != 0) Send(MouseInput(0, 0, 0x1000, unchecked((uint)Number(args, "dx"))));
                break;
            default: throw new ArgumentException("Unknown computer operation");
        }
        return new { };
    }
}
`;
