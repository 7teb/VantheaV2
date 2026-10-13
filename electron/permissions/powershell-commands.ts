const commands = new Map(
  `
  Add-Computer Add-Content Add-History Add-Member Add-PSSnapin Add-Type Checkpoint-Computer Clear-Content Clear-EventLog Clear-History
  Clear-Host Clear-Item Clear-ItemProperty Clear-RecycleBin Clear-Variable Compare-Object Complete-Transaction Connect-PSSession
  ConvertFrom-Csv ConvertFrom-Json ConvertFrom-SddlString ConvertFrom-SecureString ConvertFrom-String ConvertFrom-StringData Convert-Path
  Convert-String ConvertTo-Csv ConvertTo-Html ConvertTo-Json ConvertTo-SecureString ConvertTo-Xml Copy-Item Copy-ItemProperty Debug-Job
  Debug-Process Debug-Runspace Disable-ComputerRestore Disable-PSBreakpoint Disable-PSRemoting Disable-PSSessionConfiguration
  Disable-RunspaceDebug Disconnect-PSSession Enable-ComputerRestore Enable-PSBreakpoint Enable-PSRemoting Enable-PSSessionConfiguration
  Enable-RunspaceDebug Enter-PSHostProcess Enter-PSSession Exit-PSHostProcess Exit-PSSession Export-Alias Export-Clixml Export-Console
  Export-Csv Export-FormatData Export-ModuleMember Export-PSSession ForEach-Object Format-Custom Format-Hex Format-List Format-Table
  Format-Wide Get-Acl Get-Alias Get-AuthenticodeSignature Get-ChildItem Get-Clipboard Get-CmsMessage Get-Command Get-ComputerInfo
  Get-ComputerRestorePoint Get-Content Get-ControlPanelItem Get-Credential Get-Culture Get-Date Get-Event Get-EventLog Get-EventSubscriber
  Get-ExecutionPolicy Get-FileHash Get-FormatData Get-Help Get-History Get-Host Get-HotFix Get-Item Get-ItemProperty Get-ItemPropertyValue
  Get-Job Get-Location Get-Member Get-Module Get-PfxCertificate Get-Process Get-PSBreakpoint Get-PSCallStack Get-PSDrive Get-PSHostProcessInfo
  Get-PSProvider Get-PSSession Get-PSSessionCapability Get-PSSessionConfiguration Get-PSSnapin Get-Random Get-Runspace Get-RunspaceDebug
  Get-Service Get-TimeZone Get-TraceSource Get-Transaction Get-TypeData Get-UICulture Get-Unique Get-Variable Get-Verb Get-WmiObject
  Group-Object help Import-Alias Import-Clixml Import-Csv Import-LocalizedData Import-Module Import-PowerShellDataFile Import-PSSession
  ImportSystemModules Invoke-Command Invoke-Expression Invoke-History Invoke-Item Invoke-RestMethod Invoke-WebRequest Invoke-WmiMethod
  Join-Path Limit-EventLog Measure-Command Measure-Object mkdir more Move-Item Move-ItemProperty New-Alias New-Event New-EventLog
  New-FileCatalog New-Guid New-Item New-ItemProperty New-Module New-ModuleManifest New-Object New-PSDrive New-PSRoleCapabilityFile
  New-PSSession New-PSSessionConfigurationFile New-PSSessionOption New-PSTransportOption New-Service New-TemporaryFile New-TimeSpan
  New-Variable New-WebServiceProxy oss Out-Default Out-File Out-GridView Out-Host Out-Null Out-Printer Out-String Pause Pop-Location prompt
  Protect-CmsMessage Push-Location Read-Host Receive-Job Receive-PSSession Register-ArgumentCompleter Register-EngineEvent
  Register-ObjectEvent Register-PSSessionConfiguration Register-WmiEvent Remove-Computer Remove-Event Remove-EventLog Remove-Item
  Remove-ItemProperty Remove-Job Remove-Module Remove-PSBreakpoint Remove-PSDrive Remove-PSSession Remove-PSSnapin Remove-TypeData
  Remove-Variable Remove-WmiObject Rename-Computer Rename-Item Rename-ItemProperty Reset-ComputerMachinePassword Resolve-Path Restart-Computer
  Restart-Service Restore-Computer Resume-Job Resume-Service Save-Help Select-Object Select-String Select-Xml Send-MailMessage Set-Acl
  Set-Alias Set-AuthenticodeSignature Set-Clipboard Set-Content Set-Date Set-ExecutionPolicy Set-Item Set-ItemProperty Set-Location
  Set-PSBreakpoint Set-PSDebug Set-PSSessionConfiguration Set-Service Set-StrictMode Set-TimeZone Set-TraceSource Set-Variable Set-WmiInstance
  Show-Command Show-ControlPanelItem Show-EventLog Sort-Object Split-Path Start-Job Start-Process Start-Service Start-Sleep Start-Transaction
  Stop-Computer Stop-Job Stop-Process Stop-Service Suspend-Job Suspend-Service TabExpansion2 Tee-Object Test-ComputerSecureChannel
  Test-Connection Test-FileCatalog Test-ModuleManifest Test-Path Test-PSSessionConfigurationFile Trace-Command Unblock-File Undo-Transaction
  Unprotect-CmsMessage Unregister-Event Unregister-PSSessionConfiguration Update-FormatData Update-Help Update-List Update-TypeData
  Use-Transaction Wait-Debugger Wait-Event Wait-Job Wait-Process Where-Object Write-Debug Write-Error Write-EventLog Write-Host
  Write-Information Write-Output Write-Progress Write-Verbose Write-Warning
`
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => [name.toLowerCase(), name] as const),
);

