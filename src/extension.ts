import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';

let currentFlakePath: string | undefined;
let statusBarItem: vscode.StatusBarItem;
let flakeEnvironment: NodeJS.ProcessEnv | undefined;
let isEnvironmentActive = false;

/**
 * Validates that a flake path is safe and within the workspace
 */
function validateFlakePath(flakePath: string, workspaceRoot: string): boolean {
	// Normalize paths to resolve .. and .
	const normalizedFlake = path.normalize(path.resolve(workspaceRoot, flakePath));
	const normalizedRoot = path.normalize(path.resolve(workspaceRoot));
	
	// Ensure flake path is within workspace
	if (!normalizedFlake.startsWith(normalizedRoot)) {
		return false;
	}
	
	// Ensure it's a file (not directory or symlink to outside)
	try {
		const stats = fs.lstatSync(normalizedFlake);
		return stats.isFile();
	} catch {
		return false;
	}
}

/**
 * Safely checks if nix command is available
 */
async function isNixAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('which', ['nix'], { timeout: 5000 });
		proc.on('close', (code) => resolve(code === 0));
		proc.on('error', () => resolve(false));
	});
}

/**
 * Securely extracts environment variables from nix develop
 */
function getFlakeEnvironment(flakeDir: string): Promise<NodeJS.ProcessEnv> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {};
		const proc = spawn('nix', ['develop', flakeDir, '--command', 'env'], {
			cwd: flakeDir,
			timeout: 60000, // 60 second timeout
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('close', (code) => {
			if (code === 0) {
				const lines = stdout.split('\n');
				for (const line of lines) {
					const match = line.match(/^([^=]+)=(.*)$/);
					if (match && match[1]) {
						env[match[1]] = match[2];
					}
				}
				resolve(env);
			} else {
				reject(new Error(`nix develop failed with code ${code}`));
			}
		});

		proc.on('error', (error) => {
			reject(error);
		});
	});
}


