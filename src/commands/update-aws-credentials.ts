import * as vscode from 'vscode';

export async function updateAwsCredentials(
  context: vscode.ExtensionContext
): Promise<void> {
  // 1. Get S3 API Key
  const accessKeyId = await vscode.window.showInputBox({
    prompt: 'Enter your AWS Access Key ID for Upload',
    title: 'AWS Access Key ID',
    validateInput: (value: string) => {
      if (!value) {
        return 'AWS Access Key ID cannot be empty.';
      }
      return null; // Return null if the input is valid
    },
  });

  if (accessKeyId) {
    // Store the access key ID securely
    await context.secrets.store('awsAccessKeyId', accessKeyId);
  }

  if (!accessKeyId) {
    vscode.window.showErrorMessage('AWS Access Key ID is required.');
    return;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    prompt: 'Enter your AWS Secret Access Key for Upload',
    title: 'AWS Secret Access Key',
    validateInput: (value: string) => {
      if (!value) {
        return 'AWS Secret Access Key cannot be empty.';
      }
      return null; // Return null if the input is valid
    },
  });

  if (secretAccessKey) {
    // Store the secret access key securely
    await context.secrets.store('awsSecretAccessKey', secretAccessKey);
  }

  if (!secretAccessKey) {
    vscode.window.showErrorMessage('AWS Secret Access Key is required.');
    return;
  }
}

export function registerUpdateAwsCredentialsCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codex.seed-bible.update-aws-credentials',
    async () => {
      return await updateAwsCredentials(context);
    }
  );
}
