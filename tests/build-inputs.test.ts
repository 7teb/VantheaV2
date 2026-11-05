import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { build_description, build_references, input_values } from "../electron/permissions/build-inputs.ts";
import { fixture } from "./sources-fixture.ts";

test("response files need a quote in PowerShell, while cmd and posix take a bare @path", () => {
  assert.deepEqual(input_values(["@build.rsp"], true, "powershell"), ["build.rsp"]);
  assert.deepEqual(input_values(["@args"], false, "powershell"), []);
  assert.deepEqual(input_values(["@args"], false, "unknown"), []);
  assert.deepEqual(input_values(["@build.rsp"], false, "cmd"), ["build.rsp"]);
  assert.deepEqual(input_values(["@flags.txt"], false, "posix"), ["flags.txt"]);
  assert.deepEqual(input_values(["@"], true, "powershell"), []);
});

test("build descriptions are recognized by format, never by program", () => {
  for (const file of ["probe.sln", "probe.slnx", "probe.vcxproj", "app.csproj", "lib.fsproj", "dirs.proj", "Directory.Build.props", "custom.targets", "toolchain.cmake", "rules.mk", "CMakeLists.txt", "Makefile", "makefile", "GNUmakefile", "build.ninja", "meson.build", "sub\\probe.vcxproj"]) {
    assert.ok(build_description(file), file);
  }
  for (const file of ["main.cpp", "stub.asm", "build.rsp", "project", "cmakelists.txt.bak", "notes.md", "Makefile.txt"]) assert.ok(!build_description(file), file);
  assert.deepEqual(input_values(["probe.sln", "/m", "main.cpp"], false, "powershell"), ["probe.sln"]);
});

test("solution project lines, literal imports and project references are references, $(...) and wildcards are skipped", async () => {
  const root = await fs.realpath(await fixture({
    "probe.sln": [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      'Project("{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}") = "probe", "src\\probe.vcxproj", "{A}"',
      "EndProject",
      'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{B}"',
      "EndProject",
      'Project("{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}") = "gone", "gone\\gone.vcxproj", "{C}"',
    ].join("\r\n"),
    "src/probe.vcxproj": [
      "<Project>",
      '  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.Default.props" />',
      '  <Import Project="..\\shared\\common.props" />',
      '  <Import Project="..\\shared\\*.targets" />',
      '  <ItemGroup><ProjectReference Include="..\\lib\\lib.vcxproj" /><ProjectReference Include="$(SolutionDir)x.vcxproj" /></ItemGroup>',
      "</Project>",
    ].join("\n"),
    "shared/common.props": "<Project />",
    "lib/lib.vcxproj": "<Project />",
    "probe.slnx": '<Solution><Project Path="src/probe.vcxproj" /><Project Path="$(Root)x.vcxproj" /></Solution>',
  }));
  const sln = await build_references(await fs.readFile(path.join(root, "probe.sln"), "utf8"), path.join(root, "probe.sln"), root);
  assert.deepEqual(sln, { files: [path.join(root, "src", "probe.vcxproj")], gaps: [] });
  const slnx = await build_references(await fs.readFile(path.join(root, "probe.slnx"), "utf8"), path.join(root, "probe.slnx"), root);
  assert.deepEqual(slnx.files, [path.join(root, "src", "probe.vcxproj")]);
  const project = await build_references(await fs.readFile(path.join(root, "src", "probe.vcxproj"), "utf8"), path.join(root, "src", "probe.vcxproj"), root);
  assert.deepEqual(project.files, [path.join(root, "shared", "common.props"), path.join(root, "lib", "lib.vcxproj")]);
});

test("Directory.Build files come from the nearest folder up to the project root and never above it", async () => {
  const parent = await fs.realpath(await fixture({ "Directory.Build.props": "<Project />", "repo/Directory.Build.targets": "<Project />", "repo/src/deep/probe.vcxproj": "<Project />" }));
  const root = path.join(parent, "repo");
  const project = path.join(root, "src", "deep", "probe.vcxproj");
  const found = await build_references("<Project />", project, root);
  assert.deepEqual(found.files, [path.join(root, "Directory.Build.targets")]);
  await fs.writeFile(path.join(root, "src", "Directory.Build.props"), "<Project />");
  assert.deepEqual((await build_references("<Project />", project, root)).files, [path.join(root, "src", "Directory.Build.props"), path.join(root, "Directory.Build.targets")]);
  assert.deepEqual((await build_references("<Project />", path.join(root, "src", "a.props"), root)).files, []);
});
