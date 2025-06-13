// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { actions } from '@helloao/cli';
import { registerUpdateAwsCredentialsCommand } from './commands/update-aws-credentials';
import { registerUploadtoSeedBibleCommand } from './commands/upload-to-seed-bible';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "codex-seed-bible-upload" is now active!'
  );

  const disposable1 = registerUpdateAwsCredentialsCommand(context);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable2 = registerUploadtoSeedBibleCommand(context);

  context.subscriptions.push(disposable1);
  context.subscriptions.push(disposable2);
}

// This method is called when your extension is deactivated
export function deactivate() {}
