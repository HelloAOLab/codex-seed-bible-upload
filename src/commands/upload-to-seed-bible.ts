import * as vscode from 'vscode';
import { updateAwsCredentials } from './update-aws-credentials';

export async function uploadToSeedBible(
  context: vscode.ExtensionContext
): Promise<void> {
  // 1. Get S3 API Key
  let accessKeyId: string | undefined =
    await context.secrets.get('awsAccessKeyId');
  let secretAccessKey: string | undefined =
    await context.secrets.get('awsSecretAccessKey');

  if (!accessKeyId || !secretAccessKey) {
    await updateAwsCredentials(context);
  }

  accessKeyId = await context.secrets.get('awsAccessKeyId');
  secretAccessKey = await context.secrets.get('awsSecretAccessKey');

  if (!accessKeyId || !secretAccessKey) {
    vscode.window.showErrorMessage(
      'AWS credentials are not set. Please update your AWS credentials first.'
    );
    return;
  }

  let folderToUpload: vscode.Uri | undefined;
  if (vscode.workspace.isTrusted) {
    console.log('trusted');
    // get the files/target folder from the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder found for upload.');
      return;
    }

    workspace: for (let folder of workspaceFolders) {
      const target = vscode.Uri.joinPath(folder.uri, 'files', 'target');
      const targetStat = await vscode.workspace.fs.stat(target);

      if (targetStat?.type === vscode.FileType.Directory) {
        console.log('Found target folder in workspace!');
        folderToUpload = target;
        break workspace;
      }
    }
  } else {
    console.log('untrusted');
  }

  if (!folderToUpload) {
    // ask user for folder to upload
    const folderUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Folder to Upload',
    });

    if (!folderUri || folderUri.length === 0) {
      vscode.window.showErrorMessage('No folder selected for upload.');
      return;
    }

    folderToUpload = folderUri[0];
  }

  console.log('Uploading folder:', folderToUpload);

  // The code you place here will be executed every time your command is executed
  // Display a message box to the user
  vscode.window.showInformationMessage(
    'Hello Test from Codex Seed Bible Upload!'
  );
}

export function registerUploadtoSeedBibleCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codex.seed-bible.upload-to-seed-bible',
    async () => {
      return await uploadToSeedBible(context);
    }
  );
}
