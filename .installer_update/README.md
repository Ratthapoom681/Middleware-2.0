# Middleware 2.0 Installer

Bootstrap installer for [Middleware 2.0](https://github.com/Ratthapoom681/Middleware-2.0). It clones a selected release, creates a secure first-run environment, builds the Docker images, starts the stack, and waits for the Hub health check.

The installer defaults to the `V1.4` branch. For reproducible production installations, publish an immutable tag such as `v1.4.0` and pass that tag to the installer.

## Requirements

- Git
- Docker Desktop on Windows, or Docker Engine with Docker Compose v2 on Linux
- Network and Git credentials capable of cloning the main repository

The scripts never store repository credentials and never overwrite an existing installation directory.

## One-command Linux installation

After this installer repository and the main application's `V1.4` branch are published, users can run:

```sh
curl -fsSLO https://raw.githubusercontent.com/Ratthapoom681/Middleware-2.0-Installer/main/install.sh
sudo sh ./install.sh -a
```

The `-a` option installs and starts the complete stack. When executed with `sudo`, the default installation directory is `/opt/middleware-2.0`.

For immutable releases, attach `install.sh` to a GitHub release and use a versioned URL:

```sh
curl -fsSLO https://github.com/Ratthapoom681/Middleware-2.0-Installer/releases/download/v1.4.0/install.sh
sudo sh ./install.sh -a --version v1.4.0
```

A custom package domain can later serve the same release file, for example:

```sh
curl -fsSLO https://packages.example.com/middleware/1.4/install.sh
sudo sh ./install.sh -a --version v1.4.0
```

## Windows installation

Open PowerShell in this installer repository and run:

```powershell
.\install.ps1
```

The default installation directory is `%USERPROFILE%\Middleware-2.0`.

Install a tag or a different branch:

```powershell
.\install.ps1 -Version v1.4.0
```

Choose another destination or repository URL:

```powershell
.\install.ps1 `
  -RepositoryUrl 'git@github.com:Ratthapoom681/Middleware-2.0.git' `
  -InstallDirectory 'D:\Security\Middleware-2.0'
```

Clone and generate `.env` without starting Docker:

```powershell
.\install.ps1 -SkipStart
```

## Linux or macOS installation

```sh
chmod +x install.sh
./install.sh -a
```

Install a tag and choose another destination:

```sh
./install.sh --version v1.4.0 --directory /opt/middleware-2.0
```

Use an SSH repository URL:

```sh
./install.sh --repository git@github.com:Ratthapoom681/Middleware-2.0.git
```

Environment variables can also supply defaults:

```sh
VERSION=v1.4.0 INSTALL_DIRECTORY="$HOME/security-platform" ./install.sh
```

## What the installer does

1. Verifies Git, Docker, and Docker Compose v2.
2. Refuses to overwrite a non-empty destination.
3. Performs a shallow clone of the requested branch or tag.
4. Copies `.env.example` to `.env`.
5. Generates random values for database passwords, JWT signing, the internal auth-service token, and the bootstrap administrator password.
6. Runs `docker compose up -d --build`.
7. Waits up to two minutes for `/api/health`.
8. Prints the application URL and the generated bootstrap administrator password once.

The generated `.env` remains inside the installed application directory and should be backed up securely.

## Private repository access

For HTTPS cloning, authenticate using Git Credential Manager or a short-lived token provided to Git. For SSH cloning, pass the SSH URL and use an SSH agent/key that already has repository access.

Do not place personal access tokens, passwords, or private keys in these scripts or commit them to this repository.

## Version pinning

Branches can move, so production installers should target release tags:

```powershell
# Run in the main application repository
git tag v1.4.0
git push origin v1.4.0
```

Then install that exact release:

```powershell
.\install.ps1 -Version v1.4.0
```

## Operations

View service status:

```powershell
Set-Location "$HOME\Middleware-2.0"
docker compose ps
```

Stop the application without deleting database volumes:

```powershell
docker compose down
```

Rebuild the installed version:

```powershell
docker compose up -d --build
```

The installer intentionally does not provide an automatic uninstall or volume-deletion command because those operations can destroy user and vulnerability data.

## Troubleshooting

- **Clone fails:** verify the repository URL, version, network connection, and Git credentials.
- **Docker command fails:** start Docker and confirm `docker compose version` works.
- **Port already in use:** edit `GATEWAY_PORT` in the installed `.env`, then run `docker compose up -d` again.
- **Health check times out:** run `docker compose ps` and `docker compose logs` in the installed application directory.
