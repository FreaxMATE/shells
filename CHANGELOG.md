# Change Log

All notable changes to the "Nix Flake Environment Switcher" extension will be documented in this file.

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
