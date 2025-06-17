import * as vscode from 'vscode';
import { getAwsCredentials } from '../utils';
import { actions } from '@helloao/cli';
import { InputTranslationMetadata } from '@helloao/tools/generation/index.js';
import { log } from '@helloao/tools';

async function askForMetadata(): Promise<InputTranslationMetadata> {
  let metadata = {
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

  return metadata;
}

async function loadOrAskForMetadata(
  metadataUri: vscode.Uri,
  output?: vscode.OutputChannel
): Promise<InputTranslationMetadata | undefined> {
  let metadata: InputTranslationMetadata | undefined;

  try {
    const bytes = await vscode.workspace.fs.readFile(metadataUri);
    metadata = JSON.parse(new TextDecoder().decode(bytes));

    if (output) {
      output.appendLine(`Loaded metadata from ${metadataUri.fsPath}`);
    }
  } catch (error) {
    if (output) {
      output.appendLine(
        `Error reading metadata file at ${metadataUri.fsPath}: ${error}`
      );
    }
    console.error('Error reading metadata file:', error);

    // Try to open our webview to edit the metadata
    const openWebview = await vscode.window.showInformationMessage(
      'No metadata file found. Would you like to create one using the Seed Bible editor?',
      'Open Editor',
      'Enter Manually'
    );

    if (openWebview === 'Open Editor') {
      // Focus the Seed Bible view in the Activity Bar
      await vscode.commands.executeCommand('seed-bible.webview.focus');

      // Show a message to guide the user
      vscode.window.showInformationMessage(
        'Please fill in the metadata fields in the Seed Bible panel and click "Save Metadata"'
      );

      return undefined; // Exit for now, user will try again after creating metadata
    } else {
      metadata = await askForMetadata();

      const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
        title: `Write metadata to ${metadataUri.fsPath}?`,
      });

      if (answer === 'Yes') {
        if (output) {
          output.appendLine(`Saving metadata to ${metadataUri.fsPath}...`);
        }
        await vscode.workspace.fs.writeFile(
          metadataUri,
          new TextEncoder().encode(JSON.stringify(metadata, null, 2))
        );
        if (output) {
          output.appendLine(`Saved!`);
        }
      }
    }
  }

  return metadata;
}

class OutputLogger implements log.Logger {
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  private _write(value: any): void {
    if (typeof value === 'string') {
      this.output.append(value);
    } else {
      this.output.append(JSON.stringify(value, null, 2));
    }
  }

  log(message: string, ...args: any[]): void {
    this._write(message);
    for (let a of args) {
      this._write(' ');
      this._write(a);
    }
    this.output.appendLine('');
  }

  error(message: string, ...args: any[]): void {
    this.output.append(`Error: `);
    this.log(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.output.append(`Warning: `);
    this.log(message, ...args);
  }
}

export async function uploadToSeedBible(
  context: vscode.ExtensionContext
): Promise<void> {
  const output = vscode.window.createOutputChannel('Seed Bible Upload');
  log.setLogger(new OutputLogger(output));

  let credentials = await getAwsCredentials(context);

  if ('errorCode' in credentials) {
    if (credentials.errorCode === 'not_authorized') {
      vscode.window.showErrorMessage(
        `You are not currently authorized to upload for the Seed Bible.\nPlease contact craig@helloao.org for access.`
      );
    } else {
      vscode.window.showErrorMessage(`Error: ${credentials.errorMessage}`);
    }
    return;
  }

  let folderToUpload: vscode.Uri | undefined;
  let bookNameMap: Map<string, { commonName: string }> | undefined = undefined;
  if (vscode.workspace.isTrusted) {
    output.appendLine('Workspace is trusted. Looking for target folder...');
    // get the files/target folder from the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      await showErrorOrOutput('No workspace folder found for upload.', output);
      return;
    }

    workspace: for (let folder of workspaceFolders) {
      const target = vscode.Uri.joinPath(folder.uri, 'files', 'target');
      const targetStat = await vscode.workspace.fs.stat(target);

      if (targetStat?.type === vscode.FileType.Directory) {
        output.appendLine(`Found target folder: ${target.fsPath}`);
        folderToUpload = target;

        let localizedBooks = vscode.Uri.joinPath(
          folder.uri,
          'localized-books.json'
        );

        try {
          const bytes = await vscode.workspace.fs.readFile(localizedBooks);
          const localizedBooksJson: {
            abbr: string;
            name: string;
          }[] = JSON.parse(new TextDecoder().decode(bytes));

          bookNameMap = new Map(
            localizedBooksJson.map((value) => [
              value.abbr,
              { commonName: value.name },
            ])
          );
        } catch (error) {
          output.appendLine(`Error reading localized-books.json: ${error}`);
          output.appendLine(
            `This may cause uploaded book names to default to their English names.`
          );
          console.error('Error reading localized-books.json:', error);
        }

        break workspace;
      }
    }
  } else {
    output.appendLine(
      'Workspace is not trusted. Skipping target folder search.'
    );
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
      await showErrorOrOutput('No folder selected for upload.', output);
      return;
    }

    folderToUpload = folderUri[0];
  }

  output.appendLine('Uploading folder: ' + folderToUpload.fsPath);

  const metadataUri = vscode.Uri.joinPath(
    folderToUpload,
    '..',
    '..',
    'seed-bible-metadata.json'
  );

  const metadata = await loadOrAskForMetadata(metadataUri);

  if (!metadata) {
    await showErrorOrOutput('No metadata provided for upload.', output);
    return;
  }

  try {
    const result = await actions.uploadTestTranslation(folderToUpload.fsPath, {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      s3Region: 'us-east-1',
      translationMetadata: metadata,
      bookNameMap,
    });

    if (result) {
      output.appendLine('Upload successful!');
      output.appendLine(`Upload URL: ${result.url}/${result.version}`);
      output.appendLine(
        `Available Translations URL: ${result.availableTranslationsUrl}`
      );
      output.appendLine(`S3 URL: ${result.uploadS3Url}`);
      output.appendLine(`Version: ${result.version}`);

      // copy URL to clipboard
      const answer = await vscode.window.showInformationMessage(
        `Upload successful! You can view your translation at: ${result.url}`,
        'Copy URL',
        'Show Output'
      );

      if (answer === 'Copy URL') {
        await vscode.env.clipboard.writeText(result.availableTranslationsUrl);
        vscode.window.showInformationMessage('URL copied to clipboard!');
      } else if (answer === 'Show Output') {
        output.show();
      }
    } else {
      await showErrorOrOutput('Upload failed.', output);
    }
  } catch (err) {
    console.error('Error during upload:', err);
    output.appendLine(`Error during upload: ${err}`);
    await showErrorOrOutput('Upload failed.', output);
  }
}

async function showErrorOrOutput(
  message: string,
  output: vscode.OutputChannel
): Promise<void> {
  const answer = await vscode.window.showErrorMessage(message, 'Show Output');

  if (answer === 'Show Output') {
    output.show();
  }
}

export function registerUploadtoSeedBibleCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.upload', async () => {
    return await uploadToSeedBible(context);
  });
}
