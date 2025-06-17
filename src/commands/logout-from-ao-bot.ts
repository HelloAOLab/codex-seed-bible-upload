import * as vscode from 'vscode';
import { logout } from '../utils';

export function registerLogoutFromAoBotCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.logout', async () => {
    return await logout(context);
  });
}
