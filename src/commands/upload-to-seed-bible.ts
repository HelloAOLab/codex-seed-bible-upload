import * as vscode from 'vscode';
import { getAwsCredentials, OutputLogger } from '../utils';
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
    'shortName',
    'language',
    'direction',
  ];

  for (const key of keys) {
    let value: string | undefined;
    if (key === 'direction') {
      value = await vscode.window.showQuickPick(['ltr', 'rtl'], {
        title: 'Metadata - Text Direction',
      });
    } else if (key === 'shortName') {
      value = await vscode.window.showInputBox({
        title: 'Metadata - Short Name',
        prompt:
          'Enter a short name for the translation (e.g., "BSB", "KJV", etc.)',
        placeHolder: 'shortName',
        value: metadata.id,
        validateInput: (value: string) => {
          if (!value) {
            return 'Short name is required.';
          }
          return null;
        },
      });
    } else {
      value = await vscode.window.showInputBox({
        prompt: `Enter value for ${key}`,
        title: `Metadata - ${key}`,
        placeHolder: key,
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
  const logger = log.getLogger();
  let metadata: InputTranslationMetadata | undefined;

  try {
    const bytes = await vscode.workspace.fs.readFile(metadataUri);
    metadata = JSON.parse(new TextDecoder().decode(bytes));

    if (output) {
      logger.log(`Loaded metadata from ${metadataUri.fsPath}`);
    }
  } catch (error) {
    if (output) {
      logger.log(
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
          logger.log(`Saving metadata to ${metadataUri.fsPath}...`);
        }
        await vscode.workspace.fs.writeFile(
          metadataUri,
          new TextEncoder().encode(JSON.stringify(metadata, null, 2))
        );
        if (output) {
          logger.log(`Saved!`);
        }
      }
    }
  }

  return metadata;
}

export async function uploadToSeedBible(
  context: vscode.ExtensionContext
): Promise<void> {
  const logger = log.getLogger();
  const credentials = await getAwsCredentials(context);

  if ('errorCode' in credentials) {
    logger.error(`Error obtaining AWS credentials:`, credentials);
    if (credentials.errorCode === 'not_authorized') {
      vscode.window.showErrorMessage(
        `You are not currently authorized to upload for the Seed Bible.\nPlease contact craig@helloao.org for access.`
      );
    } else {
      vscode.window.showErrorMessage(`Error: ${credentials.errorMessage}`);
    }
    return;
  } else {
    logger.log('AWS credentials obtained successfully.', credentials);
  }

  let folderToUpload: vscode.Uri | undefined;
  let bookNameMap: Map<string, { commonName: string }> | undefined = undefined;
  if (vscode.workspace.isTrusted) {
    logger.log('Workspace is trusted. Looking for target folder...');
    // get the files/target folder from the workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      await showErrorOrOutput('No workspace folder found for upload.');
      return;
    }

    workspace: for (let folder of workspaceFolders) {
      const target = vscode.Uri.joinPath(folder.uri, 'files', 'target');
      const targetStat = await vscode.workspace.fs.stat(target);

      if (targetStat?.type === vscode.FileType.Directory) {
        logger.log(`Found target folder: ${target.fsPath}`);
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
          logger.log(`Error reading localized-books.json: ${error}`);
          logger.log(
            `This may cause uploaded book names to default to their English names.`
          );
          logger.error('Error reading localized-books.json:', error);
        }

        break workspace;
      }
    }
  } else {
    logger.log('Workspace is not trusted. Skipping target folder search.');
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
      await showErrorOrOutput('No folder selected for upload.');
      return;
    }

    folderToUpload = folderUri[0];
  }

  logger.log('Uploading folder: ' + folderToUpload.fsPath);

  const metadataUri = vscode.Uri.joinPath(
    folderToUpload,
    '..',
    '..',
    'seed-bible-metadata.json'
  );

  const metadata = await loadOrAskForMetadata(metadataUri);

  if (!metadata) {
    await showErrorOrOutput('No metadata provided for upload.');
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
      logger.log('Upload successful!');
      logger.log(`Upload URL: ${result.url}/${result.version}`);
      logger.log(
        `Available Translations URL: ${result.availableTranslationsUrl}`
      );
      logger.log(`S3 URL: ${result.uploadS3Url}`);
      logger.log(`Version: ${result.version}`);

      // copy URL to clipboard
      const answer = await vscode.window.showInformationMessage(
        `Upload successful! You can view your translation at: ${result.url}`,
        'Copy URL'
      );

      if (answer === 'Copy URL') {
        await vscode.env.clipboard.writeText(result.availableTranslationsUrl);
        vscode.window.showInformationMessage('URL copied to clipboard!');
      }
    } else {
      await showErrorOrOutput('Upload failed.');
    }
  } catch (err) {
    console.error('Error during upload:', err);
    logger.log(`Error during upload: ${err}`);
    await showErrorOrOutput('Upload failed.');
  }
}

async function showErrorOrOutput(message: string): Promise<void> {
  const answer = await vscode.window.showErrorMessage(message, 'Show Output');

  if (answer === 'Show Output') {
    const logger = log.getLogger();
    if (logger instanceof OutputLogger) {
      logger.output.show();
    }
  }
}

export function registerUploadtoSeedBibleCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.upload', async () => {
    return await uploadToSeedBible(context);
  });
}
