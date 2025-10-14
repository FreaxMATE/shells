{
  description = "Nix Flake Environment Switcher - VS Code Extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            nodePackages.npm
            nodePackages.typescript
            git
          ];

          shellHook = ''
            echo "🚀 VS Code Extension Development Environment"
            echo "Node version: $(node --version)"
            echo "NPM version: $(npm --version)"
            echo ""
            echo "Available commands:"
            echo "  npm install           - Install dependencies"
            echo "  npm run compile       - Compile TypeScript"
            echo "  npm run watch         - Watch for changes"
            echo "  npx @vscode/vsce package - Package extension"
          '';
        };
      }
    );
}
