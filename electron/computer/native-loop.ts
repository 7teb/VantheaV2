export const loop_source = String.raw`
public static partial class VantheaXComputer
{
    static readonly object writing = new object();
    static readonly object state = new object();
    static readonly ManualResetEvent finished = new ManualResetEvent(true);
    static CancellationTokenSource active;

    static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 134217728, RecursionLimit = 32 }; }

    static void Reply(object value)
    {
        lock (writing)
        {
            Console.WriteLine(Serializer().Serialize(value));
            Console.Out.Flush();
        }
    }

    public static void Run(uint process)
    {
        owner = process;
        if (!SetProcessDpiAwarenessContext(new IntPtr(-4)))
            throw new InvalidOperationException("Could not enable per-monitor DPI awareness");
        Reply(new { ready = true });
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                var request = Serializer().Deserialize<Dictionary<string, object>>(line);
                var operation = Text(request, "op");
                if (operation == "cancel" || operation == "quit")
                {
                    lock (state) { if (active != null) active.Cancel(); }
                    if (operation == "quit") break;
                    continue;
                }
                var id = Number(request, "id");
                CancellationTokenSource cancellation;
                lock (state)
                {
                    if (active != null)
                    {
                        Reply(new { id = id, ok = false, error = "Another computer operation is still running" });
                        continue;
                    }
                    active = cancellation = new CancellationTokenSource();
                    finished.Reset();
                }
                ThreadPool.QueueUserWorkItem(delegate
                {
                    object response;
                    try { response = new { id = id, ok = true, value = Perform(request, cancellation.Token) }; }
                    catch (Exception error) { response = new { id = id, ok = false, error = error.Message }; }
                    lock (state) { active = null; cancellation.Dispose(); finished.Set(); }
                    try { Reply(response); }
                    catch (IOException error) { Console.Error.WriteLine("Computer helper output failed: " + error.Message); }
                });
            }
        }
        finally
        {
            lock (state) { if (active != null) active.Cancel(); }
            finished.WaitOne(3000);
        }
    }
}
`;
