import * as vscode from 'vscode';
import {
  RecordsClient,
  createRecordsClient,
} from '@casual-simulation/aux-records/RecordsClient';

const client = createRecordsClient('https://api.ao.bot');

export async function getClient(
  context: vscode.ExtensionContext
): Promise<RecordsClient> {
  if (!client.sessionKey) {
    let sessionKey = await context.secrets.get('aoBotSessionKey');

    if (sessionKey) {
      client.sessionKey = sessionKey;
    } else {
      await login(context);
    }
  }

  return client;
}

export function getOptions() {
  return {
    headers: getHeaders(),
  };
}

export function getHeaders() {
  return {
    origin: 'https://auth.ao.bot',
  };
}

export async function login(context: vscode.ExtensionContext): Promise<void> {
  // Login
  const email = await vscode.window.showInputBox({
    prompt: 'Enter your email address',
    title: 'AO Bot Login',
    validateInput: (value: string) => {
      if (!value) {
        return 'Email cannot be empty.';
      }
      return null; // Return null if the input is valid
    },
  });

  const loginResult = await client.requestLogin(
    {
      address: email,
      addressType: 'email',
    },
    getOptions()
  );

  if (!loginResult.success) {
    vscode.window.showErrorMessage(`Login failed: ${loginResult.errorMessage}`);
    throw new Error(`Login failed: ${loginResult.errorMessage}`);
  } else {
    vscode.window.showInformationMessage(
      'Login successful! Please check your email for the verification code.'
    );
  }

  await vscode.window.showInputBox({
    prompt: 'Enter the verification code',
    title: 'AO Bot Verification Code',
    validateInput: async (value: string) => {
      if (!value) {
        return 'Verification code cannot be empty.';
      }

      const result = await client.completeLogin(
        {
          requestId: loginResult.requestId,
          userId: loginResult.userId,
          code: value,
        },
        getOptions()
      );

      if (!result.success) {
        return `Login failed: ${result.errorMessage}`;
      } else {
        vscode.window.showInformationMessage(
          'Login successful! You are now logged in.'
        );
        client.sessionKey = result.sessionKey;
        await context.secrets.store('aoBotSessionKey', client.sessionKey);
      }

      return null; // Return null if the input is valid
    },
  });
}

export function registerLoginToAoBotCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('seed-bible.login', async () => {
    return await login(context);
  });
}
