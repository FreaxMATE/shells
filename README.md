# Shells - Nix Flake Environment SwitcherConfigure the extension via VS Code settings:

- `shells.autoActivate`: Automatically activate Nix flake environment when opening a workspace (default: `false`)
- `shells.flakePath`: Path to the flake.nix file (relative to workspace root). Leave empty to auto-detect.VS Code extension that allows you to switch your development environment to a Nix flake-based environment by detecting and activating flake.nix files in your workspace.

## Features

- **Auto-detection**: Automatically detects `flake.nix` files in your workspace
- **Status Bar Integration**: Shows the current flake status in the status bar
- **Quick Selection**: Easily select from multiple flakes if your workspace contains several
- **System-Wide Integration**: Activates the flake environment for the entire VS Code workspace
  - All integrated terminals automatically use the flake environment
  - Build tasks and commands use tools from the flake
  - Debuggers and language servers use the flake's interpreter/compiler
- **Auto-activation**: Optional automatic activation when opening a workspace

## Requirements

- [Nix](https://nixos.org/) must be installed on your system
- Nix flakes must be enabled in your Nix configuration

## Usage

### Commands

The extension provides the following commands (accessible via Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Shells: Enter Nix Flake Environment**: Activates the detected or selected flake in the entire workspace
- **Shells: Exit Nix Flake Environment**: Deactivates the flake environment
- **Shells: Select Nix Flake**: Choose which flake.nix to use if multiple are present

### Status Bar

The extension adds a status bar item on the left side:
- `$(package) Nix: <flake-name>` - Flake detected but not active (click to select/activate)
- `$(check) Nix: <flake-name>` - Flake environment is active
- `$(package) No Flake` - No flake.nix found in workspace

Click the status bar item to select a different flake.

### Configuration

Configure the extension via VS Code settings:

- `shells.autoActivate`: Automatically activate the Nix flake environment when opening a workspace (default: `false`)
- `shells.flakePath`: Path to the flake.nix file relative to workspace root. Leave empty to auto-detect.

## How It Works

1. When you open a workspace, the extension searches for `flake.nix` files
2. If found, it displays the flake status in the status bar
3. Click the status bar or run the "Enter Nix Flake Environment" command to activate
4. The extension:
   - Extracts all environment variables from `nix develop`
   - Configures VS Code's integrated terminal to use these variables
   - Updates the workspace settings so all tools (compilers, interpreters, formatters) use the flake environment
5. All new terminals and tasks automatically use the flake environment
6. Build buttons, debuggers, and language servers now use tools from your flake

**Result**: Your entire VS Code instance behaves as if it's running inside `nix develop`!

## Example

If your workspace has a `flake.nix` like this:

```nix
{
  description = "My development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodejs_20
          python3
          git
        ];
      };
    };
}
```

The extension will detect it and allow you to enter an environment with Node.js 20, Python 3, and Git available.

## Development

This extension is built with:
- TypeScript
- VS Code Extension API
- esbuild for bundling

To develop:

```bash
# Enter the development environment (using its own flake!)
nix develop

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run in Extension Development Host
Press F5 in VS Code
```

## Packaging and Installation

To package and install the extension locally:

### 1. Package the Extension

```bash
# Enter the development environment
nix develop

# Package the extension (creates a .vsix file)
# On NixOS, use npx instead of global install:
npx @vscode/vsce package
```

This will create a file named `shells-0.0.1.vsix` in the current directory.

**Note for NixOS users**: Global npm installs (`npm install -g`) don't work well on NixOS. Use `npx` to run vsce directly, which downloads and runs the tool without global installation.

### 2. Install the Extension

You have several options to install the packaged extension:

#### Option A: Via Command Line
```bash
code --install-extension shells-0.0.1.vsix
```

#### Option B: Via VS Code UI
1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click the `...` menu at the top of the Extensions view
4. Select "Install from VSIX..."
5. Navigate to and select the `shells-0.0.1.vsix` file

### 3. Verify Installation

After installation:
1. Open a workspace that contains a `flake.nix` file
2. Look for the status bar item on the bottom left showing `$(package) Nix: <flake-name>`
3. Use `Ctrl+Shift+P` / `Cmd+Shift+P` and search for "Nix Flake" to see available commands

### Publishing to VS Code Marketplace (Optional)

To publish the extension to the VS Code Marketplace:

1. Create a publisher account at https://marketplace.visualstudio.com/
2. Get a Personal Access Token from Azure DevOps
3. Login with vsce:
   ```bash
   vsce login <publisher-name>
   ```
4. Publish the extension:
   ```bash
   vsce publish
   ```

## License

GPL-3.0-or-later

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