export function activate(context: vscode.ExtensionContext) {
	console.log('Shells - Nix Flake Environment Switcher is now active');

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'shells.selectFlake';
	context.subscriptions.push(statusBarItem);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('shells.enterFlake', async () => {
			await enterFlakeEnvironment();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('shells.exitFlake', async () => {
			await exitFlakeEnvironment();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('shells.selectFlake', async () => {
			await selectFlake();
		})
	);

	// Listen for new terminals to inject environment
	context.subscriptions.push(
		vscode.window.onDidOpenTerminal(async (terminal) => {
			if (isEnvironmentActive && flakeEnvironment) {
				await injectEnvironmentIntoTerminal(terminal);
			}
		})
	);

	// Auto-detect and optionally activate flake
	autoDetectFlake();
}

async function autoDetectFlake() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}

	// Search for flake.nix files
	const flakeFiles = await vscode.workspace.findFiles('**/flake.nix', '**/node_modules/**', 10);
	
	if (flakeFiles.length === 0) {
		statusBarItem.text = '$(package) No Flake';
		statusBarItem.tooltip = 'No flake.nix found in workspace';
		statusBarItem.show();
		return;
	}

	// Use the first flake found or the one specified in settings
	const config = vscode.workspace.getConfiguration('shells');
	const configuredPath = config.get<string>('flakePath');
	
	if (configuredPath) {
		const fullPath = path.join(workspaceFolders[0].uri.fsPath, configuredPath);
		if (validateFlakePath(fullPath, workspaceFolders[0].uri.fsPath) && fs.existsSync(fullPath)) {
			currentFlakePath = fullPath;
		} else {
			vscode.window.showErrorMessage('Invalid flake path: must be a file within workspace');
		}
	} else {
		currentFlakePath = flakeFiles[0].fsPath;
	}

	updateStatusBar(false);

	// Auto-activate if configured
	const autoActivate = config.get<boolean>('autoActivate');
	if (autoActivate && currentFlakePath) {
		await enterFlakeEnvironment();
	}
}

async function selectFlake() {
	const flakeFiles = await vscode.workspace.findFiles('**/flake.nix', '**/node_modules/**', 10);
	
	if (flakeFiles.length === 0) {
		vscode.window.showWarningMessage('No flake.nix files found in workspace');
		return;
	}

	const items = flakeFiles.map(file => ({
		label: path.basename(path.dirname(file.fsPath)),
		description: vscode.workspace.asRelativePath(file.fsPath),
		uri: file
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a flake.nix file'
	});

	if (selected) {
		currentFlakePath = selected.uri.fsPath;
		updateStatusBar(false);
		
		const action = await vscode.window.showInformationMessage(
			`Selected flake: ${selected.description}`,
			'Enter Environment',
			'Cancel'
		);

		if (action === 'Enter Environment') {
			await enterFlakeEnvironment();
		}
	}
}

async function enterFlakeEnvironment() {
	if (!currentFlakePath) {
		vscode.window.showWarningMessage('No flake selected. Use "Select Nix Flake" command first.');
		return;
	}

	try {
		vscode.window.showInformationMessage('Entering Nix flake environment...');
		
		// Check if nix is available
		const nixAvailable = await isNixAvailable();
		if (!nixAvailable) {
			vscode.window.showErrorMessage('Nix is not installed or not in PATH');
			return;
		}

		// Get flake directory
		const flakeDir = path.dirname(currentFlakePath);

		// Get the flake environment variables securely
		flakeEnvironment = await getFlakeEnvironment(flakeDir);

		// Update VS Code's integrated terminal environment
		const config = vscode.workspace.getConfiguration('terminal.integrated');
		await config.update('env.linux', flakeEnvironment, vscode.ConfigurationTarget.Workspace);
		await config.update('env.osx', flakeEnvironment, vscode.ConfigurationTarget.Workspace);

		isEnvironmentActive = true;
		updateStatusBar(true);

		// Show success message with option to open terminal
		const action = await vscode.window.showInformationMessage(
			'Nix flake environment activated! All new terminals will use this environment.',
			'Open Terminal',
			'Reload Window'
		);

		if (action === 'Open Terminal') {
			vscode.commands.executeCommand('workbench.action.terminal.new');
		} else if (action === 'Reload Window') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}

	} catch (error) {
		vscode.window.showErrorMessage('Failed to enter flake environment. Check the output for details.');
		console.error('Error entering flake environment:', error);
	}
}

async function injectEnvironmentIntoTerminal(terminal: vscode.Terminal) {
	if (!flakeEnvironment || !currentFlakePath) {
		return;
	}

	// Send commands to set environment variables in the terminal
	// This is a backup in case the terminal.integrated.env doesn't work for all cases
	const flakeDir = path.dirname(currentFlakePath);
	
	// Escape single quotes in the path to prevent command injection
	const escapedFlakeDir = flakeDir.replace(/'/g, "'\\''");
	
	terminal.sendText(`# Entering Nix flake environment`, false);
	terminal.sendText(`eval "$(nix print-dev-env '${escapedFlakeDir}')"`, true);
}

async function exitFlakeEnvironment() {
	// Clear the environment
	flakeEnvironment = undefined;
	isEnvironmentActive = false;

	// Reset terminal environment
	const config = vscode.workspace.getConfiguration('terminal.integrated');
	await config.update('env.linux', undefined, vscode.ConfigurationTarget.Workspace);
	await config.update('env.osx', undefined, vscode.ConfigurationTarget.Workspace);

	updateStatusBar(false);

	const action = await vscode.window.showInformationMessage(
		'Nix flake environment deactivated. Reload window to apply changes.',
		'Reload Window'
	);

	if (action === 'Reload Window') {
		vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}

function updateStatusBar(isActive: boolean) {
	if (!currentFlakePath) {
		statusBarItem.text = '$(package) No Flake';
		statusBarItem.tooltip = 'No flake.nix found';
	} else {
		const flakeName = path.basename(path.dirname(currentFlakePath));
		statusBarItem.text = isActive 
			? `$(check) Nix: ${flakeName}` 
			: `$(package) Nix: ${flakeName}`;
		statusBarItem.tooltip = isActive
			? `Active Nix flake environment: ${currentFlakePath}`
			: `Detected Nix flake: ${currentFlakePath}\nClick to select or activate`;
	}
	statusBarItem.show();
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
