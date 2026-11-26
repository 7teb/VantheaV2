import os from "node:os";
import path from "node:path";

process.env.USERPROFILE = path.join(os.tmpdir(), "vx-test-home-without-config");
process.env.HOME = process.env.USERPROFILE;
