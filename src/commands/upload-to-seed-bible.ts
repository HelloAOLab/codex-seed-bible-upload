import * as vscode from 'vscode';
import { getAwsCredentials, getClient, OutputLogger } from '../utils';
import { actions } from '@helloao/cli';
import { InputTranslationMetadata } from '@helloao/tools/generation/index.js';
import { log } from '@helloao/tools';
import { parseSessionKey } from '@casual-simulation/aux-common';

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
  metadataUris: vscode.Uri | vscode.Uri[],
  output?: vscode.OutputChannel
): Promise<InputTranslationMetadata | undefined> {
  const logger = log.getLogger();
  let metadata: InputTranslationMetadata | undefined;

  // Normalize to array for consistent handling
  const uris = Array.isArray(metadataUris) ? metadataUris : [metadataUris];
  let loadedFromUri: vscode.Uri | undefined;

  // Try to load from each URI in order
  for (const metadataUri of uris) {
    try {
      const bytes = await vscode.workspace.fs.readFile(metadataUri);
      metadata = JSON.parse(new TextDecoder().decode(bytes));
      loadedFromUri = metadataUri;

      if (output) {
        logger.log(`Loaded metadata from ${metadataUri.fsPath}`);
      }
      break; // Successfully loaded, exit loop
    } catch (error) {
      if (output) {
        logger.log(
          `Error reading metadata file at ${metadataUri.fsPath}: ${error}`
        );
      }
      console.error('Error reading metadata file:', error);
      // Continue to next URI
    }
  }

  // If no metadata was loaded from any URI, ask for it
  if (!metadata) {
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

      // Use the last URI for saving
      const saveToUri = uris[uris.length - 1];
      const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
        title: `Write metadata to ${saveToUri.fsPath}?`,
      });

      if (answer === 'Yes') {
        if (output) {
          logger.log(`Saving metadata to ${saveToUri.fsPath}...`);
        }
        await vscode.workspace.fs.writeFile(
          saveToUri,
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
      const answer = await vscode.window.showErrorMessage(
        `You are not currently authorized to upload for the Seed Bible.\nPlease contact craig@helloao.org with your user ID for access.`,
        'Copy User ID',
        'Show Output'
      );

      if (answer === 'Copy User ID') {
        const client = await getClient(context, false);

        const sessionKey = client?.sessionKey;

        if (sessionKey) {
          const parsed = parseSessionKey(sessionKey);
          if (parsed) {
            const [userId] = parsed;
            await vscode.env.clipboard.writeText(userId);
            vscode.window.showInformationMessage(
              'User ID copied to clipboard!'
            );
          } else {
            vscode.window.showErrorMessage('No user ID found in global state.');
          }
        } else {
          vscode.window.showErrorMessage('No user ID found in global state.');
        }
      } else if (answer === 'Show Output') {
        if (logger instanceof OutputLogger) {
          logger.output.show();
        }
      }
    } else {
      vscode.window.showErrorMessage(`Error: ${credentials.errorMessage}`);
    }
    return;
  } else {
    logger.log('AWS credentials obtained successfully.');
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

  const metadataJsonUri = vscode.Uri.joinPath(folderToUpload, 'metadata.json');
  const seedBibleMetadataUri = vscode.Uri.joinPath(
    folderToUpload,
    '..',
    '..',
    'seed-bible-metadata.json'
  );

  const metadata = await loadOrAskForMetadata([
    metadataJsonUri,
    seedBibleMetadataUri,
  ]);

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

      const seedBibleUrl = new URL(
        `https://ao.bot/?pattern=seedBibleDev-Translation`
      );
      seedBibleUrl.searchParams.set('pattern', 'seedBibleDev-Translation');
      seedBibleUrl.searchParams.set(
        'translationId',
        result.availableTranslationsUrl
      );
      seedBibleUrl.searchParams.set('bios', 'local inst');
      seedBibleUrl.searchParams.set('gridPortal', 'home');

      logger.log(`Seed Bible URL: ${seedBibleUrl.href}`);

      // copy URL to clipboard
      const items = ['Open', 'Copy URL'];

      if (logger instanceof OutputLogger) {
        items.push('Show Output');
      }

      const answer = await vscode.window.showInformationMessage(
        `Upload successful! You can view your translation at: ${result.availableTranslationsUrl}`,
        ...items
      );

      if (answer === 'Open') {
        await vscode.env.openExternal(vscode.Uri.parse(seedBibleUrl.href));
      } else if (answer === 'Copy URL') {
        await vscode.env.clipboard.writeText(seedBibleUrl.href);
        vscode.window.showInformationMessage('URL copied to clipboard!');
      } else if (answer === 'Show Output') {
        if (logger instanceof OutputLogger) {
          logger.output.show();
        }
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
