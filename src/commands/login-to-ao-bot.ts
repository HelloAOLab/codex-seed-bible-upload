import * as vscode from 'vscode';
import { login } from '../utils';

export function registerLoginToAoBotCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.login', async () => {
    return await login(context);
  });
}
