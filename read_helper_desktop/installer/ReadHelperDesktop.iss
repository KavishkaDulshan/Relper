[Setup]
AppId={{4A2E8F2D-90A8-48DE-AF32-E2B5F65C46A7}
AppName=Relper Desktop
AppVersion=1.0.0
AppPublisher=Relper
DefaultDirName={autopf}\Relper Desktop
DefaultGroupName=Relper Desktop
OutputBaseFilename=RelperDesktop-Setup
OutputDir=..\dist\installer
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Files]
Source: "..\dist\ReadHelperDesktop\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Relper Desktop"; Filename: "{app}\ReadHelperDesktop.exe"
Name: "{autodesktop}\Relper Desktop"; Filename: "{app}\ReadHelperDesktop.exe"

[Run]
Filename: "{app}\ReadHelperDesktop.exe"; Description: "Launch Relper Desktop"; Flags: nowait postinstall skipifsilent
