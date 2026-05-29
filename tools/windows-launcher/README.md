# Mission Control Windows Launcher

This folder provides a Windows-friendly local launcher for Mission Control.

It does not turn Mission Control into a desktop app. It starts the existing local web app safely:

1. Checks Node, npm, Docker, and the repo-local `.env`.
2. Starts Docker Desktop if it can find it.
3. Runs `docker compose up -d`.
4. Waits for Postgres and Redis.
5. Runs `npm install` only when dependencies appear missing or the lockfile changed.
6. Runs `npm run db:migrate`.
7. Prompts before running `npm run seed:mission-control-demo`.
8. Starts `npm run dev` in a visible PowerShell window.
9. Opens `http://localhost:5173/#home` in the default browser.

## Run It

Double-click:

```text
tools\windows-launcher\start-mission-control.cmd
```

Or run from PowerShell:

```powershell
tools\windows-launcher\start-mission-control.ps1
```

Useful options:

```powershell
tools\windows-launcher\start-mission-control.ps1 -SeedDemo
tools\windows-launcher\start-mission-control.ps1 -SkipInstall
tools\windows-launcher\start-mission-control.ps1 -NoBrowser
```

## Logs

Launcher and dev-server logs are written outside the repo:

```text
%LOCALAPPDATA%\MissionControl\logs
```

## Optional EXE Wrapper

The `.cmd` file is the safest default. If you want a true `.exe` wrapper, build it with the local .NET SDK:

```powershell
tools\windows-launcher\build-launcher-exe.ps1
```

The output is:

```text
tools\windows-launcher\dist\MissionControlLauncher.exe
```

That exe only starts the PowerShell launcher. It does not bundle Node, Docker, Postgres, Redis, or the Mission Control app.

## Required Prerequisites

- The repo folder, usually `C:\Dev\Codex-integrated-baseline`
- Repo-local `.env`
- Node.js 20 or newer
- npm
- Docker Desktop
- Local Postgres and Redis containers managed by this repo's `docker-compose.yml`

## Safety Notes

- The launcher never prints `.env` contents.
- The launcher does not reset the database.
- Demo seeding is prompted unless `-SeedDemo` is provided.
- Docker Desktop must already be installed.
- Postgres and Redis are not packaged into the exe.
