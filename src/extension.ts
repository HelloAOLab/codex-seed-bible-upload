// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { registerUploadtoSeedBibleCommand } from './commands/upload-to-seed-bible';
import { registerLoginToAoBotCommand } from './commands/login-to-ao-bot';
import { SeedBibleWebviewProvider } from './webview/seed-bible-webview';
import { log } from '@helloao/tools';
import { OutputLogger } from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Seed Bible Upload');
  log.setLogger(new OutputLogger(output));

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "codex-seed-bible-upload" is now active!'
  );

  // const disposable1 = registerUpdateAwsCredentialsCommand(context);
  const disposable1 = registerLoginToAoBotCommand(context);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable2 = registerUploadtoSeedBibleCommand(context);

  // Register Seed Bible webview
  const seedBibleWebviewProvider = new SeedBibleWebviewProvider(context);
  const disposable3 = vscode.window.registerWebviewViewProvider(
    SeedBibleWebviewProvider.viewType,
    seedBibleWebviewProvider
  );

  // Register command to focus the webview
  const disposable5 = vscode.commands.registerCommand(
    'seed-bible.webview.focus',
    async () => {
      // First make sure the activity bar view is visible
      await vscode.commands.executeCommand(
        'workbench.view.extension.seed-bible'
      );

      // Then focus the specific webview
      await vscode.commands.executeCommand('seed-bible.webview.focus');
    }
  );

  context.subscriptions.push(disposable1);
  context.subscriptions.push(disposable2);
  context.subscriptions.push(disposable3);
  context.subscriptions.push(disposable5);
}

// This method is called when your extension is deactivated
export function deactivate() {}
