import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';

let currentFlakePath: string | undefined;
let statusBarItem: vscode.StatusBarItem;
let flakeEnvironment: NodeJS.ProcessEnv | undefined;
let isEnvironmentActive = false;
let outputChannel: vscode.OutputChannel;

/**
 * Checks if the environment is currently active by looking at workspace configuration
 */
function checkEnvironmentActive(): boolean {
	const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
	const linuxEnv = terminalConfig.get<NodeJS.ProcessEnv>('env.linux');
	const osxEnv = terminalConfig.get<NodeJS.ProcessEnv>('env.osx');
	
	// If either environment is set, the flake environment is active
	const hasLinuxEnv = !!(linuxEnv && Object.keys(linuxEnv).length > 0);
	const hasOsxEnv = !!(osxEnv && Object.keys(osxEnv).length > 0);
	
	return hasLinuxEnv || hasOsxEnv;
}

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
		
		outputChannel.appendLine(`[${new Date().toISOString()}] Running: nix develop ${flakeDir} --command env`);
		outputChannel.appendLine('='.repeat(80));
		
		const proc = spawn('nix', ['develop', flakeDir, '--command', 'env'], {
			cwd: flakeDir,
			timeout: 60000, // 60 second timeout
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data) => {
			const text = data.toString();
			stdout += text;
			outputChannel.append(text);
		});

		proc.stderr?.on('data', (data) => {
			const text = data.toString();
			stderr += text;
			outputChannel.append(`[STDERR] ${text}`);
		});

		proc.on('close', (code) => {
			outputChannel.appendLine('='.repeat(80));
			outputChannel.appendLine(`[${new Date().toISOString()}] Process exited with code: ${code}`);
			
			if (code === 0) {
				const lines = stdout.split('\n');
				let envVarCount = 0;
				for (const line of lines) {
					const match = line.match(/^([^=]+)=(.*)$/);
					if (match && match[1]) {
						env[match[1]] = match[2];
						envVarCount++;
					}
				}
				outputChannel.appendLine(`Successfully extracted ${envVarCount} environment variables`);
				outputChannel.appendLine('');
				resolve(env);
			} else {
				outputChannel.appendLine(`ERROR: nix develop failed with code ${code}`);
				if (stderr) {
					outputChannel.appendLine('STDERR output:');
					outputChannel.appendLine(stderr);
				}
				outputChannel.appendLine('');
				reject(new Error(`nix develop failed with code ${code}: ${stderr}`));
			}
		});

		proc.on('error', (error) => {
			outputChannel.appendLine(`[${new Date().toISOString()}] ERROR: ${error.message}`);
			outputChannel.appendLine('');
			reject(error);
		});
	});
}


