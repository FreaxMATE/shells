# Change Log

All notable changes to the "Nix Flake Environment Switcher" extension will be documented in this file.

## [0.0.4] - 2025-10-15

### Fixed
- 🐛 **Status bar indicator now persists across window reloads!** 
  - The green checkmark and prominent background now correctly reappear after reloading VS Code
  - Extension automatically detects if environment was previously active by checking workspace configuration
  - Environment state is restored from workspace settings on activation
  - Logs restoration in output channel for transparency

### Technical Details
- Added `checkEnvironmentActive()` function to detect if terminal environment is configured
- Modified `autoDetectFlake()` to check and restore previous environment state
- Status bar now correctly reflects the actual environment state after reload
- Prevents duplicate activation if environment is already active

## [0.0.3] - 2025-10-15

### Added
- 🎨 **Visual status bar indicator** with color highlighting when flake environment is active
  - Active state: Green checkmark icon ($(pass-filled)) with prominent background color
  - Inactive state: Simple package icon with default styling
  - Clear tooltip messages explaining the current state
- 📊 **Output channel for debugging** - View detailed logs of nix develop execution
  - Shows full command output and stderr for troubleshooting
  - Tracks environment variable extraction (shows count of variables)
  - Logs Python/Jupyter configuration steps
  - Timestamps all operations
  - Automatically shows when activation starts
- 📝 **New command**: `Shells: Show Output` - Manually open the output channel
- 🔍 **Enhanced error reporting** with full error messages in output channel
- 🎯 **"Show Output" button** added to success notification for easy access to logs

### Changed
- Status bar now uses `$(pass-filled)` icon instead of `$(check)` for better visibility when active
- Status bar gets a prominent background color when environment is active
- All environment operations now logged to output channel for transparency
- Error messages now direct users to check output channel for details

## [0.0.2] - 2025-10-15

### Fixed
- 🐛 **Jupyter Notebooks now work correctly!** Fixed issue where Python and Jupyter extensions couldn't find packages from Nix flake
  - Extension now configures `python.defaultInterpreterPath` to use Python from the flake
  - Creates `.vscode/.env.nix` file with critical environment variables (PATH, PYTHONPATH, etc.)
  - Sets `python.envFile` to load Nix environment variables
  - Configures Jupyter notebook settings for proper integration
- 📓 Added automatic cleanup of Python/Jupyter configuration when exiting flake environment
- 🔄 Changed default action to "Reload Window" (recommended) instead of "Open Terminal" after activation
- 📝 Added `.env.nix` to `.gitignore` to prevent accidental commits

### Changed
- Improved user messaging to emphasize the importance of reloading VS Code after activation
- Reordered prompt buttons to prioritize "Reload Window" action

### Documentation
- 📚 Added Python & Jupyter Notebooks section to README with troubleshooting tips
- 💡 Explained why VS Code reload is required for Python/Jupyter integration
- 📖 Added example Jupyter-ready flake configuration

## [0.0.1] - 2025-10-14

### Added
- Initial release
- Auto-detection of `flake.nix` files in workspace
- Status bar integration showing flake status
- Commands:
  - Enter Nix Flake Environment
  - Exit Nix Flake Environment
  - Select Nix Flake
- **System-wide environment integration**:
  - All integrated terminals automatically use flake environment
  - Build tasks use tools from the flake
  - Debuggers use flake environment
  - Language servers use flake packages
  - Entire VS Code workspace behaves as if running inside `nix develop`
- Configuration options:
  - `shells.autoActivate`: Auto-activate on workspace open
  - `shells.flakePath`: Specify custom flake path
- Multi-flake support with quick picker
- NixOS-optimized packaging with npx (no global npm install needed)

### Security
- ✅ Command injection protection using `spawn()` with array arguments
- ✅ Path traversal validation to prevent escaping workspace
- ✅ Shell escaping for terminal commands
- ✅ Sanitized error messages to prevent information disclosure
- ✅ Timeouts on all external command execution
- ✅ Input validation for user-provided paths

### Technical Details
- Extracts complete environment from `nix develop` command
- Updates VS Code's `terminal.integrated.env` configuration
- Modifies workspace settings for system-wide integration
- Supports Linux and macOS
- TypeScript + esbuild bundling for fast startup and small package size
- Secure by default with no telemetry or data collection