const aliases = new Map(
  `
  %=ForEach-Object ?=Where-Object ac=Add-Content asnp=Add-PSSnapIn cat=Get-Content cd=Set-Location cfs=ConvertFrom-String chdir=Set-Location
  clc=Clear-Content clear=Clear-Host clhy=Clear-History cli=Clear-Item clp=Clear-ItemProperty cls=Clear-Host clv=Clear-Variable
  cnsn=Connect-PSSession compare=Compare-Object copy=Copy-Item cp=Copy-Item cpi=Copy-Item cpp=Copy-ItemProperty curl=Invoke-WebRequest
  cvpa=Convert-Path dbp=Disable-PSBreakpoint del=Remove-Item diff=Compare-Object dir=Get-ChildItem dnsn=Disconnect-PSSession
  ebp=Enable-PSBreakpoint echo=Write-Output epal=Export-Alias epcsv=Export-Csv epsn=Export-PSSession erase=Remove-Item etsn=Enter-PSSession
  exsn=Exit-PSSession fc=Format-Custom fhx=Format-Hex fl=Format-List foreach=ForEach-Object ft=Format-Table fw=Format-Wide gal=Get-Alias
  gbp=Get-PSBreakpoint gc=Get-Content gci=Get-ChildItem gcm=Get-Command gcs=Get-PSCallStack gdr=Get-PSDrive ghy=Get-History gi=Get-Item
  gjb=Get-Job gl=Get-Location gm=Get-Member gmo=Get-Module gp=Get-ItemProperty gps=Get-Process gpv=Get-ItemPropertyValue group=Group-Object
  gsn=Get-PSSession gsnp=Get-PSSnapIn gsv=Get-Service gu=Get-Unique gv=Get-Variable gwmi=Get-WmiObject h=Get-History history=Get-History
  icm=Invoke-Command iex=Invoke-Expression ihy=Invoke-History ii=Invoke-Item ipal=Import-Alias ipcsv=Import-Csv ipmo=Import-Module
  ipsn=Import-PSSession irm=Invoke-RestMethod iwmi=Invoke-WMIMethod iwr=Invoke-WebRequest kill=Stop-Process lp=Out-Printer ls=Get-ChildItem
  man=help md=mkdir measure=Measure-Object mi=Move-Item mount=New-PSDrive move=Move-Item mp=Move-ItemProperty mv=Move-Item nal=New-Alias
  ndr=New-PSDrive ni=New-Item nmo=New-Module npssc=New-PSSessionConfigurationFile nsn=New-PSSession nv=New-Variable ogv=Out-GridView
  oh=Out-Host popd=Pop-Location ps=Get-Process pushd=Push-Location pwd=Get-Location r=Invoke-History rbp=Remove-PSBreakpoint rcjb=Receive-Job
  rcsn=Receive-PSSession rd=Remove-Item rdr=Remove-PSDrive ren=Rename-Item ri=Remove-Item rjb=Remove-Job rm=Remove-Item rmdir=Remove-Item
  rmo=Remove-Module rni=Rename-Item rnp=Rename-ItemProperty rp=Remove-ItemProperty rsn=Remove-PSSession rsnp=Remove-PSSnapin rujb=Resume-Job
  rv=Remove-Variable rvpa=Resolve-Path rwmi=Remove-WMIObject sajb=Start-Job sal=Set-Alias saps=Start-Process sasv=Start-Service
  sbp=Set-PSBreakpoint sc=Set-Content select=Select-Object set=Set-Variable shcm=Show-Command si=Set-Item sl=Set-Location sleep=Start-Sleep
  sls=Select-String sort=Sort-Object sp=Set-ItemProperty spjb=Stop-Job spps=Stop-Process spsv=Stop-Service start=Start-Process
  sujb=Suspend-Job sv=Set-Variable swmi=Set-WMIInstance tee=Tee-Object trcm=Trace-Command type=Get-Content wget=Invoke-WebRequest
  where=Where-Object wjb=Wait-Job write=Write-Output
`
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => entry.split("=") as [string, string]),
);

export const powershell_command = (name: string): string | null => {
  const key = name.toLowerCase();
  return aliases.get(key) ?? commands.get(key) ?? null;
};