export function activate(context: vscode.ExtensionContext) {
	console.log('Shells - Nix Flake Environment Switcher is now active');

	// Create output channel for debugging
	outputChannel = vscode.window.createOutputChannel('Nix Flake Environment');
	context.subscriptions.push(outputChannel);

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

	context.subscriptions.push(
		vscode.commands.registerCommand('shells.showOutput', () => {
			outputChannel.show();
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

	// Check if environment was previously active (persists across reloads)
	const wasActive = checkEnvironmentActive();
	if (wasActive) {
		outputChannel.appendLine(`\n${'*'.repeat(80)}`);
		outputChannel.appendLine(`Restoring Nix Flake Environment State`);
		outputChannel.appendLine(`Flake: ${currentFlakePath}`);
		outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
		outputChannel.appendLine(`${'*'.repeat(80)}\n`);
		
		isEnvironmentActive = true;
		
		// Restore the environment variables from workspace config
		const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
		const linuxEnv = terminalConfig.get<NodeJS.ProcessEnv>('env.linux');
		const osxEnv = terminalConfig.get<NodeJS.ProcessEnv>('env.osx');
		flakeEnvironment = linuxEnv || osxEnv;
		
		outputChannel.appendLine('✅ Nix flake environment state restored from workspace configuration');
		outputChannel.appendLine('='.repeat(80) + '\n');
	}
	
	updateStatusBar(wasActive);

	// Auto-activate if configured (and not already active)
	const autoActivate = config.get<boolean>('autoActivate');
	if (autoActivate && currentFlakePath && !wasActive) {
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
		outputChannel.show(true); // Show output channel but keep focus
		outputChannel.appendLine(`\n${'*'.repeat(80)}`);
		outputChannel.appendLine(`Activating Nix Flake Environment`);
		outputChannel.appendLine(`Flake: ${currentFlakePath}`);
		outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
		outputChannel.appendLine(`${'*'.repeat(80)}\n`);
		
		// Check if nix is available
		const nixAvailable = await isNixAvailable();
		if (!nixAvailable) {
			vscode.window.showErrorMessage('Nix is not installed or not in PATH');
			outputChannel.appendLine('ERROR: Nix is not installed or not in PATH\n');
			return;
		}

		// Get flake directory
		const flakeDir = path.dirname(currentFlakePath);

		// Get the flake environment variables securely
		outputChannel.appendLine('Extracting environment variables from flake...\n');
		flakeEnvironment = await getFlakeEnvironment(flakeDir);

		// Update VS Code's integrated terminal environment
		const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
		await terminalConfig.update('env.linux', flakeEnvironment, vscode.ConfigurationTarget.Workspace);
		await terminalConfig.update('env.osx', flakeEnvironment, vscode.ConfigurationTarget.Workspace);

		// Critical: Update Python interpreter path for Jupyter to work
		// Find the python executable in the flake environment
		const pythonPath = flakeEnvironment['PATH']?.split(':').find(p => 
			fs.existsSync(path.join(p, 'python')) || 
			fs.existsSync(path.join(p, 'python3'))
		);
		
		if (pythonPath) {
			const pythonExe = fs.existsSync(path.join(pythonPath, 'python3')) 
				? path.join(pythonPath, 'python3')
				: path.join(pythonPath, 'python');
			
			outputChannel.appendLine(`Configuring Python interpreter: ${pythonExe}`);
			
			const pythonConfig = vscode.workspace.getConfiguration('python');
			await pythonConfig.update('defaultInterpreterPath', pythonExe, vscode.ConfigurationTarget.Workspace);
			
			// Also set environment variables for the Python extension
			await pythonConfig.update('envFile', '${workspaceFolder}/.vscode/.env.nix', vscode.ConfigurationTarget.Workspace);
			
			// Write environment variables to a file for Python extension
			const envFilePath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', '.env.nix');
			const envDir = path.dirname(envFilePath);
			if (!fs.existsSync(envDir)) {
				fs.mkdirSync(envDir, { recursive: true });
			}
			
			// Write critical environment variables
			const envContent = Object.entries(flakeEnvironment)
				.filter(([key]) => key === 'PATH' || key === 'LD_LIBRARY_PATH' || key === 'PYTHONPATH' || 
				                   key.startsWith('JUPYTER') || key.startsWith('PYTHON'))
				.map(([key, value]) => `${key}=${value}`)
				.join('\n');
			fs.writeFileSync(envFilePath, envContent);
			outputChannel.appendLine(`Created environment file: ${envFilePath}`);
		} else {
			outputChannel.appendLine('No Python interpreter found in flake environment');
		}

		// Set Jupyter-specific settings
		outputChannel.appendLine('Configuring Jupyter settings');
		const jupyterConfig = vscode.workspace.getConfiguration('jupyter');
		await jupyterConfig.update('notebookFileRoot', '${workspaceFolder}', vscode.ConfigurationTarget.Workspace);

		isEnvironmentActive = true;
		updateStatusBar(true);

		outputChannel.appendLine('\n✅ Nix flake environment activated successfully!');
		outputChannel.appendLine('='.repeat(80) + '\n');

		// Show success message with option to open terminal
		const action = await vscode.window.showInformationMessage(
			'Nix flake environment activated! Reload window to apply to Python/Jupyter.',
			'Reload Window',
			'Open Terminal',
			'Show Output'
		);

		if (action === 'Reload Window') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		} else if (action === 'Open Terminal') {
			vscode.commands.executeCommand('workbench.action.terminal.new');
		} else if (action === 'Show Output') {
			outputChannel.show();
		}

	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage('Failed to enter flake environment. Check the output for details.');
		outputChannel.appendLine(`\n❌ ERROR: ${errorMsg}`);
		outputChannel.appendLine('='.repeat(80) + '\n');
		outputChannel.show();
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
	outputChannel.appendLine(`\n${'*'.repeat(80)}`);
	outputChannel.appendLine(`Deactivating Nix Flake Environment`);
	outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
	outputChannel.appendLine(`${'*'.repeat(80)}\n`);

	// Clear the environment
	flakeEnvironment = undefined;
	isEnvironmentActive = false;

	// Reset terminal environment
	outputChannel.appendLine('Resetting terminal environment...');
	const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
	await terminalConfig.update('env.linux', undefined, vscode.ConfigurationTarget.Workspace);
	await terminalConfig.update('env.osx', undefined, vscode.ConfigurationTarget.Workspace);

	// Reset Python configuration
	outputChannel.appendLine('Resetting Python configuration...');
	const pythonConfig = vscode.workspace.getConfiguration('python');
	await pythonConfig.update('defaultInterpreterPath', undefined, vscode.ConfigurationTarget.Workspace);
	await pythonConfig.update('envFile', undefined, vscode.ConfigurationTarget.Workspace);
	
	// Remove the .env.nix file
	const envFilePath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', '.env.nix');
	if (fs.existsSync(envFilePath)) {
		fs.unlinkSync(envFilePath);
		outputChannel.appendLine(`Removed environment file: ${envFilePath}`);
	}

	// Reset Jupyter configuration
	outputChannel.appendLine('Resetting Jupyter configuration...');
	const jupyterConfig = vscode.workspace.getConfiguration('jupyter');
	await jupyterConfig.update('notebookFileRoot', undefined, vscode.ConfigurationTarget.Workspace);

	updateStatusBar(false);

	outputChannel.appendLine('\n✅ Nix flake environment deactivated successfully!');
	outputChannel.appendLine('='.repeat(80) + '\n');

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
		statusBarItem.backgroundColor = undefined;
		statusBarItem.color = undefined;
	} else {
		const flakeName = path.basename(path.dirname(currentFlakePath));
		
		if (isActive) {
			// Active state: Green checkmark with emphasis
			statusBarItem.text = `$(pass-filled) Nix: ${flakeName}`;
			statusBarItem.tooltip = `✅ Active Nix flake environment\nFlake: ${currentFlakePath}\n\nClick to change flakes or view output`;
			// Use a subtle background color to make it stand out
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
			statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
		} else {
			// Inactive state: Simple package icon
			statusBarItem.text = `$(package) Nix: ${flakeName}`;
			statusBarItem.tooltip = `Detected Nix flake: ${currentFlakePath}\n\nClick to activate environment`;
			statusBarItem.backgroundColor = undefined;
			statusBarItem.color = undefined;
		}
	}
	statusBarItem.show();
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
