import * as vscode from 'vscode';
import { updateAwsCredentials } from './update-aws-credentials';
import { actions } from '@helloao/cli';
import { InputTranslationMetadata } from '@helloao/tools/generation/index.js';

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
  // let metadata: any | undefined;
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

    // if (folderToUpload) {
    //   // decode metadata.json
    //   let bytes = await vscode.workspace.fs.readFile(
    //     vscode.Uri.joinPath(folderToUpload, '..', '..', 'metadata.json'),
    //   );

    //   metadata = JSON.parse(new TextDecoder().decode(bytes));
    //   console.log('Metadata:', metadata);
    // }
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

    // const metadataUri = await vscode.window.showOpenDialog({
    //   canSelectFiles: true,
    //   canSelectFolders: false,
    //   canSelectMany: false,
    //   openLabel: 'Select metadata.json',
    //   filters: {
    //     'JSON Files': ['json'],
    //   }
    // });

    // if (!metadataUri || metadataUri.length === 0) {
    //   vscode.window.showErrorMessage('No metadata.json selected for upload.');
    //   return;
    // }
  }

  console.log('Uploading folder:', folderToUpload);

  const metadataUri = vscode.Uri.joinPath(
    folderToUpload,
    '..',
    '..',
    'seed-bible-metadata.json'
  );

  let metadata: InputTranslationMetadata | undefined;

  try {
    const bytes = await vscode.workspace.fs.readFile(metadataUri);
    metadata = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.error('Error reading metadata file:', error);

    metadata = {
      website: '',
      licenseUrl: '',
    } as InputTranslationMetadata;

    const keys: (keyof InputTranslationMetadata)[] = [
      'id',
      'name',
      'englishName',
      'language',
      'direction',
    ];

    for (const key of keys) {
      let value: string | undefined;
      if (key === 'direction') {
        value = await vscode.window.showQuickPick(['ltr', 'rtl'], {
          title: 'Metadata - Text Direction',
        });
      } else {
        value = await vscode.window.showInputBox({
          prompt: `Enter value for ${key}`,
          title: `Metadata - ${key}`,
        });
      }

      metadata[key] = value as any;
    }

    const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
      title: `Write metadata to ${metadataUri.fsPath}?`,
    });

    if (answer === 'Yes') {
      await vscode.workspace.fs.writeFile(
        metadataUri,
        new TextEncoder().encode(JSON.stringify(metadata, null, 2))
      );
    }
  }

  const result = await actions.uploadTestTranslation(folderToUpload.fsPath, {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    s3Region: 'us-east-1',
    translationMetadata: metadata,
  });

  if (result) {
    // copy URL to clipboard
    const copyUrl = await vscode.window.showInformationMessage(
      `Upload successful! You can view your translation at: ${result.url}`,
      'Copy URL'
    );

    if (copyUrl === 'Copy URL') {
      await vscode.env.clipboard.writeText(result.availableTranslationsUrl);
      vscode.window.showInformationMessage('URL copied to clipboard!');
    }
  }

  // // The code you place here will be executed every time your command is executed
  // // Display a message box to the user
  // vscode.window.showInformationMessage(
  //   'Hello Test from Codex Seed Bible Upload!'
  // );
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
